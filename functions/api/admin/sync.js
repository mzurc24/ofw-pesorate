/**
 * /api/admin/sync
 * Trigger a fresh rate sync from Twelve Data API.
 * Called via scheduled GitHub Actions CRON (every 2h) — NOT intended for manual use.
 * Security: Bearer Token Auth
 * Version: 3.0.0 (Twelve Data Engine)
 *
 * Budget:      800 credits/day (Twelve Data free tier)
 * Per sync:    24 currency pairs = 24 credits per call
 * Schedule:    every 2h = 12 syncs/day = 288 credits/day (36% of limit)
 * Daily guard: hard cap at 700 credits/day (leaves 100 buffer)
 */

// All EUR-based pairs — same list as rates.js
const TWELVE_SYMBOLS = [
  'EUR/USD', 'EUR/PHP', 'EUR/SGD', 'EUR/JPY', 'EUR/GBP',
  'EUR/SAR', 'EUR/AED', 'EUR/QAR', 'EUR/KWD', 'EUR/OMR',
  'EUR/BHD', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD', 'EUR/CHF',
  'EUR/NOK', 'EUR/SEK', 'EUR/HKD', 'EUR/MYR', 'EUR/TWD',
  'EUR/KRW', 'EUR/CNY', 'EUR/THB', 'EUR/MXN'
].join(',');

const EMERGENCY_RATES = {
  USD: 1.08, PHP: 63.5, SGD: 1.45, JPY: 162.0, GBP: 0.855,
  SAR: 4.05, AED: 3.97, QAR: 3.93, KWD: 0.332, OMR: 0.416,
  BHD: 0.407, EUR: 1.00, CAD: 1.50, AUD: 1.69, NZD: 1.85,
  CHF: 0.96, NOK: 11.55, SEK: 11.20, HKD: 8.42, MYR: 4.82,
  TWD: 34.90, KRW: 1460, CNY: 7.85, THB: 37.50, MXN: 21.8
};

/**
 * Fetch a batch of EUR-based rates from Twelve Data.
 * Returns the same format as the old Fixer.io response: { USD: 1.08, PHP: 63.5, EUR: 1.0, ... }
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
  if (data.code === 400 || data.status === 'error') {
    throw new Error(`Twelve Data API error: ${data.message || 'Auth or plan issue'}`);
  }

  const rates = { EUR: 1.0 };
  let successCount = 0;

  for (const [pair, val] of Object.entries(data)) {
    const currency = pair.split('/')[1];
    if (!currency) continue;
    if (val.code === 400 || val.status === 'error' || !val.price) {
      if (EMERGENCY_RATES[currency]) rates[currency] = EMERGENCY_RATES[currency];
      continue;
    }
    const price = parseFloat(val.price);
    if (isNaN(price) || price <= 0) {
      if (EMERGENCY_RATES[currency]) rates[currency] = EMERGENCY_RATES[currency];
      continue;
    }
    rates[currency] = price;
    successCount++;
  }

  if (successCount < 10) {
    throw new Error(`Only ${successCount} valid rates returned. Possible API key or plan issue.`);
  }
  return rates;
}

export async function onRequest(context) {
  const { request, env } = context;

  // 1. Security Check
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const validToken = (env.CF_ADMIN_TOKEN || 'ofwAk026').trim();

  if (!token || token !== validToken) {
    return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const now = Date.now();
  // Daily tracking key (YYYY-MM-DD) — stored in api_usage table
  const today = new Date().toISOString().split('T')[0];

  try {
    if (!env.DB) throw new Error('Database configuration missing.');

    // 2. Read daily usage + settings in parallel
    const [usageRow, settingsRows] = await Promise.all([
      env.DB.prepare('SELECT fixer_calls FROM api_usage WHERE month = ?').bind(today).first(),
      env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('td_disabled_until', 'td_fail_count', 'last_twelvedata_fetch', 'last_fixer_fetch')"
      ).all()
    ]);

    const settings = Object.fromEntries((settingsRows.results || []).map(r => [r.key, r.value]));
    const dailyCalls    = usageRow?.fixer_calls || 0;          // reusing existing column
    const disabledUntil = parseInt(settings.td_disabled_until  || '0');
    const failCount     = parseInt(settings.td_fail_count      || '0');
    // Check both new and legacy timestamp keys
    const lastSync      = parseInt(settings.last_twelvedata_fetch || settings.last_fixer_fetch || '0');

    // A. Daily Quota Guard — hard cap at 700 credits/day (88% of 800 limit)
    // Each sync call = 24 credits. 700 / 24 ≈ 29 syncs max per day.
    if (dailyCalls >= 700) {
      return new Response(JSON.stringify({
        status: 'API_LIMIT_PROTECTED',
        message: 'Daily Twelve Data quota guard (700 credits) reached. Using cached data.',
        credits_used_today: dailyCalls,
        credits_limit: 700
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    // B. Circuit Breaker Check
    if (now < disabledUntil) {
      return new Response(JSON.stringify({
        status: 'DEGRADED_MODE',
        message: 'Circuit breaker active. Twelve Data disabled temporarily due to repeated failures.',
        disabled_until: new Date(disabledUntil).toISOString()
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    // C. Throttle Check — 2 hour minimum interval between syncs
    // This is the PRIMARY protection against over-fetching.
    // GitHub Actions CRON enforces the schedule — this is a second-layer guard.
    const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

const TWELVE_SYMBOLS = [
  'EUR/USD', 'EUR/PHP', 'EUR/SGD', 'EUR/JPY', 'EUR/GBP',
  'EUR/SAR', 'EUR/AED', 'EUR/QAR', 'EUR/KWD', 'EUR/OMR',
  'EUR/BHD', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD', 'EUR/CHF',
  'EUR/NOK', 'EUR/SEK', 'EUR/HKD', 'EUR/MYR', 'EUR/TWD',
  'EUR/KRW', 'EUR/CNY', 'EUR/THB', 'EUR/MXN'
].join(',');

const EMERGENCY_RATES = {
  USD: 1.08, PHP: 63.5, SGD: 1.45, JPY: 162.0, GBP: 0.855,
  SAR: 4.05, AED: 3.97, QAR: 3.93, KWD: 0.332, OMR: 0.416,
  BHD: 0.407, EUR: 1.00, CAD: 1.50, AUD: 1.69, NZD: 1.85,
  CHF: 0.96, NOK: 11.55, SEK: 11.20, HKD: 8.42, MYR: 4.82,
  TWD: 34.90, KRW: 1460, CNY: 7.85, THB: 37.50, MXN: 21.8
};
    if (now - lastSync < SYNC_INTERVAL_MS) {
      return new Response(JSON.stringify({
        status: 'success', // legacy compat
        result: 'HEALTHY',
        data_source: 'CACHE',
        message: 'Data is fresh (within 2h window). Sync skipped to protect API quota.',
        last_sync_mins_ago: Math.floor((now - lastSync) / 60000),
        credits_used_today: dailyCalls
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Increment daily credit counter BEFORE the API call
    // Each call = 24 credits (one per currency pair)
    const CREDITS_PER_CALL = 24;
    await env.DB.prepare(
      'INSERT INTO api_usage (month, fixer_calls) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET fixer_calls = fixer_calls + ?'
    ).bind(today, CREDITS_PER_CALL, CREDITS_PER_CALL).run();

    // 4. Fetch from Twelve Data
    const apiKey = env.CF_TWELVEDATA_KEY;
    if (!apiKey) {
      throw new Error('CF_TWELVEDATA_KEY secret is not set. Configure it via: npx wrangler pages secret put CF_TWELVEDATA_KEY');
    }

    let fetchedRates = null;
    let fetchError = null;
    try {
      fetchedRates = await fetchFromTwelveData(apiKey);
    } catch (e) {
      fetchError = e.message;
      console.error('Twelve Data fetch failed:', fetchError);
    }

    if (!fetchedRates) {
      // FAILURE: Activate circuit breaker after 3 consecutive failures
      const newFailCount = failCount + 1;
      const newDisabledUntil = newFailCount >= 3 ? now + (6 * 60 * 60 * 1000) : 0; // 6h lockout

      await env.DB.batch([
        env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', ?)").bind(newFailCount.toString()),
        env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', ?)").bind(newDisabledUntil.toString()),
        env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/sync', 'fail_twelve_data')
      ]);

      return new Response(JSON.stringify({
        status: 'DEGRADED',
        data_source: 'CACHE',
        message: 'Twelve Data API failed. D1 cache remains active.',
        error: fetchError,
        fail_count: newFailCount,
        circuit_breaker_until: newDisabledUntil > 0 ? new Date(newDisabledUntil).toISOString() : null
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // 5. SUCCESS — update D1 cache and reset circuit breaker
    const ratesJson = JSON.stringify(fetchedRates);
    await env.DB.batch([
      env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?)").bind(ratesJson, now),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)").bind(now.toString()),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_fixer_fetch', ?)").bind(now.toString()), // legacy compat
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_successful_sync', ?)").bind(now.toString()),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')"),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')"),
      env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/sync', 'success_twelve_data')
    ]);

    return new Response(JSON.stringify({
      status: 'success',
      result: 'HEALTHY',
      data_source: 'TWELVE_DATA',
      message: 'Rates synced successfully from Twelve Data.',
      currencies_synced: Object.keys(fetchedRates).length,
      count: Object.keys(fetchedRates).length, // Map to legacy 'count'
      credits_used_this_call: CREDITS_PER_CALL,
      credits_used_today: dailyCalls + CREDITS_PER_CALL,
      credits_remaining_today: 700 - (dailyCalls + CREDITS_PER_CALL),
      actions_taken: ['API_SYNC_SUCCESS', 'D1_CACHE_UPDATED', 'CIRCUIT_BREAKER_RESET']
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Fatal Sync Error:', err.message);
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Fetch all rates from Twelve Data batch price endpoint.
 * Response format: { "EUR/USD": { "price": "1.0921" }, "EUR/PHP": { "price": "63.45" }, ... }
 * Transformed to: { EUR: 1.0, USD: 1.0921, PHP: 63.45, ... } 
 */
async function fetchFromTwelveData(apiKey) {
  const url = `https://api.twelvedata.com/price?symbol=${TWELVE_SYMBOLS}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

  const data = await res.json();
  if (data.code === 400 || data.status === 'error') {
    throw new Error(`Twelve Data API error: ${data.message || 'Unknown error'}`);
  }

  const rates = { EUR: 1.0 };
  let successCount = 0;
  for (const [pair, val] of Object.entries(data)) {
    const currency = pair.split('/')[1];
    if (!currency) continue;
    if (val.code === 400 || val.status === 'error' || !val.price) {
      if (EMERGENCY_RATES[currency]) rates[currency] = EMERGENCY_RATES[currency];
      continue;
    }
    const price = parseFloat(val.price);
    if (!isNaN(price) && price > 0) {
      rates[currency] = price;
      successCount++;
    }
  }

  if (successCount < 10) throw new Error(`Twelve Data: only ${successCount} valid rates returned.`);
  return rates;
}
