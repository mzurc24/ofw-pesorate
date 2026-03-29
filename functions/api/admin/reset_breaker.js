export async function onRequest(context) {
    const { env } = context;
    if (!env.DB) return Response.json({ status: 'error', message: 'No DB' });
    
    await env.DB.batch([
        env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')"),
        env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')"),
        env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)")
               .bind('/api/admin/reset_breaker', 'manual_reset')
    ]);

    return Response.json({ status: 'success', message: 'Twelve Data circuit breaker RESET. Sync is now enabled.' });
}
