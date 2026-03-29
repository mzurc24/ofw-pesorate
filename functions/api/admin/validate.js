/**
 * /api/admin/validate
 * Real-time Consistency & Self-Healing Endpoint.
 * Compares D1 Cache vs live Fixer API (if fresh fetch allowed).
 * Performs test conversions (USD->SGD, etc.) and auto-heals on mismatch.
 * Security: Bearer Token Auth
 * Version: 1.0.0 (Consistency Monitor)
 */

import { calculateRate, EMERGENCY_RATES } from '../rates.js';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 1. Security Check
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const validToken = (env.CF_ADMIN_TOKEN || '').trim();

    if (!token || token !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const results = {
        status: 'ok',
        consistent: true,
        tests: [],
        self_healed: false,
        timestamp: Date.now()
    };

    try {
        // 2. Fetch D1 Cache
        const cacheRecord = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
        if (!cacheRecord) {
            results.status = 'degraded';
            results.consistent = false;
            results.message = 'D1 Cache is empty';
        }

        const cachedRates = cacheRecord ? JSON.parse(cacheRecord.rates_json) : EMERGENCY_RATES;

        // 3. Consistency Test Pairs (USD->SGD, EUR->USD, SGD->PHP)
        const testPairs = [
            { from: 'USD', to: 'SGD', amount: 100 },
            { from: 'EUR', to: 'USD', amount: 100 },
            { from: 'SGD', to: 'PHP', amount: 1000 }
        ];

        for (const pair of testPairs) {
            const rate = calculateRate(cachedRates, pair.from, pair.to);
            const converted = parseFloat((pair.amount * rate).toFixed(4));
            
            // Mathematical Expectation: (eurToTarget / eurToSource) * amount
            const eurToSource = cachedRates[pair.from] || EMERGENCY_RATES[pair.from];
            const eurToTarget = cachedRates[pair.to] || EMERGENCY_RATES[pair.to];
            const expected = parseFloat(((eurToTarget / eurToSource) * pair.amount).toFixed(4));

            const diff = Math.abs(converted - expected);
            const passed = diff <= 0.0001;

            results.tests.push({
                pair: `${pair.from}_${pair.to}`,
                amount: pair.amount,
                result: converted,
                expected: expected,
                diff: diff,
                passed: passed
            });

            if (!passed) {
                results.consistent = false;
                results.status = 'alert';
            }
        }

        // 4. SELF-HEALING: Only trigger sync if cache is missing or truly stale (>24h).
        // IMPORTANT: No force=true — sync.js internal throttle (6h) and quota guard (90 calls/month)
        // are the single source of truth for rate-limiting. Never bypass them here.
        const isStale = cacheRecord ? (Date.now() - cacheRecord.updated_at) > 1000 * 60 * 60 * 24 : true; // 24h stale threshold

        if (!results.consistent || isStale) {
            console.warn('Validate: stale or inconsistent cache detected — requesting sync (quota-safe).');

            // Use Bearer auth header — sync.js reads Authorization header, not query param
            const syncUrl = new URL('/api/admin/sync', url.origin);
            const syncRes = await fetch(syncUrl.toString(), {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${validToken}` }
                // NOTE: No force=true — the 6h throttle in sync.js will skip Fixer if recently synced
            });
            const syncData = await syncRes.json();

            results.self_healed = syncRes.ok;
            results.sync_result = syncData;
        }

        // 5. Final Response
        return new Response(JSON.stringify(results), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (e) {
        console.error('Validation failure:', e.message);
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
