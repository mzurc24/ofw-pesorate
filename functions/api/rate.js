/**
 * /api/rate
 * Optimized single-rate lookup endpoint.
 * Strategy: D1 Cache → Hardcoded Fallback
 * Single Source of Math: Uses centralized normalization.
 * Version: 4.0.0 (Twelve Data Engine)
 *
 * This version supports auto-detection via Cloudflare GeoIP and logs to DevOps.
 */

import { calculateRate, EMERGENCY_RATES, COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from './rates.js';

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
    
    // =====================================
    // 🌍 AUTO COUNTRY DETECTION & EU GROUPING
    // =====================================
    const EUROZONE = ['AT', 'BE', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'HR', 'AD', 'MC', 'SM', 'VA'];
    
    let country = request.cf?.country?.toUpperCase();
    
    if (!country || country === 'XX' || country === 'T1') {
        const clientCountry = request.headers.get('x-client-country');
        const browserLocale = request.headers.get('x-browser-locale');
        const timeZone = request.headers.get('x-time-zone');
        
        if (clientCountry && clientCountry.length === 2) {
            country = clientCountry.toUpperCase();
        } else if (timeZone && timeZone === 'Asia/Manila') {
            country = 'PH';
        } else if (browserLocale && browserLocale.includes('-')) {
            country = browserLocale.split('-')[1].toUpperCase();
        } else {
            country = 'US';
        }
    }
    
    // Fetch User Preferences for PH Override
    const userPrefs = await safeDbQuery(env, "SELECT preferred_currency FROM user_preferences WHERE user_id = ?", userId);

    // Test Header Override (Security Gate)
    const testCountry = request.headers.get('x-test-country');
    if (testCountry && (env.CF_ADMIN_TOKEN === request.headers.get('x-test-token'))) {
        country = testCountry.toUpperCase();
    }

    let isPH = (country === 'PH');

    // =====================================
    // 💱 MASTER REFERENCE: CURRENCY DISPLAY LOGIC
    // =====================================
    // PH User:     Can change currency. Default = USD.
    // Non-PH User: Locked to detected country's currency.
    let baseCurrency;

    if (isPH) {
        // PH default is USD. Apply saved preference or manual switch if valid (not PHP).
        baseCurrency = 'USD';
        if (userPrefs?.preferred_currency && userPrefs.preferred_currency !== 'PHP') {
            baseCurrency = userPrefs.preferred_currency;
        }
        if (customCurrency && CURRENCY_SYMBOLS[customCurrency] && customCurrency !== 'PHP') {
            baseCurrency = customCurrency;
        }
    } else {
        // Non-PH: lock to detected country currency
        baseCurrency = COUNTRY_CURRENCY_MAP[country] || 'USD';
        // Group all Eurozone countries to EUR
        if (EUROZONE.includes(country)) baseCurrency = 'EUR';
    }

    let canChange = isPH; // Only PH users get the dropdown
    const targetCurrency = 'PHP';



    // 3. Social Media Detection & Metadata
    const userAgent = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer') || '';
    
    let socialPlatform = null;
    let isSocialBot = false;
    let isSocialWebview = false;
    const uaLower = userAgent.toLowerCase();
    
    if (uaLower.includes('facebookexternalhit') || uaLower.includes('facebot')) {
        socialPlatform = 'Facebook'; isSocialBot = true;
    } else if (uaLower.includes('twitterbot')) {
        socialPlatform = 'Twitter'; isSocialBot = true;
    } else if (uaLower.includes('linkedinbot')) {
        socialPlatform = 'LinkedIn'; isSocialBot = true;
    } else if (uaLower.includes('fbav') || uaLower.includes('fban')) {
        socialPlatform = 'Facebook'; isSocialWebview = true;
    } else if (uaLower.includes('instagram')) {
        socialPlatform = 'Instagram'; isSocialWebview = true;
    } else if (uaLower.includes('fbmv') || uaLower.includes('messenger')) {
        socialPlatform = 'Messenger'; isSocialWebview = true;
    } else if (referer.includes('t.co')) {
        socialPlatform = 'Twitter';
    } else if (referer.includes('facebook.com') || referer.includes('fb.com')) {
        socialPlatform = 'Facebook';
    }

    let deviceType = 'Desktop';
    if (uaLower.includes('mobi')) deviceType = 'Mobile';
    else if (uaLower.includes('tablet')) deviceType = 'Tablet';

    // 4. Persistence & Telemetry
    if (env.DB) {
        // Log user and conversion
        waitUntil(safeDbRun(env, `
            INSERT INTO users (id, name, country, first_seen) 
            VALUES (?, 'Guest', ?, ?)
            ON CONFLICT(id) DO UPDATE SET country = excluded.country
        `, userId, country, nowStamp));

        waitUntil(safeDbRun(env, `
            INSERT INTO conversions (id, user_id, from_currency, to_currency, amount, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, crypto.randomUUID(), userId, baseCurrency, targetCurrency, 1, nowStamp));

        // Log social traffic if applicable
        if (socialPlatform) {
            waitUntil(safeDbRun(env, `
                INSERT INTO social_traffic (id, platform, country, device_type, status, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `, crypto.randomUUID(), socialPlatform, country, deviceType, 'success', nowStamp));
        }

        // 🚨 DevOps Telemetry: Log endpoint hit (Zero Credit)
        waitUntil(safeDbRun(env, `INSERT INTO api_logs (endpoint, status) VALUES (?, ?)`, '/api/rate', 'hit_auto_detect'));
    }

    // 5. Rate Retrieval (D1 Cache → Lazy Sync Fallback)
    let rates = null;
    let strategyUsed = 'fallback';
    let updatedAt = nowStamp;

    const cacheRecord = await safeDbQuery(env, `SELECT rates_json, previous_rates_json, updated_at FROM rates_cache WHERE base_currency = 'USD'`);

    if (cacheRecord?.rates_json) {
        rates = JSON.parse(cacheRecord.rates_json);
        updatedAt = cacheRecord.updated_at;
        strategyUsed = 'd1_cache';
    }

    // 🚨 STAMPEDE PROTECTION: Removed dangerous LAZY_SYNC.
    // The public edge must NEVER directly hit the upstream API. 
    // We rely 100% on the D1 Cache, populated by the secure background CRON.
    const ageMinutes = (nowStamp - updatedAt) / (1000 * 60);



    if (!rates) {
        strategyUsed = 'hard_fallback';
        rates = EMERGENCY_RATES;
        updatedAt = nowStamp;
    }

    // Determine health
    const ageHours = (nowStamp - updatedAt) / (1000 * 60 * 60);
    const isStale = ageHours > 24;
    const status = isStale ? 'DEGRADED' : 'HEALTHY';


    // 6. Final Calculation (Single Source of Math)
    const finalRate = calculateRate(rates, baseCurrency, targetCurrency);
    const usdRate = calculateRate(rates, 'USD', 'PHP');

    // Interpolation Data logic
    const prevRates = cacheRecord?.previous_rates_json ? JSON.parse(cacheRecord.previous_rates_json) : rates;
    const prevRate = calculateRate(prevRates, baseCurrency, targetCurrency);
    const delta = finalRate - prevRate;

    return new Response(JSON.stringify({
        status: status,
        from_currency: baseCurrency,
        to_currency: targetCurrency,
        rate: finalRate,
        previous_rate: prevRate,
        delta: delta,
        usd_rate: usdRate,
        country: country,
        symbol: CURRENCY_SYMBOLS[baseCurrency] || '',
        target_symbol: '₱',
        is_ph: isPH,
        secondary_currency: isPH ? 'USD' : null,
        secondary_symbol: '$',
        currency_locked: !canChange,
        can_change: canChange,
        social_mode: isSocialWebview || isSocialBot,
        is_bot: isSocialBot,

        _meta: {
            strategy: strategyUsed,
            provider: 'twelve_data',
            updated: updatedAt,
            cache_age_seconds: Math.floor((nowStamp - updatedAt) / 1000),
            is_stale: isStale,
            interpolation_ready: true
        }
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

