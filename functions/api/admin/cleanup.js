/**
 * /api/admin/cleanup
 * 7-Day Data Retention Cleanup trigger.
 * Deletes records older than 7 days from snapshots, conversions, and cache.
 * Security: Bearer Token Auth
 */

export async function onRequest(context) {
    const { request, env } = context;

    // 1. Security Check
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const validToken = (env.CF_ADMIN_TOKEN || '').trim();

    if (!token || token !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (!env.DB) return new Response(JSON.stringify({ status: 'error', message: 'Database missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });

    const startTime = Date.now();
    const cutoff = startTime - (7 * 24 * 60 * 60 * 1000); // 7 days ago in ms

    try {
        // 2. Execute Cleanup Queries
        const results = await env.DB.batch([
            env.DB.prepare("DELETE FROM currency_snapshots WHERE timestamp < ?").bind(cutoff),
            env.DB.prepare("DELETE FROM conversions WHERE timestamp < ?").bind(cutoff),
            env.DB.prepare("DELETE FROM rates_cache WHERE updated_at < ?").bind(cutoff),
            env.DB.prepare("DELETE FROM health_logs WHERE timestamp < datetime('now', '-7 days')"),
            env.DB.prepare("DELETE FROM api_logs WHERE timestamp < datetime('now', '-7 days')")
        ]);

        const totalDeleted = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
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
            `Execution took ${duration}ms. Snapshots: ${results[0].meta?.changes || 0}, Conversions: ${results[1].meta?.changes || 0}, Cache: ${results[2].meta?.changes || 0}, Health: ${results[3].meta?.changes || 0}, Logs: ${results[4].meta?.changes || 0}`
        ).run();

        return new Response(JSON.stringify({
            status: 'success',
            rows_deleted: totalDeleted,
            duration_ms: duration,
            cutoff_date: new Date(cutoff).toISOString()
        }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (e) {
        console.error('Cleanup process failed:', e);
        
        try {
            await env.DB.prepare(`
                INSERT INTO cleanup_logs (id, timestamp, rows_deleted, status, details)
                VALUES (?, ?, ?, ?, ?)
            `).bind(crypto.randomUUID(), Date.now(), 0, 'error', e.message).run();
        } catch (logErr) { console.error('Failed to log cleanup error:', logErr); }

        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
