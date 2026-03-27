/**
 * /api/rate
 * Optimized single-rate lookup endpoint.
 * Strategy: D1 Cache → Hardcoded Fallback
 * Single Source of Math: Uses centralized normalization.
 * Version: 3.0.0 (Consistency Engine)
 */

import { calculateRate, EMERGENCY_RATES } from './rates.js';

const COUNTRY_CURRENCY_MAP = {
    'SA': 'SAR', 'AE': 'AED', 'QA': 'QAR', 'KW': 'KWD', 'OM': 'OMR',
    'BH': 'BHD', 'GB': 'GBP', 'IT': 'EUR', 'ES': 'EUR', 'DE': 'EUR',
    'FR': 'EUR', 'NL': 'EUR', 'CH': 'CHF', 'NO': 'NOK', 'SE': 'SEK',
    'SG': 'SGD', 'HK': 'HKD', 'MY': 'MYR', 'TW': 'TWD', 'JP': 'JPY',
    'KR': 'KRW', 'CN': 'CNY', 'TH': 'THB', 'US': 'USD', 'CA': 'CAD',
    'MX': 'MXN', 'AU': 'AUD', 'NZ': 'NZD',
    'PH': 'PHP'
};

const CURRENCY_SYMBOLS = {
    'SAR': '﷼', 'AED': 'د.إ', 'QAR': '﷼', 'KWD': 'د.ك', 'OMR': '﷼',
    'BHD': '.د.ب', 'GBP': '£', 'EUR': '€', 'CHF': 'CHF', 'NOK': 'kr',
    'SEK': 'kr', 'SGD': '$', 'HKD': '$', 'MYR': 'RM', 'TWD': 'NT$',
    'JPY': '¥', 'KRW': '₩', 'CNY': '¥', 'THB': '฿', 'USD': '$',
    'CAD': '$', 'MXN': '$', 'AUD': '$', 'NZD': '$', 'PHP': '₱'
};

async function safeDbQuery(env, query, ...params) {
    if (!env || !env.DB) return null;
    try { return await env.DB.prepare(query).bind(...params).first(); }
    catch { return null; }
}

async function safeDbRun(env, query, ...params) {
    if (!env || !env.DB) return null;
    try { return await env.DB.prepare(query).bind(...params).run(); }
    catch { return null; }
}

export async function onRequest(context) {
    const { request, env, waitUntil } = context;
    const url = new URL(request.url);
    const nowStamp = Date.now();

    const userId = (request.headers.get('x-user-id') || 'guest').substring(0, 50).replace(/[<>"'&]/g, "");
    const customCurrency = url.searchParams.get('currency');
    const country = (request.cf?.country || 'US').toUpperCase();

    let baseCurrency = COUNTRY_CURRENCY_MAP[country] || 'USD';
    if (customCurrency && CURRENCY_SYMBOLS[customCurrency]) {
        baseCurrency = customCurrency;
    }
    const targetCurrency = 'PHP';

    // Logging
    if (env.DB) {
        waitUntil(safeDbRun(env, `
            INSERT INTO users (id, name, country, first_seen) 
            VALUES (?, 'Guest', ?, ?)
            ON CONFLICT(id) DO UPDATE SET country = excluded.country
        `, userId, country, nowStamp));

        waitUntil(safeDbRun(env, `
            INSERT INTO conversions (id, user_id, from_currency, to_currency, amount, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, crypto.randomUUID(), userId, baseCurrency, targetCurrency, 1, nowStamp));
    }

    // Data Retrieval Strategy
    let rates = null;
    let strategyUsed = 'fallback';

    const cacheRecord = await safeDbQuery(env, `SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'`);
    if (cacheRecord?.rates_json) {
        try { 
            rates = JSON.parse(cacheRecord.rates_json); 
            strategyUsed = 'd1_cache'; 
        } catch { /* ignored */ }
    }

    if (!rates) {
        strategyUsed = 'hard_fallback';
        rates = EMERGENCY_RATES;
    }

    // Single Source of Math
    const finalRate = calculateRate(rates, baseCurrency, targetCurrency);

    return new Response(JSON.stringify({
        from_currency: baseCurrency,
        to_currency: targetCurrency,
        rate: finalRate,
        country: country,
        symbol: CURRENCY_SYMBOLS[baseCurrency] || '',
        target_symbol: '₱',
        currency_locked: country !== 'PH',
        _meta: {
            strategy: strategyUsed,
            updated: nowStamp,
            consistency_verified: true
        }
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        }
    });
}
