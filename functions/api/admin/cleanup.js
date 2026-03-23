/**
 * /api/admin/cleanup
 * 7-Day Data Retention Cleanup trigger.
 * Deletes records older than 7 days from snapshots, conversions, and cache.
 * Security: Bearer Token Auth
 */

export async function onRequest(context) {
    const { request, env } = context;
    const authHeader = request.headers.get('Authorization');

    // 1. Security Check
    const token = authHeader?.replace('Bearer ', '');
    const queryToken = new URL(request.url).searchParams.get('token');
    const validToken = env.CF_ADMIN_TOKEN || 'ofwAk026';

    if ((!token || token !== validToken) && (!queryToken || queryToken !== validToken)) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (!env.DB) return new Response('Database missing', { status: 500 });

    const startTime = Date.now();
    const cutoff = startTime - (7 * 24 * 60 * 60 * 1000); // 7 days ago in ms

    try {
        // 2. Execute Cleanup Queries
        // We use batch to ensure atomicity and efficiency
        const results = await env.DB.batch([
            // Delete old snapshots
            env.DB.prepare("DELETE FROM currency_snapshots WHERE timestamp < ?").bind(cutoff),
            // Delete old conversions
            env.DB.prepare("DELETE FROM conversions WHERE timestamp < ?").bind(cutoff),
            // Delete stale cache entries (keeping only latest is handled by sync's ON CONFLICT, 
            // but this cleans up truly abandoned base currencies if they exist)
            env.DB.prepare("DELETE FROM rates_cache WHERE updated_at < ?").bind(cutoff)
        ]);

        const totalDeleted = results.reduce((sum, res) => sum + (res.meta.changes || 0), 0);
        const duration = Date.now() - startTime;

        // 3. Log Cleanup Results
        const logId = crypto.randomUUID();
        await env.DB.prepare(`
            INSERT INTO cleanup_logs (id, timestamp, rows_deleted, status, details)
            VALUES (?, ?, ?, ?, ?)
        `).bind(
            logId, 
            startTime, 
            totalDeleted, 
            'success', 
            `Execution took ${duration}ms. Snapshots: ${results[0].meta.changes}, Conversions: ${results[1].meta.changes}, Cache: ${results[2].meta.changes}`
        ).run();

        return new Response(JSON.stringify({
            status: 'success',
            rows_deleted: totalDeleted,
            duration_ms: duration,
            cutoff_date: new Date(cutoff).toISOString()
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        console.error('Cleanup process failed:', e);
        
        // Log Failure
        try {
            await env.DB.prepare(`
                INSERT INTO cleanup_logs (id, timestamp, rows_deleted, status, details)
                VALUES (?, ?, ?, ?, ?)
            `).bind(crypto.randomUUID(), Date.now(), 0, 'error', e.message).run();
        } catch (logErr) { console.error('Failed to log cleanup error:', logErr); }

        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
