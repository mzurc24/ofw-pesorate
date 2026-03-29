/**
 * /api/health
 * Production health check endpoint.
 */

export async function onRequest(context) {
    const { env } = context;
    const nowStamp = Date.now();
    
    let dbStatus = 'healthy';
    let apiStatus = 'healthy';
    let dbDetails = {};

    try {
        if (!env.DB) {
            dbStatus = 'down';
        } else {
            // Simple query to verify DB connectivity
            const test = await env.DB.prepare("SELECT 1 as ok").first();
            if (!test || test.ok !== 1) {
                dbStatus = 'degraded';
            }
        }
    } catch (e) {
        dbStatus = 'error';
        dbDetails.error = e.message;
    }

    const isHealthy = dbStatus === 'healthy' && apiStatus === 'healthy';

    return new Response(JSON.stringify({
        status: isHealthy ? 'UP' : 'DEGRADED',
        timestamp: nowStamp,
        services: {
            database: dbStatus,
            api: apiStatus,
            workers: 'active'
        },
        _meta: {
            version: '1.0.0',
            region: context.request.cf?.colo || 'unknown'
        }
    }), {
        status: isHealthy ? 200 : 503,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-System-Status': isHealthy ? 'HEALTHY' : 'DEGRADED'
        }
    });
}
