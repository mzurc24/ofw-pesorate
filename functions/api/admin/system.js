/**
 * /api/admin/system
 * Returns the current health and status of the currency system.
 * Includes API health, DB status, country analytics data.
 * Security: Bearer Token Auth
 */

const SUPPORTED_COUNTRIES = [
    { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
    { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    { code: 'QA', name: 'Qatar', currency: 'QAR' },
    { code: 'KW', name: 'Kuwait', currency: 'KWD' },
    { code: 'OM', name: 'Oman', currency: 'OMR' },
    { code: 'BH', name: 'Bahrain', currency: 'BHD' },
    { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
    { code: 'IT', name: 'Italy', currency: 'EUR' },
    { code: 'ES', name: 'Spain', currency: 'EUR' },
    { code: 'DE', name: 'Germany', currency: 'EUR' },
    { code: 'FR', name: 'France', currency: 'EUR' },
    { code: 'NL', name: 'Netherlands', currency: 'EUR' },
    { code: 'CH', name: 'Switzerland', currency: 'CHF' },
    { code: 'NO', name: 'Norway', currency: 'NOK' },
    { code: 'SE', name: 'Sweden', currency: 'SEK' },
    { code: 'SG', name: 'Singapore', currency: 'SGD' },
    { code: 'HK', name: 'Hong Kong', currency: 'HKD' },
    { code: 'MY', name: 'Malaysia', currency: 'MYR' },
    { code: 'TW', name: 'Taiwan', currency: 'TWD' },
    { code: 'JP', name: 'Japan', currency: 'JPY' },
    { code: 'KR', name: 'South Korea', currency: 'KRW' },
    { code: 'CN', name: 'China', currency: 'CNY' },
    { code: 'TH', name: 'Thailand', currency: 'THB' },
    { code: 'US', name: 'United States', currency: 'USD' },
    { code: 'CA', name: 'Canada', currency: 'CAD' },
    { code: 'MX', name: 'Mexico', currency: 'MXN' },
    { code: 'AU', name: 'Australia', currency: 'AUD' },
    { code: 'NZ', name: 'New Zealand', currency: 'NZD' }
];

export async function onRequest(context) {
    // 1. Security Check
    // Use consistent auth logic across all admin files and handle Fixer API limits in sync.js
    const { request, env } = context;
    const url = new URL(request.url);
    const rawToken = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const validToken = env.CF_ADMIN_TOKEN || 'ofwAk026';

    if (!rawToken || rawToken !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 2. Fetch Latest State from D1
    let rates = {};
    let lastUpdated = null;
    let lastCleanup = null;
    let strategy = 'unknown';
    let snapshotSaved = false;
    let dbStatus = 'down';
    let apiStatus = 'unknown';
    let apiResponseTime = null;
    let countryAnalytics = [];
    let totalUsers = 0;
    let totalConversions = 0;

    const dbStart = Date.now();

    if (env.DB) {
        try {
            // Core rates data from D1 (New Primary)
            const dbRow = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
            const lastFetchRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
            
            dbStatus = 'healthy';

            if (dbRow) {
                const allRates = JSON.parse(dbRow.rates_json);
                const eurToPhp = allRates['PHP'] || 1;

                SUPPORTED_COUNTRIES.forEach(c => {
                    const eurToCur = allRates[c.currency] || 1;
                    rates[`${c.currency}_PHP`] = parseFloat((eurToPhp / eurToCur).toFixed(4));
                });

                // Use the specifically tracked fixer fetch time or the row update time
                const syncTimestamp = lastFetchRow ? parseInt(lastFetchRow.value) : dbRow.updated_at;
                lastUpdated = new Date(syncTimestamp).toISOString();
                strategy = 'd1_sync';

                // Check if rates are stale (>24 hours for daily sync)
                const ageMs = Date.now() - syncTimestamp;
                if (ageMs < 24 * 60 * 60 * 1000) {
                    apiStatus = 'healthy';
                } else if (ageMs < 48 * 60 * 60 * 1000) {
                    apiStatus = 'degraded';
                } else {
                    apiStatus = 'down';
                }
            } else {
                apiStatus = 'down';
            }

            // Today's snapshot check
            const today = new Date().toISOString().split('T')[0];
            try {
                const snapshotRow = await env.DB.prepare("SELECT id FROM currency_snapshots WHERE date = ?").bind(today).first();
                snapshotSaved = !!snapshotRow;
            } catch (e) { /* table may not exist yet */ }

            // Last cleanup check
            try {
                const cleanupRow = await env.DB.prepare("SELECT timestamp FROM cleanup_logs WHERE status = 'success' ORDER BY timestamp DESC LIMIT 1").first();
                if (cleanupRow) {
                    lastCleanup = new Date(cleanupRow.timestamp).toISOString();
                }
            } catch (e) { /* table may not exist yet */ }

            // Country analytics — users per country
            try {
                const countryRows = await env.DB.prepare(`
                    SELECT country, COUNT(*) as user_count FROM users 
                    WHERE country IS NOT NULL AND country != '' 
                    GROUP BY country ORDER BY user_count DESC
                `).all();
                if (countryRows?.results) {
                    countryAnalytics = countryRows.results.map(r => ({
                        country: r.country,
                        users: r.user_count
                    }));
                }
            } catch (e) { /* ok if empty */ }

            // Total users count
            try {
                const userRow = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
                totalUsers = userRow?.count || 0;
            } catch (e) { /* ok */ }

            // Total conversions (7d)
            try {
                const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                const convRow = await env.DB.prepare("SELECT COUNT(*) as count FROM conversions WHERE timestamp >= ?").bind(sevenDaysAgo).first();
                totalConversions = convRow?.count || 0;
            } catch (e) { /* ok */ }

        } catch (e) {
            console.error('System status fetch failed:', e);
            dbStatus = 'error';
        }
    }

    const dbResponseTime = Date.now() - dbStart;

    // 3. Prepare Response
    return new Response(JSON.stringify({
        status: 'success',
        countries: SUPPORTED_COUNTRIES.map(c => ({
            code: c.code,
            name: c.name,
            currency: c.currency,
            active: true
        })),
        rates: rates,
        snapshot_saved: snapshotSaved,
        last_updated: lastUpdated,
        last_cleanup: lastCleanup,
        source: strategy,
        health: {
            api: apiStatus,
            db: dbStatus,
            api_response_time_ms: apiResponseTime,
            db_response_time_ms: dbResponseTime
        },
        analytics: {
            total_users: totalUsers,
            total_conversions_7d: totalConversions,
            users_by_country: countryAnalytics
        }
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
