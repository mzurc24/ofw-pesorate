import { checkAdminAuth } from './_auth.js';

export async function onRequest(context) {

    const { request, env } = context;

    // 1. Security Check
    const auth = checkAdminAuth(request, env);
    if (!auth.authorized) {
        // Fallback for URL parameter 't' for quick diagnostic resets
        const urlToken = new URL(request.url).searchParams.get('t');
        const validToken = (env.CF_ADMIN_TOKEN || '').trim();
        if (!validToken || urlToken !== validToken) return auth.response;
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
