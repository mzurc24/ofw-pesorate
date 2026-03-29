export async function onRequest(context) {
    const { request, env } = context;

    // Optional basic auth check (same as other admin APIs)
    const url = new URL(request.url);
    const validToken = (env.CF_ADMIN_TOKEN || '').trim();
    const authHeader = request.headers.get('Authorization');
    const urlToken = url.searchParams.get('t');

    let isAuthorized = false;
    if (validToken) {
        if (urlToken === validToken) isAuthorized = true;
        else if (authHeader && authHeader.replace('Bearer ', '').trim() === validToken) isAuthorized = true;
    }

    if (!isAuthorized) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), { status: 401 });
    }

    try {
        await env.DB.batch([
            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_fail_count', '0')"),
            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('td_disabled_until', '0')"),
            env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/reset_breaker', 'manual_reset')
        ]);
        
        return new Response(JSON.stringify({
            status: 'success',
            message: 'Circuit breaker has been successfully reset. Twelve Data engine is ready.'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        
    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500 });
    }
}
