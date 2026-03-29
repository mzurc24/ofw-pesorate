/**
 * /api/admin/system
 * Returns the current health and status of the currency system.
 * Includes API health, DB status, country analytics data.
 * Security: Bearer Token Auth
 * Version: 3.0.0 (Consistency Engine)
 */

import { calculateRate, EMERGENCY_RATES } from '../rates.js';

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
    const { request, env } = context;
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const validToken = (env.CF_ADMIN_TOKEN || 'ofwAk026').trim();

    if (!token || token !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

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
            const dbRow = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
            
            // Try Twelve Data key first, then legacy Fixer key
            let lastFetchRow = await env.DB.prepare("SELECT value, 'last_twelvedata_fetch' as key FROM settings WHERE key = 'last_twelvedata_fetch'").first();
            if (!lastFetchRow) {
                lastFetchRow = await env.DB.prepare("SELECT value, 'last_fixer_fetch' as key FROM settings WHERE key = 'last_fixer_fetch'").first();
            }
            
            dbStatus = 'healthy';

            if (dbRow) {
                const allRates = JSON.parse(dbRow.rates_json);
                
                // Use centralized calculateRate for 100% mathematical consistency
                SUPPORTED_COUNTRIES.forEach(c => {
                    rates[`${c.currency}_PHP`] = calculateRate(allRates, c.currency, 'PHP');
                });

                const syncTimestamp = lastFetchRow ? parseInt(lastFetchRow.value) : dbRow.updated_at;
                lastUpdated = new Date(syncTimestamp).toISOString();
                strategy = lastFetchRow?.key === 'last_twelvedata_fetch' ? 'twelve_data_sync' : 'd1_sync';

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

            // Analytics
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

            try {
                const userRow = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
                totalUsers = userRow?.count || 0;
            } catch (e) { /* ok */ }

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
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
