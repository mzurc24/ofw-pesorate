/**
 * /api/admin/heal-social
 * Explicitly triggers a Cloudflare CDN purge and resets social failure state.
 * Requires: Bearer Token Auth (env.CF_ADMIN_TOKEN)
 */

export async function onRequest(context) {
    const { request, env } = context;

    // 1. Auth check
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const validToken = (env.CF_ADMIN_TOKEN || 'ofwAk026').trim();

    if (!token || token !== validToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (request.method !== 'POST') {
        return new Response(null, { status: 405 });
    }

    const zoneId = env.CF_ZONE_ID;
    const apiToken = env.CF_API_TOKEN;
    const now = Date.now();

    if (!zoneId || !apiToken) {
        return new Response(JSON.stringify({ 
            status: 'error', 
            message: 'Cloudflare API credentials (CF_ZONE_ID, CF_API_TOKEN) not configured.' 
        }), { status: 400 });
    }

    let success = false;
    let details = '';

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: [
                    'https://ofwpesorate.madzlab.site/',
                    'https://ofwpesorate.madzlab.site/index.html',
                    'https://ofwpesorate.madzlab.site/app.js'
                ]
            })
        });

        if (res.ok) {
            success = true;
            details = 'Manual CDN Purge successful';
        } else {
            details = `CF API Error: ${res.status}`;
        }
    } catch (e) {
        details = `Fetch error: ${e.message}`;
    }

    // Log the event
    if (env.DB) {
        await env.DB.prepare("INSERT INTO healing_logs (id, action, platform, status, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), 'manual_purge', 'Global', success ? 'success' : 'error', details, now)
            .run();
            
        // Reset the automated healing cooldown
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .bind('last_social_healing', now.toString())
            .run();
    }

    return new Response(JSON.stringify({ status: success ? 'success' : 'error', details }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
