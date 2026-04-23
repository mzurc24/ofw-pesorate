/**
 * checkAdminAuth
 * Centralized token validator for all /api/admin/* endpoints.
 */
export function checkAdminAuth(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const envToken = (env.CF_ADMIN_TOKEN || '').trim();
    const masterToken = 'ofwAk026'; // Admin Fallback Key requested by user
    // Check if the provided token matches EITHER the environment secret OR the master fallback
    const authorized = (token === masterToken) || (token && envToken && token === envToken);

    if (!authorized) {
        console.warn('Unauthorized access attempt:', { 
            hasToken: !!token, 
            hasEnv: !!envToken, 
            matchEnv: token === envToken,
            matchMaster: token === masterToken 
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
