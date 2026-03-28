/**
 * OFW PesoRate - Advanced Multi-Cache Worker (Production Edition)
 * Phases 1-12: Full Self-Healing, High-Precision Normalization, and Dual-Caching.
 */

const SHORT_TTL = 600; // 10 minutes (Phase 2)
const LONG_TTL = 86400; // 24 hours (Phase 5)

// In-memory memoization to prevent parallel fetches (Phase 3 Single-Flight)
let pendingFetch = null;

export default {
    /**
     * Phase 10: Scheduled Worker (Hourly Sync)
     * Automatically refreshes the D1 cache and validates rates.
     */
    async scheduled(event, env, ctx) {
        console.log("CRON: Hourly system-wide sync triggered...");
        const apiKey = (env.FIXER_API_KEY || env.CF_FIXER_KEY || "").trim();
        const fixerUrl = `http://data.fixer.io/api/latest?access_key=${apiKey}`;

        ctx.waitUntil((async () => {
            const data = await fetchFixerWithRetry(fixerUrl);
            if (data && env.DB) {
                const now = Date.now();
                await env.DB.prepare(`
                    REPLACE INTO rates_cache (base_currency, rates_json, updated_at) 
                    VALUES ('EUR', ?, ?)
                `).bind(JSON.stringify(data.rates), now).run();
                console.log("CRON: D1 Cache updated successfully.");
            }
        })());
    },

    /**
     * Phase 1-9: Unified API Endpoint
     * Handles /api/rates with aggressive caching and normalization.
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Routing for the rates API (Phase 1)
        if (url.pathname === '/api/rates') {
            return await handleRatesRequest(url, request, env, ctx);
        }

        // Pass-through to static assets or other Pages Functions
        return fetch(request);
    }
};

/**
 * Main API Handler (Phases 1-7)
 */
async function handleRatesRequest(url, request, env, ctx) {
    const base = (url.searchParams.get('base') || 'USD').toUpperCase();
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);

    // 1. Short-term Cache Check (Phase 2 & 5)
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        const body = await cachedResponse.json();
        return new Response(JSON.stringify({ ...body, cached: true }), {
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'SHORT_TERM_HIT' }
        });
    }

    // 2. Smart Fetch Layer: Single-Flight + 3x Retry (Phase 3 & 4)
    if (!pendingFetch) {
        const apiKey = (env.FIXER_API_KEY || env.CF_FIXER_KEY || "").trim();
        const fixerUrl = `http://data.fixer.io/api/latest?access_key=${apiKey}`;
        pendingFetch = fetchFixerWithRetry(fixerUrl);
        ctx.waitUntil(pendingFetch.finally(() => { pendingFetch = null; }));
    }

    try {
        const freshData = await pendingFetch;
        
        // 3. Normalization Engine (Phase 6)
        const normalized = normalizeRates(freshData.rates, base);
        
        const responseData = {
            success: true,
            base: base,
            rates: normalized,
            timestamp: Date.now(),
            source: "fixer",
            cached: false
        };

        const response = new Response(JSON.stringify(responseData), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${SHORT_TTL}`,
                'Access-Control-Allow-Origin': '*'
            }
        });

        // Update caches (Phase 2)
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        if (env.DB) {
            ctx.waitUntil(env.DB.prepare(`
                REPLACE INTO rates_cache (base_currency, rates_json, updated_at) 
                VALUES ('EUR', ?, ?)
            `).bind(JSON.stringify(freshData.rates), Date.now()).run());
        }

        return response;

    } catch (err) {
        console.error("Worker Self-Healing Fallback:", err.message);

        // 4. Self-Healing: D1 Backup Cache (Phase 4 & 5)
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
                    stale: true,
                    cached: true
                }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // Safe Fallback (Phase 4.3)
        return new Response(JSON.stringify({
            success: false,
            error: "Rates unavailable",
            timestamp: Date.now()
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

/**
 * Normalization Engine: Scaling EUR to any requested base (Phase 6)
 */
function normalizeRates(rates, targetBase) {
    const eurToBase = rates[targetBase] || 1;
    const normalized = {};
    for (const [cur, val] of Object.entries(rates)) {
        normalized[cur] = parseFloat((val / eurToBase).toFixed(4));
    }
    return normalized;
}

/**
 * Smart Fetch with 3x Retry & 3s Timeout (Phase 3 & 4)
 */
async function fetchFixerWithRetry(url) {
    for (let i = 1; i <= 3; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000); // 3s Timeout
            
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.rates) return { rates: data.rates };
                throw new Error(data.error?.info || "Invalid Data");
            }
        } catch (e) {
            if (i === 3) throw e;
            await new Promise(r => setTimeout(r, 1000 * i)); // Exponential backoff
        }
    }
}
