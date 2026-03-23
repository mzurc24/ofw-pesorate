const COUNTRY_CURRENCY_MAP = {
    'SA': 'SAR', 'AE': 'AED', 'QA': 'QAR', 'KW': 'KWD', 'OM': 'OMR',
    'BH': 'BHD', 'GB': 'GBP', 'IT': 'EUR', 'ES': 'EUR', 'DE': 'EUR',
    'FR': 'EUR', 'NL': 'EUR', 'CH': 'CHF', 'NO': 'NOK', 'SE': 'SEK',
    'SG': 'SGD', 'HK': 'HKD', 'MY': 'MYR', 'TW': 'TWD', 'JP': 'JPY',
    'KR': 'KRW', 'CN': 'CNY', 'TH': 'THB', 'US': 'USD', 'CA': 'CAD',
    'MX': 'MXN', 'AU': 'AUD', 'NZ': 'NZD',
    'PH': 'PHP' // Default to PHP per new requirements
};

const CURRENCY_SYMBOLS = {
    'SAR': '﷼', 'AED': 'د.إ', 'QAR': '﷼', 'KWD': 'د.ك', 'OMR': '﷼',
    'BHD': '.د.ب', 'GBP': '£', 'EUR': '€', 'CHF': 'CHF', 'NOK': 'kr',
    'SEK': 'kr', 'SGD': '$', 'HKD': '$', 'MYR': 'RM', 'TWD': 'NT$',
    'JPY': '¥', 'KRW': '₩', 'CNY': '¥', 'THB': '฿', 'USD': '$',
    'CAD': '$', 'MXN': '$', 'AUD': '$', 'NZD': '$', 'PHP': '₱'
};


// In-memory rate limiting map for this isolate
const rateLimitMap = new Map();

// Emergency Fallback if both D1 and Fixer fail
const STALE_FALLBACK_RATES = {
    'SAR': 14.95, 'AED': 15.28, 'QAR': 15.42, 'KWD': 182.50, 'OMR': 145.80,
    'BHD': 148.90, 'GBP': 71.20, 'EUR': 61.10, 'CHF': 63.50, 'NOK': 5.35,
    'SEK': 5.42, 'SGD': 41.60, 'HKD': 7.15, 'MYR': 12.10, 'TWD': 1.80,
    'JPY': 0.37, 'KRW': 0.042, 'CNY': 7.80, 'THB': 1.55, 'USD': 56.12,
    'CAD': 41.50, 'MXN': 3.35, 'AUD': 36.80, 'NZD': 33.90, 'PHP': 1.00
};

function sanitizeString(str) {
    if (!str) return '';
    return str.substring(0, 50).replace(/[<>"'&]/g, "");
}

async function safeDbQuery(env, query, ...params) {
    if (!env || !env.DB) return null;
    try {
        return await env.DB.prepare(query).bind(...params).first();
    } catch (e) {
        console.error('DB Query Failed:', e);
        return null;
    }
}

async function safeDbRun(env, query, ...params) {
    if (!env || !env.DB) return null;
    try {
        return await env.DB.prepare(query).bind(...params).run();
    } catch (e) {
        console.error('DB Run Failed:', e);
        return null;
    }
}

export async function onRequest(context) {
    const { request, env, waitUntil } = context;
    const url = new URL(request.url);
    const nowStamp = Date.now();

    // 1. Determine Identity & Location (Primary context)
    const rawUserId = request.headers.get('x-user-id') || 'guest';
    const userId = rawUserId.substring(0, 50).replace(/[<>"'&]/g, "");
    const customCurrency = url.searchParams.get('currency');
    const country = (request.cf?.country || 'US').toUpperCase();

    let baseCurrency = COUNTRY_CURRENCY_MAP[country] || 'USD';
    if (customCurrency && CURRENCY_SYMBOLS[customCurrency]) {
        baseCurrency = customCurrency;
    }
    const targetCurrency = 'PHP';

    // 2. Logging (Background - Non-blocking)
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

    // 3. Data Retrieval Strategy (D1 Cache -> Fallback)
    let rates = null;
    let strategyUsed = 'fallback';

    try {
        // Step A: Attempt D1 CACHE (Primary daily source)
        const cacheRecord = await safeDbQuery(env, `SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'`);
        if (cacheRecord?.rates_json) {
            rates = JSON.parse(cacheRecord.rates_json);
            strategyUsed = 'd1_cache';
        }
    } catch (e) {
        console.error('D1 Cache Retrieval failed:', e);
    }

    if (!rates) {
        // Step C: Guaranteed Fallback
        strategyUsed = 'hard_fallback';
        const phpToEur = 1 / 61.10; // Nominal rate
        rates = Object.fromEntries(
            Object.entries(STALE_FALLBACK_RATES).map(([curr, pesoVal]) => [curr, pesoVal * phpToEur])
        );
        rates['EUR'] = 1.0;
    }

    // 4. Calculate Final Rate
    const eurToLocal = rates[baseCurrency] || 1;
    const eurToPhp = rates[targetCurrency] || 1;
    const finalRate = eurToPhp / eurToLocal;

    // 5. Final Response (Guaranteed valid JSON)
    return new Response(JSON.stringify({
        from_currency: baseCurrency,
        to_currency: targetCurrency,
        rate: finalRate,
        country: country,
        symbol: CURRENCY_SYMBOLS[baseCurrency] || '',
        target_symbol: '₱',
        currency_locked: country !== 'PH', // true = user cannot switch currencies
        _meta: {
            strategy: strategyUsed,
            updated: nowStamp
        }
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Strategy': strategyUsed
        }
    });
}
