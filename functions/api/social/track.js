/**
 * POST /api/social/track
 * Logs a new social event (click/visit) into the social_events table.
 * Zero-human-intervention tracking endpoint.
 */

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    if (request.method !== 'POST') {
        return new Response(null, { status: 405 });
    }

    try {
        const data = await request.json();
        const platform = data.platform || 'Unknown';
        const country = (request.cf?.country || 'XX').toUpperCase();
        
        if (env.DB) {
            await env.DB.prepare(`
                INSERT INTO social_traffic (id, platform, country, device_type, status, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                crypto.randomUUID(),
                platform,
                country,
                'Desktop', // simple beacon fallback
                'success',
                Date.now()
            ).run();
        }

        return Response.json({ success: true, platform });

    } catch (e) {
        console.error('Track API failed:', e.message);
        return Response.json({ error: e.message }, { status: 500 });
    }
}
