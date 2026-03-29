/**
 * /api/social
 * Public endpoint for social traffic metrics (Aggregated).
 * Prevents HTML fallback in SPA routing.
 */

export async function onRequest(context) {
    const { env } = context;

    try {
        const stats = await env.DB.prepare(`
            SELECT platform, count(*) as count 
            FROM social_traffic 
            WHERE timestamp >= datetime('now', '-7 days') 
            GROUP BY platform
        `).all();

        return new Response(JSON.stringify({
            status: 'success',
            data: stats.results || [],
            timestamp: Date.now()
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (e) {
        // Fallback to empty success to keep UI stable
        return new Response(JSON.stringify({ status: 'success', data: [], note: e.message }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
