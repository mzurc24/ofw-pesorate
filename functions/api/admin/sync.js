/**
 * /api/admin/sync
 * Trigger a fresh rate sync.
 * Security: Bearer Token Auth
 * Version: 4.0.0 (Dual-Source Engine)
 *
 * PRIMARY:  ExchangeRate-API (open.er-api.com) — free, no key, no per-minute limits
 *           Returns all 160+ currencies in ONE call. Zero credit cost.
 * FALLBACK: Twelve Data — used only if primary fails.
 *           Budget: 800 credits/day | 26 per call | guard at 700/day
 */

import { TWELVE_SYMBOLS, EMERGENCY_RATES } from '../../_shared/constants.js';
import { calculateRate } from '../rates.js';
import { checkAdminAuth } from './_auth.js';

/**
 * PRIMARY: Fetch all rates from ExchangeRate-API (completely free, no key needed).
 * Returns USD-based rate map: { PHP: 56.4, SGD: 1.34, EUR: 0.92, ... }
 */
async function fetchFromExchangeRateAPI() {
  const url = 'https://open.er-api.com/v6/latest/USD';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`);

  const data = await res.json();

  if (data.result !== 'success') {
    throw new Error(`ExchangeRate-API error: ${data['error-type'] || 'Unknown'}`);
  }

  if (!data.rates || typeof data.rates !== 'object') {
    throw new Error('ExchangeRate-API: no rates in response');
  }

  // Validate we have the critical currencies we need
  const required = ['PHP', 'SGD', 'SAR', 'AED', 'GBP', 'EUR', 'JPY', 'USD'];
  const missing = required.filter(c => !data.rates[c]);
  if (missing.length > 2) {
    throw new Error(`ExchangeRate-API missing critical currencies: ${missing.join(', ')}`);
  }

  return { ...data.rates, USD: 1.0 };
}

/**
 * FALLBACK: Fetch from Twelve Data (used only if primary fails).
 * Returns USD-based rate map.
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

  const rates = { USD: 1.0 };
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
    throw new Error(`Only ${successCount} valid rates from Twelve Data. Possible API key or plan issue.`);
  }
  return rates;
}

export async function onRequest(context) {
  const { request, env } = context;

  // 1. Security Check
  const auth = checkAdminAuth(request, env);
  if (!auth.authorized) return auth.response;

  const now = Date.now();
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
    const dailyCalls    = usageRow?.fixer_calls || 0;
    const disabledUntil = parseInt(settings.td_disabled_until || '0');
    const failCount     = parseInt(settings.td_fail_count || '0');

    // A. Daily Quota Guard (only applies to Twelve Data fallback path)
    if (dailyCalls >= 700) {
      return new Response(JSON.stringify({
        status: 'API_LIMIT_PROTECTED',
        message: 'Daily Twelve Data quota guard (700 credits) reached. Using cached data.',
        credits_used_today: dailyCalls,
        credits_limit: 700
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Try PRIMARY source first — ExchangeRate-API (free, no key, no rate limits)
    let fetchedRates = null;
    let fetchError = null;
    let dataSource = 'EXCHANGE_RATE_API';

    try {
      fetchedRates = await fetchFromExchangeRateAPI();
      console.log('ExchangeRate-API sync successful');
    } catch (primaryErr) {
      console.warn('ExchangeRate-API failed, trying Twelve Data fallback:', primaryErr.message);
      fetchError = primaryErr.message;
      dataSource = 'TWELVE_DATA_FALLBACK';

      // 4. FALLBACK — Twelve Data
      // Reset circuit breaker if locked
      if (now < disabledUntil) {
        await env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')").run();
        await env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')").run();
      }

      // Count Twelve Data credits (26 per call)
      const CREDITS_PER_CALL = 26;
      await env.DB.prepare(
        'INSERT INTO api_usage (month, fixer_calls) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET fixer_calls = fixer_calls + ?'
      ).bind(today, CREDITS_PER_CALL, CREDITS_PER_CALL).run();

      const apiKey = env.CF_TWELVEDATA_KEY;
      if (apiKey) {
        try {
          fetchedRates = await fetchFromTwelveData(apiKey);
          fetchError = null;
          console.log('Twelve Data fallback sync successful');
        } catch (fallbackErr) {
          fetchError = fallbackErr.message;
          console.error('Twelve Data fallback also failed:', fetchError);
        }
      } else {
        fetchError = `ExchangeRate-API failed (${primaryErr.message}) and CF_TWELVEDATA_KEY is not set.`;
      }
    }

    // 5. Both sources failed — activate circuit breaker
    if (!fetchedRates) {
      const newFailCount = failCount + 1;
      const newDisabledUntil = newFailCount >= 3 ? now + (6 * 60 * 60 * 1000) : 0;

      await env.DB.batch([
        env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', ?)").bind(newFailCount.toString()),
        env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', ?)").bind(newDisabledUntil.toString()),
        env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/sync', 'fail_all_sources')
      ]);

      return new Response(JSON.stringify({
        status: 'DEGRADED',
        data_source: 'CACHE',
        message: 'All rate sources failed. D1 cache remains active.',
        error: fetchError,
        fail_count: newFailCount,
        circuit_breaker_until: newDisabledUntil > 0 ? new Date(newDisabledUntil).toISOString() : null
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // 6. SUCCESS — update D1 cache and reset circuit breaker
    const ratesJson = JSON.stringify(fetchedRates);
    await env.DB.batch([
      env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('USD', ?, ?)").bind(ratesJson, now),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)").bind(now.toString()),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_fixer_fetch', ?)").bind(now.toString()),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_successful_sync', ?)").bind(now.toString()),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')"),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')"),
      env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/sync', `success_${dataSource.toLowerCase()}`)
    ]);

    // 7. Trigger User-Facing Rate Alerts (async, non-blocking)
    const alertPromise = triggerUserAlerts(context, fetchedRates);
    if (context.waitUntil) {
      context.waitUntil(alertPromise);
    }

    return new Response(JSON.stringify({
      status: 'success',
      result: 'HEALTHY',
      data_source: dataSource,
      message: `Rates synced successfully from ${dataSource}.`,
      currencies_synced: Object.keys(fetchedRates).length,
      count: Object.keys(fetchedRates).length,
      credits_used_today: dailyCalls,
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
 * Alert Engine: Check user-defined thresholds and trigger webhooks.
 */
async function triggerUserAlerts(context, rates) {
  const { env } = context;
  if (!env.DB) return;

  try {
    const { results: subs } = await env.DB.prepare(
      "SELECT * FROM alert_subscriptions WHERE status = 'active'"
    ).all();

    if (!subs || subs.length === 0) return;

    const now = Date.now();
    const alertResults = [];

    for (const sub of subs) {
      const currentRate = calculateRate(rates, sub.base_currency, sub.target_currency);

      let triggered = false;
      if (sub.direction === 'above' && currentRate >= sub.threshold) triggered = true;
      if (sub.direction === 'below' && currentRate <= sub.threshold) triggered = true;

      const isCooldownOver = (now - (sub.last_triggered || 0)) > 24 * 60 * 60 * 1000;

      if (triggered && isCooldownOver) {
        const message = {
          content: `🔔 **OFW Rate Alert**\n\nThe ${sub.base_currency} to ${sub.target_currency} rate is now **₱${currentRate.toFixed(2)}**.\n(Threshold: ${sub.direction} ₱${sub.threshold.toFixed(2)})\n\nTrack live: https://ofwpesorate.madzlab.site/`
        };

        try {
          const res = await fetch(sub.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });

          if (res.ok) {
            await env.DB.prepare(
              "UPDATE alert_subscriptions SET last_triggered = ? WHERE id = ?"
            ).bind(now, sub.id).run();
            alertResults.push({ id: sub.id, status: 'sent' });
          } else {
            console.error(`Alert failed for sub ${sub.id}: HTTP ${res.status}`);
          }
        } catch (e) {
          console.error(`Alert fetch error for sub ${sub.id}:`, e.message);
        }
      }
    }

    if (alertResults.length > 0) {
      console.log(`Alert Engine: Triggered ${alertResults.length} notifications.`);
    }

  } catch (e) {
    console.error('Alert Engine Fatal Error:', e.message);
  }
}
