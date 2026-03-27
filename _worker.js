/**
 * OFW PesoRate - Advanced Multi-Cache Worker
 * Phase 1-10 Implementation: Self-Healing, Dual-Cache, and Sync-Engine.
 * Implements: caches.default (10m) + D1 (24h) + Single-Flight Fetching.
 */

const SHORT_TTL = 600; // 10 minutes in seconds
const LONG_TTL = 86400; // 24 hours in seconds

// In-memory Promise memoization (Single-Flight Logic)
let pendingFetch = null;

// Emergency fallback rates (EUR-based)
const FALLBACK_RATES = {
    USD: 1.09, PHP: 64.0, SGD: 1.46, EUR: 1.00,
    SAR: 4.04, AED: 3.98, GBP: 0.86, JPY: 161.2
};

export default {
    /**
     * Phase 11: Scheduled Worker (Hourly Sync)
     */
    async scheduled(event, env, ctx) {
        console.log("CRON: Triggering hourly cache refresh & system validation...");
        const syncUrl = `https://ofw-pesorate.pages.dev/api/admin/sync?token=${env.CF_ADMIN_TOKEN}&force=true`;
        ctx.waitUntil(fetch(syncUrl));
    },

    /**
     * Phase 1-9: Unified Fetch Handler
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Standardize: Only handle /api/rates (Phase 1)
        if (url.pathname !== '/api/rates' && url.pathname !== '/api/rate-worker') {
            return next(); // Pass through to Functions/Static
        }

        const base = (url.searchParams.get('base') || 'USD').toUpperCase();
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), request);

        // 1. Dual Cache System: Short-term Check (Phase 2 & 5)
        let response = await cache.match(cacheKey);
        if (response) {
            const data = await response.json();
            return new Response(JSON.stringify({ ...data, cached: true, cache_type: 'short_term' }), {
                headers: { 'Content-Type': 'application/json', 'CF-Cache-Status': 'HIT' }
            });
        }

        // 2. Fetch Layer: Single-Flight + 3x Retry (Phase 3 & 4)
        if (!pendingFetch) {
            pendingFetch = fetchFixerWithRetry(env);
            ctx.waitUntil(pendingFetch.then(() => { pendingFetch = null; }));
        }

        try {
            const data = await pendingFetch;
            
            // 3. Normalization Engine: Dynamic Base Handling (Phase 6)
            const normalizedData = normalizeRates(data.rates, base);
            
            const finalResponseData = {
                success: true,
                base: base,
                rates: normalizedData,
                timestamp: Date.now(),
                source: "fixer",
                cached: false,
                _meta: { strategy: data.strategy }
            };

            const finalResponse = new Response(JSON.stringify(finalResponseData), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': `public, max-age=${SHORT_TTL}`,
                    'Access-Control-Allow-Origin': '*'
                }
            });

            // 4. Update Short-term Cache (Phase 2)
            ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
            
            return finalResponse;

        } catch (err) {
            console.error("Worker Error:", err.message);

            // 5. Phase 4: Self-Healing - Fallback to D1 (Backup Cache)
            const backup = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
            if (backup) {
                const cachedRates = JSON.parse(backup.rates_json);
                const normalized = normalizeRates(cachedRates, base);
                return new Response(JSON.stringify({
                    success: true,
                    base: base,
                    rates: normalized,
                    timestamp: backup.updated_at,
                    source: "d1_backup",
                    stale: true,
                    cached: true,
                    cache_type: 'long_term'
                }), { headers: { 'Content-Type': 'application/json' } });
            }

            // Phase 4.3: Absolute Safe Fallback
            return new Response(JSON.stringify({
                success: false,
                error: "Rates unavailable",
                fallback: true,
                rates: normalizeRates(FALLBACK_RATES, base)
            }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
    }
};

/**
 * Normalization Engine (Phase 6)
 * Handles EUR-based scaling to requested base currency.
 */
function normalizeRates(eurRates, targetBase) {
    const eurToBase = eurRates[targetBase] || 1;
    const normalized = {};
    for (const [cur, val] of Object.entries(eurRates)) {
        normalized[cur] = parseFloat((val / eurToBase).toFixed(4));
    }
    return normalized;
}

/**
 * Phase 4 & 9: Smart Fetch with 3x Retry & Error Handling
 */
async function fetchFixerWithRetry(env) {
    const apiKey = env.CF_FIXER_KEY || "c056294df71360e7b8e84205ef080e47";
    const fixerUrl = `http://data.fixer.io/api/latest?access_key=${apiKey}`;

    for (let i = 1; i <= 3; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000); // 3s Timeout (Phase 3)
            
            const res = await fetch(fixerUrl, { signal: controller.signal });
            clearTimeout(timeout);
            
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.rates) {
                    return { rates: data.rates, strategy: n === 1 ? 'fresh' : 'retry' };
                }
                throw new Error(data.error?.info || "Fixer Data Invalid");
            }
        } catch (e) {
            console.warn(`Retry ${i} failed:`, e.message);
            if (i === 3) throw e;
            await new Promise(r => setTimeout(r, 1000 * i));
        }
    }
}
