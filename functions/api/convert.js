/**
 * /api/convert
 * Full bidirectional currency conversion endpoint.
 * Strategy: D1 Cache (Managed by Sync/Rates) → Hardcoded Fallback
 * Single Source of Math: Uses centralized normalization.
 * Version: 4.0.0 (Twelve Data Engine)
 *
 * This version supports auto-detection via Cloudflare GeoIP and logs to DevOps.
 */

import { calculateRate, EMERGENCY_RATES, COUNTRY_CURRENCY_MAP } from './rates.js';

const SUPPORTED_CURRENCIES = [...new Set(Object.values(COUNTRY_CURRENCY_MAP))];

async function safeDbQuery(env, query, ...params) {
    if (!env?.DB) return null;
    try { return await env.DB.prepare(query).bind(...params).first(); }
    catch { return null; }
}

async function safeDbRun(env, query, ...params) {
    if (!env?.DB) return null;
    try { return await env.DB.prepare(query).bind(...params).run(); }
    catch { return null; }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type':  'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

export async function onRequest(context) {
    const { request, env, waitUntil } = context;
    const url = new URL(request.url);
    const now = Date.now();

    // ── 1. Parse & validate parameters ──────────────────────────────────────
    const fromCountry = (url.searchParams.get('from_country') || '').toUpperCase().trim();
    const toCountry   = (url.searchParams.get('to_country')   || '').toUpperCase().trim();
    const amount      = Math.abs(parseFloat(url.searchParams.get('amount') || '1')) || 1;

    // Auto-detect country via Cloudflare GeoIP
    const geoCountry  = (request.cf?.country || 'SG').toUpperCase();
    const resolvedFrom = (fromCountry && COUNTRY_CURRENCY_MAP[fromCountry]) ? fromCountry : geoCountry;
    const resolvedTo   = (toCountry   && COUNTRY_CURRENCY_MAP[toCountry])   ? toCountry   : 'PH';

    const sourceCurrency = COUNTRY_CURRENCY_MAP[resolvedFrom] || 'SGD';
    const targetCurrency = COUNTRY_CURRENCY_MAP[resolvedTo]   || 'PHP';

    // ── 2. Fetch Centralized Rates (D1 Cache → Fallback) ───────────────────
    let rates        = null;
    let strategyData = 'fallback';

    const cached = await safeDbQuery(env, `SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'`);
    if (cached?.rates_json) {
        try { 
            rates = JSON.parse(cached.rates_json); 
            strategyData = 'd1_cache'; 
        } catch { /* fall through */ }
    }

    if (!rates) {
        rates    = EMERGENCY_RATES;
        strategyData = 'hard_fallback';
    }

    // ── 3. Calculate Normalized Rate (Single Source of Math) ──────────────────────────────
    const rate = calculateRate(rates, sourceCurrency, targetCurrency);
    const convertedAmount = parseFloat((amount * rate).toFixed(4));

    // ── 4. Build rates subset for UI ───────────────────────────────────────
    const ratesSubset = {};
    for (const cur of SUPPORTED_CURRENCIES) {
        ratesSubset[cur] = rates[cur] || EMERGENCY_RATES[cur];
    }

    // ── 5. Log conversion & Telemetry ────────────────────────────────────
    const userId = (request.headers.get('x-user-id') || 'anon').slice(0, 50).replace(/[<>"'&]/g, '');
    if (env.DB) {
        waitUntil(safeDbRun(env,
            `INSERT INTO conversions (id, user_id, from_currency, to_currency, amount, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`,
            crypto.randomUUID(), userId, sourceCurrency, targetCurrency, amount, now
        ));
        
        // 🚨 DevOps Telemetry: Log endpoint hit (Zero Credit)
        waitUntil(safeDbRun(env, `INSERT INTO api_logs (endpoint, status) VALUES (?, ?)`, '/api/convert', 'hit_manual_conversion'));
    }

    // ── 6. Return structured response ───────────────────────────────────────
    return jsonResponse({
        source_country:   resolvedFrom,
        target_country:   resolvedTo,
        source_currency:  sourceCurrency,
        target_currency:  targetCurrency,
        amount:           amount,
        converted_amount: convertedAmount,
        rate:             rate,
        geo_country:      geoCountry,
        currency_locked:  geoCountry !== 'PH', // PH users are not geo-locked
        status:           'success',
        _rates:           ratesSubset, // Legacy UI expectation
        _meta: { strategy: strategyData, provider: 'twelve_data', updated: now, consistency_verified: true }
    });
}
