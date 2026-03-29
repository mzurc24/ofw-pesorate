/**
 * /api/rates
 * Centralized Twelve Data Rate Sync & Normalization Service
 * Single Source of Truth for all currency data.
 * Version: 4.0.0 (Twelve Data Engine)
 *
 * Budget: 800 credits/day free tier.
 * Each sync = 24 pairs = 24 credits. At 2h interval = 12 syncs/day = 288 credits/day (36% of limit).
 */

const CACHE_TTL = 7200; // 2 hours in seconds — nearly-live data feed

// All currency pairs fetched as EUR/{currency} — maintains the EUR-base format
// that calculateRate() requires. 1 batch HTTP call = 24 credits.
import { 
  TWELVE_SYMBOLS, 
  COUNTRY_CURRENCY_MAP, 
  CURRENCY_SYMBOLS, 
  EMERGENCY_RATES,
  SUPPORTED_COUNTRIES
} from '../_shared/constants.js';

export { 
  TWELVE_SYMBOLS, 
  COUNTRY_CURRENCY_MAP, 
  CURRENCY_SYMBOLS, 
  EMERGENCY_RATES,
  SUPPORTED_COUNTRIES
};



/**
 * Normalization Engine — UNCHANGED from original.
 * Rate(Target) = eurToTarget / eurToSource
 * Standardizes all calculations to 8 decimal places to prevent drift.
 */
export function calculateRate(rates, from, to) {
  const usdToSource = rates[from] || EMERGENCY_RATES[from] || 1;
  const usdToTarget = rates[to]   || EMERGENCY_RATES[to]   || 1;
  return parseFloat((usdToTarget / usdToSource).toFixed(8));
}


/**
 * Fetch all rates from Twelve Data batch price endpoint.
 * Response format: { "EUR/USD": { "price": "1.0921" }, "EUR/PHP": { "price": "63.45" }, ... }
 * Transformed to: { EUR: 1.0, USD: 1.0921, PHP: 63.45, ... } — identical to old Fixer format.
 * 1 call = 24 API credits.
 */
async function fetchFromTwelveData(apiKey) {
  const url = `https://api.twelvedata.com/price?symbol=${TWELVE_SYMBOLS}&apikey=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

  const data = await res.json();

  // Handle top-level API error (e.g. invalid key)
  if (data.code === 400 || data.status === 'error') {
    throw new Error(`Twelve Data API error: ${data.message || 'Unknown error'}`);
  }

  // Transform batch response → USD-based rates object
  const rates = { USD: 1.0 };

  let successCount = 0;

  for (const [pair, val] of Object.entries(data)) {
    const currency = pair.split('/')[1]; // "EUR/USD" → "USD"
    if (!currency) continue;

    // Handle per-pair errors gracefully — fall back to emergency rate
    if (val.code === 400 || val.status === 'error' || !val.price) {
      console.warn(`Twelve Data: no data for ${pair} — ${val.message || 'unavailable'}. Using emergency fallback.`);
      if (EMERGENCY_RATES[currency]) rates[currency] = EMERGENCY_RATES[currency];
      continue;
    }

    const price = parseFloat(val.price);
    if (isNaN(price) || price <= 0) {
      console.warn(`Twelve Data: invalid price for ${pair}: ${val.price}`);
      if (EMERGENCY_RATES[currency]) rates[currency] = EMERGENCY_RATES[currency];
      continue;
    }

    rates[currency] = price;
    successCount++;
  }

  // Require at least 10 valid rates — otherwise something is seriously wrong
  if (successCount < 10) {
    throw new Error(`Twelve Data: only ${successCount} valid rates returned. Possible API key issue.`);
  }

  return rates;
}

/**
 * Check if cache is stale and a new fetch is needed.
 * Reads the 'last_twelvedata_fetch' settings key, falls back to legacy 'last_fixer_fetch'.
 */
async function shouldFetch(env) {
  if (!env.DB) return true;
  try {
    // Check primary key first, then legacy key for backward compatibility
    let row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_twelvedata_fetch'").first();
    if (!row) {
      row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
    }
    if (!row) return true;
    return (Date.now() - parseInt(row.value)) / 1000 >= CACHE_TTL;
  } catch (e) {
    console.error('shouldFetch check failed (non-fatal):', e.message);
    return true;
  }
}

async function logUsage(env, endpoint, status) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO api_logs (endpoint, status, timestamp) VALUES (?, ?, datetime('now'))"
    ).bind(endpoint, status).run();
  } catch (e) {
    console.error('Failed to log usage:', e.message);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=600, s-maxage=600'
  };

  try {
    // 1. Check D1 cache first
    let cached = null;
    if (env.DB) {
      try {
        const row = await env.DB.prepare(
          "SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'USD'"
        ).first();

        if (row) cached = { rates: JSON.parse(row.rates_json), timestamp: row.updated_at };
      } catch (e) {
        console.error('D1 cache read failed:', e.message);
      }
    }

    // 2. Return cached data if still fresh (within 2h TTL)
    const needFetch = await shouldFetch(env);
    if (!needFetch && cached) {
      return new Response(JSON.stringify({
        success: true,
        rates: cached.rates,
        timestamp: cached.timestamp,
        _meta: { strategy: 'cache', source: 'D1', provider: 'twelve_data', normalized: true }
      }), { headers });
    }

    // 3. Fetch fresh data from Twelve Data
    const apiKey = env.CF_TWELVEDATA_KEY;
    if (!apiKey) {
      console.warn('CF_TWELVEDATA_KEY not set. Serving from cache or emergency fallback.');
      await logUsage(env, '/api/rates', 'skip_no_key');
      if (cached) {
        return new Response(JSON.stringify({
          success: true, rates: cached.rates, timestamp: cached.timestamp,
          _meta: { strategy: 'fallback_cache', error: 'API key not configured' }
        }), { headers });
      }
      return new Response(JSON.stringify({
        success: true, rates: EMERGENCY_RATES, timestamp: Date.now(),
        _meta: { strategy: 'emergency_fallback', error: 'No API key, no cache' }
      }), { headers });
    }

    let fetchedRates = null;
    let fetchError = null;
    try {
      fetchedRates = await fetchFromTwelveData(apiKey);
    } catch (e) {
      fetchError = e.message;
      console.error('Twelve Data fetch failed:', fetchError);
    }

    // 4. Handle fetch failure — serve stale cache or emergency rates
    if (!fetchedRates) {
      await logUsage(env, '/api/rates', 'fail');
      if (cached) {
        return new Response(JSON.stringify({
          success: true, rates: cached.rates, timestamp: cached.timestamp,
          _meta: { strategy: 'fallback_cache', error: fetchError, provider: 'twelve_data' }
        }), { headers });
      }
      return new Response(JSON.stringify({
        success: true, rates: EMERGENCY_RATES, timestamp: Date.now(),
        _meta: { strategy: 'emergency_fallback', error: fetchError }
      }), { headers });
    }

    // 5. Persist to D1 cache
    if (env.DB) {
      try {
        const nowStamp = Date.now();
        await env.DB.prepare(
          "REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('USD', ?, ?)"
        ).bind(JSON.stringify(fetchedRates), nowStamp).run();

        // Write both the new key and legacy key so validate.js / system.js still work
        await env.DB.prepare(
          "REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)"
        ).bind(nowStamp.toString()).run();
        await env.DB.prepare(
          "REPLACE INTO settings (key, value) VALUES ('last_fixer_fetch', ?)"
        ).bind(nowStamp.toString()).run();
        await logUsage(env, '/api/rates', 'success');
      } catch (dbErr) {
        console.error('D1 write failed (non-fatal):', dbErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      rates: fetchedRates,
      timestamp: Date.now(),
      _meta: {
        strategy: 'fresh_sync',
        source: 'Twelve Data',
        provider: 'twelve_data',
        normalized: true,
        currencies_fetched: Object.keys(fetchedRates).length,
        credits_used: Object.keys(fetchedRates).length - 1 // EUR is free (base)
      }
    }), { headers });

  } catch (err) {
    console.error('FATAL /api/rates error:', err.message);
    return new Response(JSON.stringify({
      success: true,
      rates: EMERGENCY_RATES,
      timestamp: Date.now(),
      _meta: { strategy: 'emergency_fallback', error: err.message }
    }), { headers });
  }
}
