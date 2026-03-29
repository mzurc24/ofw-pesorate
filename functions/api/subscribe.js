/**
 * /api/subscribe
 * User-facing Rate Alert Subscription Service.
 * Allows users to set thresholds and provide a webhook URL for notifications.
 */

export async function onRequest(context) {
    const { request, env } = context;

    // Handle Preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-user-id'
            }
        });
    }

    const userId = request.headers.get('x-user-id') || 'anon';

    if (request.method === 'POST') {
        return handleSubscribe(request, env, userId);
    }

    if (request.method === 'GET') {
        return handleList(env, userId);
    }

    return new Response('Method not allowed', { status: 405 });
}

async function handleSubscribe(request, env, userId) {
    try {
        const body = await request.json();
        const { base, target, threshold, direction, webhook } = body;

        // 1. Validation
        if (!base || !target || !threshold || !direction || !webhook) {
            return jsonResponse({ status: 'error', message: 'Missing required fields' }, 400);
        }

        if (isNaN(parseFloat(threshold))) {
            return jsonResponse({ status: 'error', message: 'Threshold must be a number' }, 400);
        }

        if (!webhook.startsWith('https://discord.com/api/webhooks/') && !webhook.startsWith('https://hooks.slack.com/services/')) {
            return jsonResponse({ status: 'error', message: 'Only Discord or Slack webhooks are supported for security.' }, 400);
        }

        // 2. Persist to D1
        const id = crypto.randomUUID();
        await env.DB.prepare(`
            INSERT INTO alert_subscriptions (id, user_id, base_currency, target_currency, threshold, direction, webhook_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, userId, base, target, parseFloat(threshold), direction, webhook, Date.now()).run();

        return jsonResponse({ 
            status: 'success', 
            message: 'Subscription active! We will notify you when the rate hits your threshold.',
            id: id 
        });

    } catch (e) {
        return jsonResponse({ status: 'error', message: e.message }, 500);
    }
}

async function handleList(env, userId) {
    try {
        const { results } = await env.DB.prepare(
            "SELECT id, base_currency, target_currency, threshold, direction, status FROM alert_subscriptions WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(userId).all();

        return jsonResponse({ status: 'success', subscriptions: results });
    } catch (e) {
        return jsonResponse({ status: 'error', message: e.message }, 500);
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
