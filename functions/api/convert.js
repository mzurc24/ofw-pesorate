/**
 * /api/convert
 * Full bidirectional currency conversion endpoint.
 * Params: from_country, to_country, amount
 * Strategy: Live API → D1 Cache → Hardcoded Fallback
 * Never returns an error to the client.
 */

const COUNTRY_CURRENCY_MAP = {
    'SA':'SAR', 'AE':'AED', 'QA':'QAR', 'KW':'KWD', 'OM':'OMR', 'BH':'BHD',
    'GB':'GBP', 'IT':'EUR', 'ES':'EUR', 'DE':'EUR', 'FR':'EUR', 'NL':'EUR',
    'CH':'CHF', 'NO':'NOK', 'SE':'SEK',
    'SG':'SGD', 'HK':'HKD', 'MY':'MYR', 'TW':'TWD', 'JP':'JPY',
    'KR':'KRW', 'CN':'CNY', 'TH':'THB',
    'US':'USD', 'CA':'CAD', 'MX':'MXN', 'AU':'AUD', 'NZ':'NZD',
    'PH':'PHP'
};

// All supported currencies (derived from supported countries)
const SUPPORTED_CURRENCIES = [...new Set(Object.values(COUNTRY_CURRENCY_MAP))];

// Hardcoded EUR-based fallback rates (last safe known values)
const FALLBACK_EUR_RATES = {
    SAR:4.04, AED:3.98, QAR:3.94, KWD:0.33, OMR:0.42, BHD:0.41,
    GBP:0.86, EUR:1.00, CHF:0.97, NOK:11.49, SEK:11.17,
    SGD:1.46, HKD:8.49, MYR:4.84, TWD:34.58, JPY:161.2,
    KRW:1457,  CNY:7.88, THB:37.72,
    USD:1.09,  CAD:1.51, MXN:21.5, AUD:1.70, NZD:1.87,
    PHP:64.0
};

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

    // Geo-detect if from_country is not supplied
    const geoCountry  = (request.cf?.country || 'SG').toUpperCase();
    const resolvedFrom = (fromCountry && COUNTRY_CURRENCY_MAP[fromCountry]) ? fromCountry : geoCountry;
    const resolvedTo   = (toCountry   && COUNTRY_CURRENCY_MAP[toCountry])   ? toCountry   : 'PH';

    const sourceCurrency = COUNTRY_CURRENCY_MAP[resolvedFrom] || 'SGD';
    const targetCurrency = COUNTRY_CURRENCY_MAP[resolvedTo]   || 'PHP';

    // ── 2. Fetch EUR-based rates (Live → Cache → Fallback) ───────────────────
    let rates        = null;
    let strategy     = 'fallback';

    // Step A: Live API
    try {
        const apiKey = env.CF_FIXER_KEY || '566e5ce2bbb50f23733c34b6b07146b2';
        const res    = await fetch(`http://data.fixer.io/api/latest?access_key=${apiKey}`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.rates) {
                rates    = data.rates;
                strategy = 'live';
                // Cache in background
                if (env.DB) {
                    waitUntil(safeDbRun(env,
                        `INSERT INTO rates_cache (base_currency, rates_json, updated_at)
                         VALUES ('EUR', ?, ?)
                         ON CONFLICT(base_currency) DO UPDATE SET
                             rates_json = excluded.rates_json,
                             updated_at = excluded.updated_at`,
                        JSON.stringify(rates), now
                    ));
                }
            }
        }
    } catch { /* fall through */ }

    // Step B: D1 Cache
    if (!rates) {
        const cached = await safeDbQuery(env, `SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'`);
        if (cached?.rates_json) {
            try { rates = JSON.parse(cached.rates_json); strategy = 'cache'; } catch { /* fall through */ }
        }
    }

    // Step C: Hardcoded fallback — never let the user see an error
    if (!rates) {
        rates    = FALLBACK_EUR_RATES;
        strategy = 'fallback';
    }

    // ── 3. Calculate rate and converted amount ──────────────────────────────
    const eurToSource = rates[sourceCurrency] ?? FALLBACK_EUR_RATES[sourceCurrency] ?? 1;
    const eurToTarget = rates[targetCurrency] ?? FALLBACK_EUR_RATES[targetCurrency] ?? 1;
    const rate           = eurToTarget / eurToSource;
    const convertedAmount = parseFloat((amount * rate).toFixed(4));

    // ── 4. Build rates subset for UI quick-reference ────────────────────────
    const ratesSubset = {};
    for (const cur of SUPPORTED_CURRENCIES) {
        const r = rates[cur] ?? FALLBACK_EUR_RATES[cur];
        if (r != null) ratesSubset[cur] = r;
    }

    // ── 5. Log conversion in background ────────────────────────────────────
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
        rate:             parseFloat(rate.toFixed(6)),
        geo_country:      geoCountry,
        currency_locked:  geoCountry !== 'PH', // switching allowed only for PH
        status:           'success',
        _rates:           ratesSubset,
        _meta: { strategy, updated: now }
    });
}
