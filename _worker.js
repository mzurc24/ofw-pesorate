/**
 * OFW PesoRate - Advanced Multi-Cache Worker (Production Edition)
 * Version: 4.0.0 (Twelve Data Engine)
 * Budget: 800 credits/day. Each sync = 24 credits.
 */

const SHORT_TTL = 600; // 10 minutes
const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours (Twelve Data sync window)

const TWELVE_SYMBOLS = [
  'EUR/USD', 'EUR/PHP', 'EUR/SGD', 'EUR/JPY', 'EUR/GBP',
  'EUR/SAR', 'EUR/AED', 'EUR/QAR', 'EUR/KWD', 'EUR/OMR',
  'EUR/BHD', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD', 'EUR/CHF',
  'EUR/NOK', 'EUR/SEK', 'EUR/HKD', 'EUR/MYR', 'EUR/TWD',
  'EUR/KRW', 'EUR/CNY', 'EUR/THB', 'EUR/MXN'
].join(',');

const EMERGENCY_RATES = {
  USD: 1.08, PHP: 63.5, SGD: 1.45, JPY: 162.0, GBP: 0.855,
  SAR: 4.05, AED: 3.97, QAR: 3.93, KWD: 0.332, OMR: 0.416,
  BHD: 0.407, EUR: 1.00, CAD: 1.50, AUD: 1.69, NZD: 1.85,
  CHF: 0.96, NOK: 11.55, SEK: 11.20, HKD: 8.42, MYR: 4.82,
  TWD: 34.90, KRW: 1460, CNY: 7.85, THB: 37.50, MXN: 21.8
};

let pendingFetch = null;

export default {
    /**
     * Phase 10: Scheduled Worker (Twelve Data Sync)
     */
    async scheduled(event, env, ctx) {
        console.log("CRON: Twelve Data system-wide sync triggered...");
        const now = Date.now();
        const today = new Date().toISOString().split('T')[0];

        ctx.waitUntil((async () => {
            if (!env.DB) return;

            // 1. Quota & Circuit Breaker Check
            const [usageRow, settingsRows] = await Promise.all([
                env.DB.prepare("SELECT fixer_calls FROM api_usage WHERE month = ?").bind(today).first(),
                env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('td_disabled_until', 'last_twelvedata_fetch')").all()
            ]);

            const settings = Object.fromEntries(settingsRows.results.map(r => [r.key, r.value]));
            const dailyCredits = usageRow?.fixer_calls || 0;
            const disabledUntil = parseInt(settings.td_disabled_until || '0');
            const lastSync = parseInt(settings.last_twelvedata_fetch || '0');

            // 2. Decide if we should sync (700 daily credits limit)
            if (dailyCredits < 700 && now >= disabledUntil && (now - lastSync >= SYNC_INTERVAL_MS)) {
                console.log("CRON: Proceeding with Twelve Data sync...");
                const apiKey = (env.CF_TWELVEDATA_KEY || "").trim();
                
                if (!apiKey) {
                    console.error("CRON: No Twelve Data API key found.");
                    return;
                }

                try {
                    // Update usage BEFORE fetch (24 credits)
                    await env.DB.prepare("INSERT INTO api_usage (month, fixer_calls) VALUES (?, 24) ON CONFLICT(month) DO UPDATE SET fixer_calls = fixer_calls + 24").bind(today, 24).run();
                    
                    const rates = await fetchTwelveWithRetry(apiKey);
                    if (rates) {
                        await env.DB.batch([
                            env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?)").bind(JSON.stringify(rates), now),
                            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)").bind(now.toString()),
                            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_fixer_fetch', ?)").bind(now.toString()),
                            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')")
                        ]);
                        console.log("CRON: D1 Cache updated successfully using Twelve Data.");
                    }
                } catch (e) {
                    console.error("CRON Sync Failed:", e.message);
                }
            }
        })());
    },

    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === '/api/rates') {
            return await handleRatesRequest(url, request, env, ctx);
        }

        if (url.pathname === '/api/admin/telemetry' && request.method === 'POST') {
            return await handleTelemetry(request, env);
        }

        const ua = (request.headers.get('User-Agent') || '').toLowerCase();
        const isBot = ua.includes('facebookexternalhit') || ua.includes('facebot') || ua.includes('twitterbot') || ua.includes('whatsapp');

        if (isBot) return fetch(request);
        return fetch(request);
    }
};

async function handleTelemetry(request, env) {
    try {
        const data = await request.json();
        if (env.DB) {
            await env.DB.prepare(`
                INSERT INTO healing_logs (id, action, status, details, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).bind(crypto.randomUUID(), data.actions_executed?.join(',') || 'MONITOR', data.status || 'UNKNOWN', JSON.stringify(data), Date.now()).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

async function handleRatesRequest(url, request, env, ctx) {
    const base = (url.searchParams.get('base') || 'USD').toUpperCase();
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        const body = await cachedResponse.json();
        return new Response(JSON.stringify({ ...body, cached: true }), {
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'SHORT_TERM_HIT' }
        });
    }

    try {
        if (!pendingFetch) {
            const now = Date.now();
            const today = new Date().toISOString().split('T')[0];
            
            let usageRow = null;
            let settings = {};
            if (env.DB) {
                const [ur, sr] = await Promise.all([
                    env.DB.prepare("SELECT fixer_calls FROM api_usage WHERE month = ?").bind(today).first(),
                    env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('td_disabled_until', 'last_twelvedata_fetch')").all()
                ]);
                usageRow = ur;
                settings = Object.fromEntries((sr.results || []).map(r => [r.key, r.value]));
            }

            const dailyCredits = usageRow?.fixer_calls || 0;
            const disabledUntil = parseInt(settings.td_disabled_until || '0');
            const lastSync = parseInt(settings.last_twelvedata_fetch || '0');

            if (dailyCredits < 700 && now >= disabledUntil && (now - lastSync >= SYNC_INTERVAL_MS)) {
                const apiKey = (env.CF_TWELVEDATA_KEY || "").trim();
                if (!apiKey) throw new Error("API_KEY_MISSING");

                pendingFetch = (async () => {
                    if (env.DB) await env.DB.prepare("INSERT INTO api_usage (month, fixer_calls) VALUES (?, 24) ON CONFLICT(month) DO UPDATE SET fixer_calls = fixer_calls + 24").bind(today, 24).run();
                    return fetchTwelveWithRetry(apiKey);
                })();
                ctx.waitUntil(pendingFetch.finally(() => { pendingFetch = null; }));
            } else {
                throw new Error("API_RESTRICTED");
            }
        }

        const rates = await pendingFetch;
        const normalized = normalizeRates(rates, base);
        
        const responseData = {
            success: true,
            base: base,
            rates: normalized,
            timestamp: Date.now(),
            source: "twelve_data",
            cached: false
        };

        const response = new Response(JSON.stringify(responseData), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${SHORT_TTL}`,
                'Access-Control-Allow-Origin': '*'
            }
        });

        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        if (env.DB) {
            ctx.waitUntil(env.DB.prepare(`
                REPLACE INTO rates_cache (base_currency, rates_json, updated_at) 
                VALUES ('EUR', ?, ?)
            `).bind(JSON.stringify(rates), Date.now()).run());
        }

        return response;

    } catch (err) {
        if (env.DB) {
            const backup = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
            if (backup) {
                const normalized = normalizeRates(JSON.parse(backup.rates_json), base);
                return new Response(JSON.stringify({
                    success: true,
                    base: base,
                    rates: normalized,
                    timestamp: backup.updated_at,
                    source: "d1_backup",
                    status: 'DEGRADED',
                    stale: true,
                    cached: true
                }), { headers: { 'Content-Type': 'application/json', 'X-System-Status': 'DEGRADED' } });
            }
        }

        return new Response(JSON.stringify({ success: false, error: "Rates unavailable", reason: err.message, timestamp: Date.now() }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

function normalizeRates(rates, targetBase) {
    const eurToBase = rates[targetBase] || 1;
    const normalized = {};
    for (const [cur, val] of Object.entries(rates)) {
        normalized[cur] = parseFloat((val / eurToBase).toFixed(4));
    }
    return normalized;
}

async function fetchTwelveWithRetry(apiKey) {
    const url = `https://api.twelvedata.com/price?symbol=${TWELVE_SYMBOLS}&apikey=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error("HTTP_ERROR");
        const data = await res.json();
        
        const transformed = { EUR: 1.0 };
        for (const [pair, val] of Object.entries(data)) {
            const currency = pair.split('/')[1];
            if (currency && val.price) transformed[currency] = parseFloat(val.price);
        }
        return transformed;
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }
}
