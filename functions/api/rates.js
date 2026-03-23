/**
 * /api/rates
 * Centralized Fixer.io Sync Service
 * Throttled to 1 call per 24 hours.
 * Caches in Cloudflare KV.
 * Logs success/failure to D1 api_logs.
 */

const CACHE_TTL = 86400; // 24 hours in seconds

async function shouldFetch(env) {
  if (!env.DB) return true;
  const lastFetchRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
  if (!lastFetchRow) return true;
  const now = Date.now();
  return (now - parseInt(lastFetchRow.value)) / 1000 >= CACHE_TTL;
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
    console.error("Failed to log usage:", e);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. Check for cached data first (D1)
  let cached = null;
  if (env.DB) {
    const row = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
    if (row) {
        cached = { rates: JSON.parse(row.rates_json), timestamp: row.updated_at };
    }
  }

  // 2. Decide whether to fetch fresh or return cached
  const needFetch = await shouldFetch(env);
  
  if (!needFetch && cached) {
    return new Response(JSON.stringify({
      success: true,
      ...cached,
      _meta: { strategy: "daily_cache", source: "D1" }
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  console.log("Fetching fresh daily data from Fixer.io");
  const apiKey = env.CF_FIXER_KEY || 'c056294df71360e7b8e84205ef080e47';
  const fixerUrl = "http://data.fixer.io/api/latest";

  try {
    const res = await fetch(`${fixerUrl}?access_key=${apiKey}&symbols=USD,SGD,PHP,JPY,EUR,SAR,AED,QAR,KWD,OMR,BHD,GBP,CAD,AUD,NZD`);
    if (!res.ok) throw new Error(`Fixer API returned ${res.status}`);
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error?.info || "Fixer sync failed");

    // 3. Update Cache (D1)
    if (env.DB) {
        const nowStamp = Date.now();
        await env.DB.batch([
            env.DB.prepare("INSERT INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?) ON CONFLICT(base_currency) DO UPDATE SET rates_json = excluded.rates_json, updated_at = excluded.updated_at").bind(JSON.stringify(data.rates), nowStamp),
            env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_fixer_fetch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(nowStamp.toString())
        ]);
        await logUsage(env, "/api/rates", "success");
    }

    return new Response(JSON.stringify({
      ...data,
      _meta: { strategy: "fresh_sync", source: "Fixer.io" }
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (err) {
    console.error("Fixer API fetch failed:", err);
    await logUsage(env, "/api/rates", "fail");

    if (cached) {
      return new Response(JSON.stringify({
        ...cached,
        _meta: { strategy: "fallback_cache", error: err.message }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response(JSON.stringify({ status: "error", message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
