// In-memory rate limiting map for admin isolate
const rateLimitMap = new Map();

function sanitizeString(str) {
    if (!str) return '';
    return str.substring(0, 100).replace(/[<>"'&]/g, "");
}

export async function onRequest(context) {
    const { request, env } = context;
    
    // 1. Admin Rate Limiting Check (prevent brute force)
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const now = Date.now();
    const userLimit = rateLimitMap.get(ip) || { count: 0, time: now };
    
    if (now - userLimit.time > 60000) {
        userLimit.count = 1;
        userLimit.time = now;
    } else {
        userLimit.count++;
        if (userLimit.count > 10) {
            return Response.json({ error: 'Too Many Requests' }, { status: 429 });
        }
    }
    rateLimitMap.set(ip, userLimit);

    // 2. Verify CF_ADMIN_TOKEN
    const url = new URL(request.url);
    const rawToken = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const token = sanitizeString(rawToken);

    if (token !== env.CF_ADMIN_TOKEN) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    try {
        // Query D1...
        const newUsersResult = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM users WHERE first_seen >= ?
        `).bind(sevenDaysAgo).first();
        
        const recentConversionsResult = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM conversions WHERE timestamp >= ?
        `).bind(sevenDaysAgo).first();

        const popularPairsResult = await env.DB.prepare(`
            SELECT from_currency, to_currency, COUNT(*) as count 
            FROM conversions 
            WHERE timestamp >= ?
            GROUP BY from_currency, to_currency 
            ORDER BY count DESC 
            LIMIT 5
        `).bind(sevenDaysAgo).all();

        const dailyConversions = await env.DB.prepare(`
            SELECT timestamp FROM conversions WHERE timestamp >= ?
        `).bind(sevenDaysAgo).all();

        const dailyMap = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(now - i * 86400000);
            const dateString = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            dailyMap[dateString] = { conversions: 0 };
        }

        if (dailyConversions.results) {
            dailyConversions.results.forEach(row => {
                const d = new Date(row.timestamp);
                const dateString = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                if (dailyMap[dateString]) dailyMap[dateString].conversions++;
            });
        }
        
        return Response.json({
            metrics: {
                newUsers7d: newUsersResult?.count || 0,
                conversions7d: recentConversionsResult?.count || 0,
            },
            popularPairs: popularPairsResult?.results || [],
            daily: Object.keys(dailyMap).sort().map(date => ({
                date,
                conversions: dailyMap[date].conversions
            }))
        }, {
            headers: {
                 // Cache admin metrics at edge for 60 seconds to avoid repeating heavy D1 queries
                'Cache-Control': 'public, max-age=60, s-maxage=60'
            }
        });

    } catch (e) {
        console.error('Admin API error', e);
        return Response.json({ error: 'Database query failed' }, { status: 500 });
    }
}
