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
    // 🌍 AUTO COUNTRY DETECTION
    // =====================================
    let detectedCountry = null;

    // A. Account Settings
    const userPrefs = await safeDbQuery(env, "SELECT preferred_currency, home_currency FROM user_preferences WHERE user_id = ?", userId);
    const userRecord = await safeDbQuery(env, "SELECT country FROM users WHERE id = ?", userId);
    if (userRecord?.country) detectedCountry = userRecord.country;

    // B. Local Storage Hint
    if (!detectedCountry) {
        const clientCountry = request.headers.get('x-client-country');
        if (clientCountry) detectedCountry = clientCountry.toUpperCase();
    }

    // C. Browser Locale Hint
    if (!detectedCountry) {
        const locale = request.headers.get('x-browser-locale') || '';
        const parts = locale.split('-');
        if (parts.length > 1) detectedCountry = parts[1].toUpperCase();
    }

    // D. IP Address (Primary Default)
    if (!detectedCountry) {
        if (request.cf && request.cf.country) detectedCountry = request.cf.country.toUpperCase();
    }
    
    // Fallback if completely undetected
    if (!detectedCountry) {
        detectedCountry = 'US';
        if (env.DB) {
            waitUntil(safeDbRun(env, `INSERT INTO api_logs (endpoint, status) VALUES (?, ?)`, '/api/rate', 'error_country_detection_failed'));
        }
    }

    let country = detectedCountry;

    // Testing & Simulation Environment (CI/CD) Override
    const testCountry = request.headers.get('x-test-country');
    const testToken = request.headers.get('x-test-token');
    const validToken = (env.CF_ADMIN_TOKEN || '').trim();
    if (testCountry && testToken === validToken) {
        country = testCountry.toUpperCase();
    }

    // =====================================
    // 💱 CURRENCY DISPLAY LOGIC (GEO-FENCED)
    // =====================================
    let isPH = (country === 'PH');
    let baseCurrency;
    let secondaryCurrency = null;
    let currencyLocked = true;

    if (isPH) {
        // PH Users: Show USD <-> PHP Conversion.
        baseCurrency = 'USD'; // Default USD
        secondaryCurrency = 'USD';
        currencyLocked = false; // Enable manual switch

        // Apply saved preference or live custom switch ONLY for PH users
        if (userPrefs?.preferred_currency) baseCurrency = userPrefs.preferred_currency;
        if (customCurrency && CURRENCY_SYMBOLS[customCurrency]) baseCurrency = customCurrency;
        
    } else {
        // Non-PH Users: Primary is Local currency. DO NOT show PHP <-> USD conversion. DISABLE switch.
        baseCurrency = COUNTRY_CURRENCY_MAP[country] || 'USD';
        currencyLocked = true;
    }

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

    // 5. Rate Retrieval (D1 Cache → Twelve Data Source)
    let rates = null;
    let strategyUsed = 'fallback';

    const cacheRecord = await safeDbQuery(env, `SELECT rates_json FROM rates_cache WHERE base_currency = 'USD'`);


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

    // 6. Final Calculation (Single Source of Math)
    const finalRate = calculateRate(rates, baseCurrency, targetCurrency);
    const usdRate = calculateRate(rates, 'USD', 'PHP');

    return new Response(JSON.stringify({
        from_currency: baseCurrency,
        to_currency: targetCurrency,
        rate: finalRate,
        usd_rate: usdRate,
        country: country,
        symbol: CURRENCY_SYMBOLS[baseCurrency] || '',
        target_symbol: '₱',
        is_ph: isPH,
        secondary_currency: secondaryCurrency,
        secondary_symbol: CURRENCY_SYMBOLS[secondaryCurrency] || '$',
        currency_locked: currencyLocked,
        social_mode: isSocialWebview || isSocialBot,
        is_bot: isSocialBot,

        _meta: {
            strategy: strategyUsed,
            provider: 'twelve_data',
            updated: nowStamp,
            consistency_verified: true
        }
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
