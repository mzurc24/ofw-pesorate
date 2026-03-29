/**
 * /api/admin/sync
 * Trigger a fresh rate sync from Twelve Data API.
 * Called via scheduled GitHub Actions CRON (every 2h) — NOT intended for manual use.
 * Security: Bearer Token Auth
 * Version: 3.0.0 (Twelve Data Engine)
 *
 * Budget:      800 credits/day (Twelve Data free tier)
 * Per sync:    24 currency pairs = 24 credits per call
 * Schedule:    every 1h = 24 syncs/day = 576 credits/day (72% of limit)
 * Daily guard: hard cap at 700 credits/day (leaves 100 buffer)
 */

import { TWELVE_SYMBOLS, EMERGENCY_RATES } from '../../_shared/constants.js';
import { calculateRate } from '../rates.js';
import { checkAdminAuth } from './_auth.js';




/**
 * Fetch a batch of USD-based rates from Twelve Data.
 * Returns the same format as the old Fixer.io response: { PHP: 56.4, EUR: 0.92, USD: 1.0, ... }
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
    throw new Error(`Only ${successCount} valid rates returned. Possible API key or plan issue.`);
  }
  return rates;
}

export async function onRequest(context) {
  const { request, env } = context;

  // 1. Security Check
  const auth = checkAdminAuth(request, env);
  if (!auth.authorized) return auth.response;


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
        // Auto-Heal: forcefully bypassing the active circuit breaker to guarantee a fresh production sync
        await env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')").run();
        await env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')").run();
    }

    // C. Sync is now unconditional when triggered by admin API (schedule runner)
    // The daily quota guard (700) remains as the primary budget protector.


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
      env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('USD', ?, ?)").bind(ratesJson, now),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)").bind(now.toString()),

      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_fixer_fetch', ?)").bind(now.toString()), // legacy compat
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_successful_sync', ?)").bind(now.toString()),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')"),
      env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')"),
      env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/sync', 'success_twelve_data')
    ]);

    // 6. Trigger User-Facing Rate Alerts (Async Hook)
    // We don't await this to avoid blocking the sync response, but we use waitUntil if available.
    const alertPromise = triggerUserAlerts(context, fetchedRates);
    if (context.waitUntil) {
      context.waitUntil(alertPromise);
    }

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
 * Alert Engine: Check user-defined thresholds and trigger webhooks.
 */
async function triggerUserAlerts(context, rates) {
  const { env } = context;
  if (!env.DB) return;

  try {
    // 1. Fetch all active subscriptions
    const { results: subs } = await env.DB.prepare(
      "SELECT * FROM alert_subscriptions WHERE status = 'active'"
    ).all();

    if (!subs || subs.length === 0) return;

    const now = Date.now();
    const alertResults = [];

    for (const sub of subs) {
      // 2. Calculate current rate for the pair
      const currentRate = calculateRate(rates, sub.base_currency, sub.target_currency);
      
      // 3. Evaluate condition
      let triggered = false;
      if (sub.direction === 'above' && currentRate >= sub.threshold) triggered = true;
      if (sub.direction === 'below' && currentRate <= sub.threshold) triggered = true;

      // 4. Cooldown check: 24h (86400000ms) to prevent notification fatigue
      const isCooldownOver = (now - (sub.last_triggered || 0)) > 24 * 60 * 60 * 1000;

      if (triggered && isCooldownOver) {
        // 5. Build and Send Webhook (Discord/Slack compatible)
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
            // 6. Update last_triggered timestamp
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


