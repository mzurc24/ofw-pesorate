/**
 * /api/social-event
 * Receives beacon events from the frontend when a social webview fails to load.
 * Used to accurately track failed_count in the social_traffic dashboard.
 * No auth required — accepts POST only from navigator.sendBeacon().
 */

export async function onRequest(context) {
    const { request, env } = context;

    // Only accept POST/beacon
    if (request.method !== 'POST') {
        return new Response(null, { status: 204 });
    }

    let eventType = 'load_failed';
    try {
        const body = await request.text();
        if (body) {
            const parsed = JSON.parse(body);
            eventType = parsed.event || 'load_failed';
        }
    } catch {
        // ignore parse errors — beacon payloads can be malformed
    }

    const userAgent = request.headers.get('User-Agent') || '';
    const referer   = request.headers.get('Referer') || '';
    const uaLow     = userAgent.toLowerCase();
    const country   = (request.cf?.country || 'XX').toUpperCase();

    // Detect platform from UA/referer
    let platform = 'Unknown';
    if (uaLow.includes('fbav') || uaLow.includes('fban') || referer.includes('facebook.com') || referer.includes('fb.com')) {
        platform = 'Facebook';
    } else if (uaLow.includes('instagram') || referer.includes('instagram.com')) {
        platform = 'Instagram';
    } else if (uaLow.includes('fbmv') || uaLow.includes('messenger')) {
        platform = 'Messenger';
    } else if (uaLow.includes('twitterandroid') || uaLow.includes('twitter/') || referer.includes('twitter.com') || referer.includes('t.co')) {
        platform = 'Twitter';
    } else if (referer.includes('linkedin.com')) {
        platform = 'LinkedIn';
    }

    let deviceType = 'Desktop';
    if (uaLow.includes('mobi')) deviceType = 'Mobile';
    else if (uaLow.includes('tablet')) deviceType = 'Tablet';

    // Log to DB
    if (env.DB) {
        try {
            await env.DB.prepare(`
                INSERT INTO social_traffic (id, platform, country, device_type, status, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                crypto.randomUUID(),
                platform,
                country,
                deviceType,
                'failed',
                Date.now()
            ).run();

            // Self-Healing Logic: Check failure frequency and trigger CDN purge
            if (platform !== 'Unknown') {
                const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
                const { count } = await env.DB.prepare(`
                    SELECT COUNT(*) as count FROM social_traffic 
                    WHERE status = 'failed' AND timestamp > ? AND platform = ?
                `).bind(tenMinutesAgo, platform).first();

                if (count >= 5) {
                    await triggerSelfHealing(context, platform, count);
                }
            }
        } catch (e) {
            console.error('social-event: DB/Healing failed:', e.message);
        }
    }

    // Always return 204 — sendBeacon ignores the response body anyway
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
    });
}

/**
 * Automated Self-Healing: Purge Cloudflare Cache
 */
async function triggerSelfHealing(context, platform, failureCount) {
    const { env } = context;
    const zoneId = env.CF_ZONE_ID;
    const apiToken = env.CF_API_TOKEN;

    // Check if we've healed recently to avoid infinite purge loops
    const lastHealing = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_social_healing'").first();
    const now = Date.now();
    
    if (lastHealing && (now - parseInt(lastHealing.value) < 15 * 60 * 1000)) {
        return; // Already healed in the last 15 mins
    }

    let healStatus = 'skipped_no_creds';
    let details = 'Missing CF_ZONE_ID or CF_API_TOKEN';

    if (zoneId && apiToken) {
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
                healStatus = 'success';
                details = `Purged cache for ${platform} (${failureCount} failures detected)`;
            } else {
                healStatus = 'error';
                details = `CF API Error: ${res.status}`;
            }
        } catch (e) {
            healStatus = 'error';
            details = `Fetch Error: ${e.message}`;
        }
    }

    // Log the healing event
    await env.DB.prepare("INSERT INTO healing_logs (id, action, platform, status, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), 'cdn_purge', platform, healStatus, details, now)
        .run();

    // Update last healing time
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind('last_social_healing', now.toString())
        .run();
}
