/**
 * /api/rates
 * Centralized Fixer.io Sync Service
 * Throttled to 1 call per 24 hours.
 * Caches in D1.
 * Logs success/failure to D1 api_logs.
 * Version: 2.0.0 (Self-Healing)
 */

const CACHE_TTL = 86400; // 24 hours in seconds

// Emergency hardcoded fallback rates (EUR-based)
const EMERGENCY_RATES = {
  USD: 1.09, PHP: 64.0, SGD: 1.46, JPY: 161.2, GBP: 0.86,
  SAR: 4.04, AED: 3.98, QAR: 3.94, KWD: 0.33, OMR: 0.42,
  BHD: 0.41, EUR: 1.00, CAD: 1.51, AUD: 1.70, NZD: 1.87
};

async function shouldFetch(env) {
  if (!env.DB) return true;
  try {
    const lastFetchRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
    if (!lastFetchRow) return true;
    const now = Date.now();
    return (now - parseInt(lastFetchRow.value)) / 1000 >= CACHE_TTL;
  } catch (e) {
    // settings table might not exist yet — allow fetch
    console.error('shouldFetch check failed (non-fatal):', e.message);
    return true;
  }
}

async function logUsage(env, endpoint, status) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO api_logs (endpoint, status, timestamp)
      VALUES (?, ?, datetime('now'))
    `)
    .bind(endpoint, status)
    .run();
  } catch (e) {
    console.error("Failed to log usage:", e.message);
  }
}

async function fetchWithRetry(url, retries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return res;
      console.error(`Fixer API attempt ${attempt}/${retries}: HTTP ${res.status}`);
    } catch (e) {
      console.error(`Fixer API attempt ${attempt}/${retries}: ${e.message}`);
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * attempt)); // exponential backoff
    }
  }
  return null; // all retries exhausted
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=600, s-maxage=600' // 10 min frontend cache
  };

  try {
    // 1. Check for cached data first (D1)
    let cached = null;
    if (env.DB) {
      try {
        const row = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
        if (row) {
          cached = { rates: JSON.parse(row.rates_json), timestamp: row.updated_at };
        }
      } catch (e) {
        console.error('D1 cache read failed:', e.message);
      }
    }

    // 2. Decide whether to fetch fresh or return cached
    const needFetch = await shouldFetch(env);
    
    if (!needFetch && cached) {
      return new Response(JSON.stringify({
        success: true,
        rates: cached.rates,
        timestamp: cached.timestamp,
        _meta: { strategy: "daily_cache", source: "D1" }
      }), { headers });
    }

    // 3. Fetch fresh data with retry logic
    console.log("Fetching fresh daily data from Fixer.io");
    const apiKey = env.CF_FIXER_KEY || 'c056294df71360e7b8e84205ef080e47';
    const fixerUrl = `http://data.fixer.io/api/latest?access_key=${apiKey}&symbols=USD,SGD,PHP,JPY,EUR,SAR,AED,QAR,KWD,OMR,BHD,GBP,CAD,AUD,NZD`;

    const res = await fetchWithRetry(fixerUrl);
    
    if (!res) {
      // All retries failed — serve cache or emergency fallback
      console.error('CRITICAL: All Fixer API retries exhausted');
      await logUsage(env, "/api/rates", "fail_all_retries");

      if (cached) {
        return new Response(JSON.stringify({
          success: true,
          rates: cached.rates,
          timestamp: cached.timestamp,
          _meta: { strategy: "fallback_cache", error: "All Fixer retries failed" }
        }), { headers });
      }

      return new Response(JSON.stringify({
        success: true,
        rates: EMERGENCY_RATES,
        timestamp: Date.now(),
        _meta: { strategy: "emergency_fallback", error: "No cache, no API" }
      }), { headers });
    }

    const data = await res.json();
    if (!data.success) {
      const errMsg = data.error?.info || "Fixer sync failed";
      console.error('Fixer API returned error:', errMsg);
      await logUsage(env, "/api/rates", "fail_api_error");

      // Serve cached or fallback
      if (cached) {
        return new Response(JSON.stringify({
          success: true,
          rates: cached.rates,
          timestamp: cached.timestamp,
          _meta: { strategy: "fallback_cache", error: errMsg }
        }), { headers });
      }

      return new Response(JSON.stringify({
        success: true,
        rates: EMERGENCY_RATES,
        timestamp: Date.now(),
        _meta: { strategy: "emergency_fallback", error: errMsg }
      }), { headers });
    }

    // 4. Update Cache (D1) 
    if (env.DB) {
      try {
        const nowStamp = Date.now();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?) ON CONFLICT(base_currency) DO UPDATE SET rates_json = excluded.rates_json, updated_at = excluded.updated_at").bind(JSON.stringify(data.rates), nowStamp),
          env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_fixer_fetch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(nowStamp.toString())
        ]);
        await logUsage(env, "/api/rates", "success");
      } catch (dbErr) {
        console.error('D1 write failed (non-fatal):', dbErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      rates: data.rates,
      timestamp: data.timestamp || Date.now(),
      _meta: { strategy: "fresh_sync", source: "Fixer.io" }
    }), { headers });

  } catch (err) {
    // Global catch — NEVER crash the worker
    console.error("FATAL /api/rates error:", err.message);
    
    return new Response(JSON.stringify({
      success: true,
      rates: EMERGENCY_RATES,
      timestamp: Date.now(),
      _meta: { strategy: "emergency_fallback", error: err.message }
    }), { headers });
  }
}
