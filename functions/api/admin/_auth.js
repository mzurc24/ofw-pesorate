/**
 * checkAdminAuth
 * Centralized token validator for all /api/admin/* endpoints.
 * Auth is validated ONLY against Cloudflare environment secrets.
 * No hardcoded fallback tokens — all credentials live in CF Pages secrets.
 */
export function checkAdminAuth(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const envToken = (env.CF_ADMIN_TOKEN || '').trim();

    // Token must be non-empty and match the CF Pages secret exactly
    const authorized = !!(token && envToken && token === envToken);

    if (!authorized) {
        console.warn('Unauthorized access attempt:', {
            hasToken: !!token,
            hasEnv: !!envToken,
            matched: false
        });

        return {
            authorized: false,
            response: new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            })
        };
    }

    return { authorized: true };
}
