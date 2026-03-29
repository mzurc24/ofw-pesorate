/**
 * /api/user/preferences
 * Manage user currency and localization preferences.
 */

export async function onRequest(context) {
    const { request, env } = context;
    const userId = request.headers.get('x-user-id') || 'anon';

    // CORS Preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-user-id'
            }
        });
    }

    if (request.method === 'POST') {
        try {
            const { preferred_currency, home_currency } = await request.json();
            if (!preferred_currency) {
                return jsonResponse({ status: 'error', message: 'Preferred currency required' }, 400);
            }

            await env.DB.prepare(`
                INSERT INTO user_preferences (user_id, preferred_currency, home_currency, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    preferred_currency = EXCLUDED.preferred_currency,
                    home_currency = COALESCE(EXCLUDED.home_currency, home_currency),
                    updated_at = EXCLUDED.updated_at
            `).bind(userId, preferred_currency, home_currency || null, Date.now()).run();

            return jsonResponse({ status: 'success', message: 'Preferences updated' });
        } catch (e) {
            return jsonResponse({ status: 'error', message: e.message }, 500);
        }
    }

    if (request.method === 'GET') {
        try {
            const prefs = await env.DB.prepare(
                "SELECT preferred_currency, home_currency FROM user_preferences WHERE user_id = ?"
            ).bind(userId).first();

            return jsonResponse({ status: 'success', preferences: prefs || null });
        } catch (e) {
            return jsonResponse({ status: 'error', message: e.message }, 500);
        }
    }

    return new Response('Method not allowed', { status: 405 });
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
