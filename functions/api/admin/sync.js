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

    // 2. Fetch Fresh Rates from Fixer
    const apiKey = env.CF_FIXER_KEY || '566e5ce2bbb50f23733c34b6b07146b2';
    const baseUrl = 'http://data.fixer.io/api/latest';
    
    try {
        const response = await fetch(`${baseUrl}?access_key=${apiKey}`);
        if (!response.ok) throw new Error(`Fixer API returned ${response.status}`);
        
        const data = await response.json();
        if (!data.success || !data.rates) {
            throw new Error(data.error?.info || 'Fixer sync failed');
        }

        const nowStamp = Date.now();
        const ratesJson = JSON.stringify(data.rates);

        // 3. Update D1 Cache
        if (env.DB) {
            await safeDbRun(env, `
                INSERT INTO rates_cache (base_currency, rates_json, updated_at)
                VALUES ('EUR', ?, ?)
                ON CONFLICT(base_currency) DO UPDATE SET
                    rates_json = EXCLUDED.rates_json,
                    updated_at = EXCLUDED.updated_at
            `, ratesJson, nowStamp);
        }

        return new Response(JSON.stringify({
            status: 'success',
            message: 'Sync completed successfully',
            timestamp: nowStamp,
            count: Object.keys(data.rates).length
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error('Sync process failed:', e);
        return new Response(JSON.stringify({
            status: 'error',
            message: e.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
