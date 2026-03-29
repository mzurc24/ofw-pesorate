/**
 * /api/admin/metrics
 * Returns analytics data: 7-day trends, country breakdown, currency snapshots.
 * Security: Bearer Token Auth + Rate Limiting
 * All queries are independently wrapped for resilience.
 */

const rateLimitMap = new Map();

function sanitizeString(str) {
    if (!str) return '';
    return str.substring(0, 100).replace(/[<>"'&]/g, "");
}

export async function onRequest(context) {
    const { request, env } = context;

    // 1. Rate Limiting
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

    // 2. Auth
    const authHeader = request.headers.get('Authorization') || '';
    const token = sanitizeString(authHeader.replace('Bearer ', ''));

    if (!token || token !== env.CF_ADMIN_TOKEN) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!env.DB) {
        return Response.json({ error: 'Database not available' }, { status: 500 });
    }

    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    let newUsers7d = 0;
    let conversions7d = 0;
    let popularPairs = [];
    let dailyData = [];
    let countryBreakdown = [];
    let currencyTrends = [];

    // Build 7-day date map
    const dailyMap = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(now - i * 86400000);
        const dateString = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        dailyMap[dateString] = { conversions: 0 };
    }

    // 3. Run all queries independently (each wrapped in try/catch)

    // New users (7d)
    try {
        const result = await env.DB.prepare(
            "SELECT COUNT(*) as count FROM users WHERE first_seen >= ?"
        ).bind(sevenDaysAgo).first();
        newUsers7d = result?.count || 0;
    } catch (e) { console.error('Metrics: newUsers query failed:', e.message); }

    // Recent conversions (7d)
    try {
        const result = await env.DB.prepare(
            "SELECT COUNT(*) as count FROM conversions WHERE timestamp >= ?"
        ).bind(sevenDaysAgo).first();
        conversions7d = result?.count || 0;
    } catch (e) { console.error('Metrics: conversions query failed:', e.message); }

    // Popular pairs
    try {
        const result = await env.DB.prepare(`
            SELECT from_currency, to_currency, COUNT(*) as count 
            FROM conversions 
            WHERE timestamp >= ?
            GROUP BY from_currency, to_currency 
            ORDER BY count DESC 
            LIMIT 5
        `).bind(sevenDaysAgo).all();
        popularPairs = result?.results || [];
    } catch (e) { console.error('Metrics: popularPairs query failed:', e.message); }

    // Daily conversions breakdown
    try {
        const result = await env.DB.prepare(
            "SELECT timestamp FROM conversions WHERE timestamp >= ?"
        ).bind(sevenDaysAgo).all();

        if (result?.results) {
            result.results.forEach(row => {
                const d = new Date(row.timestamp);
                const dateString = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                if (dailyMap[dateString]) dailyMap[dateString].conversions++;
            });
        }
    } catch (e) { console.error('Metrics: dailyConversions query failed:', e.message); }

    dailyData = Object.keys(dailyMap).sort().map(date => ({
        date,
        conversions: dailyMap[date].conversions
    }));

    // Country breakdown (users per country)
    try {
        const countryUsers = await env.DB.prepare(`
            SELECT country, COUNT(*) as user_count FROM users
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY user_count DESC
        `).all();

        if (countryUsers?.results?.length) {
            // Get conversion counts per country (simpler query, no JOIN)
            let convMap = {};
            try {
                const countryConv = await env.DB.prepare(`
                    SELECT u.country, COUNT(*) as conv_count
                    FROM users u
                    INNER JOIN conversions c ON c.user_id = u.id
                    WHERE c.timestamp >= ? AND u.country IS NOT NULL AND u.country != ''
                    GROUP BY u.country
                `).bind(sevenDaysAgo).all();
                if (countryConv?.results) {
                    countryConv.results.forEach(r => { convMap[r.country] = r.conv_count; });
                }
            } catch (e) { 
                console.error('Metrics: countryConversions query failed:', e.message);
                // Continue without conversion data
            }

            const totalConv = Object.values(convMap).reduce((a, b) => a + b, 0) || 1;
            countryBreakdown = countryUsers.results.map(r => ({
                country: r.country,
                users: r.user_count,
                conversions: convMap[r.country] || 0,
                conversion_rate: Math.round(((convMap[r.country] || 0) / totalConv) * 100)
            }));
        }
    } catch (e) { console.error('Metrics: countryBreakdown query failed:', e.message); }

    // 7-day currency trends from snapshots (with live auto-seed fallback)
    try {
        const snapshots = await env.DB.prepare(`
            SELECT date, snapshot_json FROM currency_snapshots 
            WHERE timestamp >= ? 
            ORDER BY date ASC
        `).bind(sevenDaysAgo).all();

        if (snapshots?.results) {
            currencyTrends = snapshots.results.map(row => {
                try {
                    const data = JSON.parse(row.snapshot_json);
                    return { date: row.date, snapshot: data.snapshot || [] };
                } catch (e) {
                    return { date: row.date, snapshot: [] };
                }
            });
        }

        // Auto-seed today's snapshot from live rates_cache if not yet saved
        const today = new Date().toISOString().split('T')[0];
        const hasTodayEntry = currencyTrends.some(t => t.date === today);

        if (!hasTodayEntry && env.DB) {
            try {
                const ratesRow = await env.DB.prepare(
                    "SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'"
                ).first();

                if (ratesRow) {
                    const { calculateRate } = await import('../rates.js');
                    const allRates = JSON.parse(ratesRow.rates_json);

                    const SNAPSHOT_CURRENCIES = [
                        'SAR','AED','QAR','KWD','OMR','BHD','GBP','EUR','CHF',
                        'NOK','SEK','SGD','HKD','MYR','TWD','JPY','KRW','CNY',
                        'THB','USD','CAD','MXN','AUD','NZD'
                    ];

                    const liveSnapshot = SNAPSHOT_CURRENCIES.map(cur => ({
                        pair: `${cur}_PHP`,
                        rate: calculateRate(allRates, cur, 'PHP')
                    }));

                    // Push to trends array for this response
                    currencyTrends.push({ date: today, snapshot: liveSnapshot, isLive: true });

                    // Also silently persist to DB so subsequent calls are faster
                    try {
                        const snapId = crypto.randomUUID();
                        const snapData = JSON.stringify({ date: today, snapshot: liveSnapshot, source: 'auto_live', timestamp: new Date().toISOString() });
                        await env.DB.prepare(`
                            INSERT INTO currency_snapshots (id, date, snapshot_json, source, timestamp)
                            VALUES (?, ?, ?, 'auto_live', ?)
                            ON CONFLICT(date) DO NOTHING
                        `).bind(snapId, today, snapData, Date.now()).run();
                    } catch (_) { /* non-fatal */ }
                }
            } catch (seedErr) {
                console.warn('Metrics: live seed fallback failed (non-fatal):', seedErr.message);
            }
        }
    } catch (e) { console.error('Metrics: currencyTrends query failed:', e.message); }

    let socialTrafficData = {
        total_visits: 0,
        platforms: []
    };
    try {
        const socialResult = await env.DB.prepare(`
            SELECT platform, 
                   COUNT(*) as clicks,
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM social_traffic
            WHERE timestamp >= ?
            GROUP BY platform
            ORDER BY clicks DESC
        `).bind(sevenDaysAgo).all();

        if (socialResult?.results) {
            socialTrafficData.platforms = socialResult.results.map(p => ({
                platform: p.platform,
                name: p.platform, // Alias
                clicks: p.clicks,
                failed_count: p.failed_count
            }));
            socialTrafficData.total_visits = socialResult.results.reduce((acc, row) => acc + row.clicks, 0);
        }
    } catch (e) {
        console.error('Metrics: socialAnalytics query failed:', e.message);
    }

    // DevOps & Reliability Trends (Hourly Checks)
    let devopsTrend = [];
    try {
        const result = await env.DB.prepare(`
            SELECT status, actions_taken, timestamp 
            FROM devops_audit 
            WHERE timestamp >= datetime('now', '-24 hours')
            ORDER BY timestamp ASC
        `).all();
        devopsTrend = result?.results || [];
    } catch (e) {
        console.error('Metrics: devopsTrend query failed:', e.message);
    }

    // Credit Usage Trend (30 days)
    let usageTrend = [];
    try {
        const result = await env.DB.prepare(`
            SELECT month as date, fixer_calls as credits_used
            FROM api_usage
            ORDER BY month DESC
            LIMIT 30
        `).all();
        usageTrend = result?.results || [];
    } catch (e) {
        console.error('Metrics: usageTrend query failed:', e.message);
    }

    // 4. Return all data
    return Response.json({
        metrics: {
            newUsers7d,
            conversions7d,
            creditsUsedToday: usageTrend[0]?.credits_used || 0
        },
        popularPairs,
        daily: dailyData,
        countryBreakdown,
        currencyTrends,
        socialTraffic: socialTrafficData,
        healingLogs,
        devopsTrend,
        usageTrend
    }, {
        headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Content-Type': 'application/json'
        }
    });
}
/ /   D e p l o y m e n t   P u s h :   2 0 2 6 - 0 3 - 2 9 - 1 5 2 1  
 