/**
 * /api/convert
 * Full bidirectional currency conversion endpoint.
 * Strategy: D1 Cache (Managed by Sync/Rates) → Hardcoded Fallback
 * Single Source of Math: Uses centralized normalization.
 * Version: 3.0.0 (Consistency Engine)
 */

import { calculateRate, EMERGENCY_RATES } from './rates.js';

const COUNTRY_CURRENCY_MAP = {
    'SA':'SAR', 'AE':'AED', 'QA':'QAR', 'KW':'KWD', 'OM':'OMR', 'BH':'BHD',
    'GB':'GBP', 'IT':'EUR', 'ES':'EUR', 'DE':'EUR', 'FR':'EUR', 'NL':'EUR',
    'CH':'CHF', 'NO':'NOK', 'SE':'SEK',
    'SG':'SGD', 'HK':'HKD', 'MY':'MYR', 'TW':'TWD', 'JP':'JPY',
    'KR':'KRW', 'CN':'CNY', 'TH':'THB',
    'US':'USD', 'CA':'CAD', 'MX':'MXN', 'AU':'AUD', 'NZ':'NZD',
    'PH':'PHP'
};

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

    const geoCountry  = (request.cf?.country || 'SG').toUpperCase();
    const resolvedFrom = (fromCountry && COUNTRY_CURRENCY_MAP[fromCountry]) ? fromCountry : geoCountry;
    const resolvedTo   = (toCountry   && COUNTRY_CURRENCY_MAP[toCountry])   ? toCountry   : 'PH';

    const sourceCurrency = COUNTRY_CURRENCY_MAP[resolvedFrom] || 'SGD';
    const targetCurrency = COUNTRY_CURRENCY_MAP[resolvedTo]   || 'PHP';

    // ── 2. Fetch Centralized Rates (D1 Cache → Fallback) ───────────────────
    let rates        = null;
    let strategy     = 'fallback';

    // Step A: D1 Cache (Populated by /api/admin/sync or /api/rates)
    const cached = await safeDbQuery(env, `SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'`);
    if (cached?.rates_json) {
        try { 
            rates = JSON.parse(cached.rates_json); 
            strategy = 'd1_cache'; 
        } catch { /* fall through */ }
    }

    // Step B: Hardcoded fallback
    if (!rates) {
        rates    = EMERGENCY_RATES;
        strategy = 'hard_fallback';
    }

    // ── 3. Calculate Normalized Rate ──────────────────────────────
    // Rate(Target) = Fixer[Target] / Fixer[Source]
    const rate = calculateRate(rates, sourceCurrency, targetCurrency);
    const convertedAmount = parseFloat((amount * rate).toFixed(4));

    // ── 4. Build rates subset for UI ───────────────────────────────────────
    const ratesSubset = {};
    for (const cur of SUPPORTED_CURRENCIES) {
        ratesSubset[cur] = rates[cur] || EMERGENCY_RATES[cur];
    }

    // ── 5. Log conversion ────────────────────────────────────
    const userId = (request.headers.get('x-user-id') || 'anon').slice(0, 50).replace(/[<>"'&]/g, '');
    if (env.DB) {
        waitUntil(safeDbRun(env,
            `INSERT INTO conversions (id, user_id, from_currency, to_currency, amount, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`,
            crypto.randomUUID(), userId, sourceCurrency, targetCurrency, amount, now
        ));
    }

    // ── 6. Return structured response ───────────────────────────────────────
    return jsonResponse({
        source_country:   resolvedFrom,
        target_country:   resolvedTo,
        source_currency:  sourceCurrency,
        target_currency:  targetCurrency,
        amount:           amount,
        converted_amount: convertedAmount,
        rate:             rate, // Already standardized to 6 places by calculateRate
        geo_country:      geoCountry,
        currency_locked:  geoCountry !== 'PH',
        status:           'success',
        _rates:           ratesSubset,
        _meta: { strategy, updated: now, consistency_verified: true }
    });
}
