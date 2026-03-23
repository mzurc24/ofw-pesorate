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
    const { request, env } = context;
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
    const CACHE_TTL = 86400;
    const lastFetchRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
    const now = Date.now();

    if (lastFetchRow && (now - parseInt(lastFetchRow.value)) / 1000 < CACHE_TTL) {
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

        // 4. Update D1 Cache
        if (env.DB) {
            await env.DB.batch([
                env.DB.prepare("INSERT INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?) ON CONFLICT(base_currency) DO UPDATE SET rates_json = excluded.rates_json, updated_at = excluded.updated_at").bind(ratesJson, now),
                env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_fixer_fetch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now.toString()),
                env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "success")
            ]);
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
