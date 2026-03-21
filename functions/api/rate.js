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

function sanitizeString(str) {
    if (!str) return '';
    return str.substring(0, 50).replace(/[<>"'&]/g, "");
}

export async function onRequest(context) {
    const { request, env } = context;
    
    // 1. Rate Limiting Check
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const nowStamp = Date.now();
    const userLimit = rateLimitMap.get(ip) || { count: 0, time: nowStamp };
    
    if (nowStamp - userLimit.time > 60000) {
        userLimit.count = 1;
        userLimit.time = nowStamp;
    } else {
        userLimit.count++;
        if (userLimit.count > 30) {
            return Response.json({ error: 'Too Many Requests' }, { status: 429 });
        }
    }
    rateLimitMap.set(ip, userLimit);

    // 2. Safely Get & Sanitize User Info
    const rawUserId = request.headers.get('x-user-id');
    const url = new URL(request.url);
    const customCurrency = url.searchParams.get('currency');
    const country = request.cf?.country || 'US';
    
    // 3. Determine Local Currency
    let localCurrency = COUNTRY_CURRENCY_MAP[country] || 'USD';
    
    // Override if custom is provided and valid
    if (customCurrency && CURRENCY_SYMBOLS[customCurrency]) {
        localCurrency = customCurrency;
    }
    
    const targetCurrency = 'PHP';
    
    // 4. Update/Log User
    if (userId) {
        try {
            await env.DB.prepare(`
                INSERT INTO users (id, name, country, first_seen) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                name = excluded.name, country = excluded.country
            `).bind(userId, userName, country, nowStamp).run();
        } catch (e) {
            console.error('Failed to log user', e);
        }
    }

    // 5. Fetch/Cache Rates
    let rates = null;
    try {
        const cacheRecord = await env.DB.prepare(`SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'`).first();
        
        // 15 mins = 900,000 ms
        if (cacheRecord && (nowStamp - cacheRecord.updated_at < 900000)) {
            rates = JSON.parse(cacheRecord.rates_json);
        } else {
            // Fetch from Fixer using CF_FIXER_KEY
            const apiKey = env.CF_FIXER_KEY;
            const fixerRes = await fetch(`http://data.fixer.io/api/latest?access_key=${apiKey}`);
            const fixerData = await fixerRes.json();
            
            if (fixerData.success) {
                rates = fixerData.rates;
                await env.DB.prepare(`
                    INSERT INTO rates_cache (base_currency, rates_json, updated_at)
                    VALUES ('EUR', ?, ?)
                    ON CONFLICT(base_currency) DO UPDATE SET 
                    rates_json = excluded.rates_json, updated_at = excluded.updated_at
                `).bind(JSON.stringify(rates), nowStamp).run();
            } else if (cacheRecord) {
                // fallback to stale cache if Fixer fails
                rates = JSON.parse(cacheRecord.rates_json);
            } else {
                return Response.json({ error: 'Fixer API Error and no cache' }, { status: 500 });
            }
        }
    } catch (e) {
        console.error(e);
        return Response.json({ error: 'Failed to retrieve rates' }, { status: 500 });
    }

    // 6. Calculate rate
    const eurToLocal = rates[localCurrency] || 1;
    const eurToPhp = rates[targetCurrency] || 1;
    const finalRate = eurToPhp / eurToLocal;

    // 7. Log Conversion Event
    if (userId) {
        try {
            const convId = crypto.randomUUID();
            await env.DB.prepare(`
                INSERT INTO conversions (id, user_id, from_currency, to_currency, amount, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(convId, userId, localCurrency, targetCurrency, 1, nowStamp).run();
        } catch (e) {
            console.error('Failed to log conversion', e);
        }
    }

    // 8. Return response with aggressive Edge Caching headers
    return Response.json({
        from_currency: localCurrency,
        to_currency: targetCurrency,
        rate: finalRate,
        country: country,
        symbol: CURRENCY_SYMBOLS[localCurrency] || '',
        target_symbol: '₱'
    }, {
        headers: {
            'Cache-Control': 'public, max-age=60, s-maxage=300' // Edge caches for 5 mins, Browser for 1 min
        }
    });
}
