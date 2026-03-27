/**
 * /api/admin/snapshot
 * End-of-Day Currency Analytics Snapshot trigger.
 * Captures all rates and country mappings for historical trend analysis.
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
    const { request, env } = context;

    // 1. Security Check
    const url = new URL(request.url);
    const rawToken = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const validToken = env.CF_ADMIN_TOKEN || 'ofwAk026';

    if (!rawToken || rawToken !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (!env.DB) return new Response(JSON.stringify({ status: 'error', message: 'Database missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        let ratesRow = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
        
        if (!ratesRow) {
            return new Response(JSON.stringify({ status: 'error', message: 'No rates in cache. Run sync first.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const allRates = JSON.parse(ratesRow.rates_json);
        const eurToPhp = allRates['PHP'] || 1;
        const nowStamp = Date.now();
        const dateStr = new Date().toISOString().split('T')[0];

        // 3. Structure Snapshot Data
        const snapshot = SUPPORTED_COUNTRIES.map(c => {
            const eurToCur = allRates[c.currency] || 1;
            const rate = parseFloat((eurToPhp / eurToCur).toFixed(4));
            return {
                pair: `${c.currency}_PHP`,
                rate: rate
            };
        });

        const finalData = {
            date: dateStr,
            snapshot: snapshot,
            source: 'live_through_cache',
            timestamp: new Date().toISOString()
        };

        // 4. Save to D1
        const id = crypto.randomUUID();
        await env.DB.prepare(`
            INSERT INTO currency_snapshots (id, date, snapshot_json, source, timestamp)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                snapshot_json = EXCLUDED.snapshot_json,
                source = EXCLUDED.source,
                timestamp = EXCLUDED.timestamp
        `).bind(id, dateStr, JSON.stringify(finalData), 'live_through_cache', nowStamp).run();

        return new Response(JSON.stringify({
            status: 'success',
            date: dateStr,
            snapshot_saved: true,
            timestamp: finalData.timestamp
        }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (e) {
        console.error('Snapshot process failed:', e);
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
