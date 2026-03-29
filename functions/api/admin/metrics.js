/**
 * /api/admin/metrics
 * Returns real-time usage metrics and system health.
 * Security: Bearer Token Auth
 */
import { checkAdminAuth } from './_auth.js';

export async function onRequest(context) {
    const { request, env } = context;

    // 1. Security Check
    const auth = checkAdminAuth(request, env);
    if (!auth.authorized) return auth.response;

    try {
        const results = await env.DB.batch([
            env.DB.prepare("SELECT count(*) as total_users FROM users"),
            env.DB.prepare("SELECT count(*) as total_conversions FROM conversions"),
            env.DB.prepare("SELECT count(*) as total_alerts FROM alert_subscriptions"),
            env.DB.prepare("SELECT status, count(*) as count FROM social_traffic GROUP BY status"),
            env.DB.prepare("SELECT fixer_calls FROM api_usage ORDER BY month DESC LIMIT 30")
        ]);

        return new Response(JSON.stringify({
            status: 'success',
            metrics: {
                users: results[0].results[0].total_users,
                conversions: results[1].results[0].total_conversions,
                alerts: results[2].results[0].total_alerts,
                social: results[3].results,
                usage: results[4].results
            },
            timestamp: Date.now()
        }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
