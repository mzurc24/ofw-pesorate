/**
 * /api/social
 * Returns social media analytics from the social_events table.
 * Zero-human-intervention healing endpoint.
 * Features: Auto-schema creation, self-seeding, and fallback injection.
 */

export async function onRequest(context) {
    const { env } = context;

    if (!env.DB) {
        return Response.json({ status: 'DEGRADED', platforms: getFallbackData() }, { status: 200 });
    }

    try {
        // Self-Healing DB: Ensure social_traffic exists (rate.js typically creates it on first write, but this is safe)
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS social_traffic (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                country TEXT,
                device_type TEXT,
                status TEXT,
                timestamp INTEGER NOT NULL
            )
        `).run();

        const result = await env.DB.prepare(`
            SELECT platform, 
                   COUNT(*) as count,
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM social_traffic 
            GROUP BY platform
            ORDER BY count DESC
        `).all();

        const platforms = result?.results || [];
        return Response.json({ 
            status: platforms.length > 0 ? 'HEALTHY' : 'DEGRADED', 
            platforms: platforms.map(p => ({ 
                platform: p.platform, 
                count: p.count, 
                failed_count: p.failed_count,
                name: p.platform, // Alias for backward compatibility in renderSocialAnalytics
                clicks: p.count   // Alias for backward compatibility
            })),
            timestamp: new Date().toISOString()
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60, s-maxage=60',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (e) {
        console.error('Social API Critical Error:', e.message);
        return Response.json({ status: 'DEGRADED', platforms: getFallbackData(), error: e.message }, { status: 200 });
    }
}

function getFallbackData() {
    return [
        { "name": "Facebook", "clicks": 0 },
        { "name": "WhatsApp", "clicks": 0 },
        { "name": "Telegram", "clicks": 0 }
    ];
}
