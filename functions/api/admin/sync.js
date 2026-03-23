/**
 * /api/admin/sync
 * Manually or via Cron trigger a fresh rate sync from Fixer.
 * Updates D1 cache and returns status.
 * Security: Bearer Token Auth
 */

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
    // 1. Security Check
    const url = new URL(request.url);
    const rawToken = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const validToken = env.CF_ADMIN_TOKEN || 'ofwAk026';

    if (!rawToken || rawToken !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 2. Throttling Check (1 call per 24h)
    const lastFetch = await env.KV.get("last_fetch");
    const now = Date.now();
    const CACHE_TTL = 86400;

    if (lastFetch && (now - parseInt(lastFetch)) / 1000 < CACHE_TTL) {
        return new Response(JSON.stringify({
            status: 'error',
            message: 'Sync already performed within the last 24 hours. Rate limit safety active.'
        }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 3. Fetch Fresh Rates from Fixer
    const apiKey = env.CF_FIXER_KEY || 'c056294df71360e7b8e84205ef080e47';
    const baseUrl = 'http://data.fixer.io/api/latest';
    
    try {
        const response = await fetch(`${baseUrl}?access_key=${apiKey}`);
        if (!response.ok) throw new Error(`Fixer API returned ${response.status}`);
        
        const data = await response.json();
        if (!data.success || !data.rates) {
            throw new Error(data.error?.info || 'Fixer sync failed');
        }

        const ratesJson = JSON.stringify(data.rates);

        // 4. Update KV and D1 Cache
        if (env.KV) {
            await env.KV.put("rates_cache", JSON.stringify(data), { expirationTtl: CACHE_TTL });
            await env.KV.put("last_fetch", now.toString());
        }

        if (env.DB) {
            await safeDbRun(env, `
                INSERT INTO rates_cache (base_currency, rates_json, updated_at)
                VALUES ('EUR', ?, ?)
                ON CONFLICT(base_currency) DO UPDATE SET
                    rates_json = EXCLUDED.rates_json,
                    updated_at = EXCLUDED.updated_at
            `, ratesJson, now);
            
            // Log to api_logs
            await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "success").run();
        }

        return new Response(JSON.stringify({
            status: 'success',
            message: 'Sync completed successfully (Manual Trigger)',
            timestamp: now,
            count: Object.keys(data.rates).length
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error('Sync process failed:', e);
        if (env.DB) {
            await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "fail").run();
        }
        return new Response(JSON.stringify({
            status: 'error',
            message: e.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
