/**
 * OFW PesoRate - Advanced Consolidated Worker (Twelve Data Production Edition)
 * Version: 4.2.0
 * 
 * This file replaces all previous individual functions and the legacy worker.
 * It provides a unified, low-latency API and dashboard experience.
 */

const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const TWELVE_SYMBOLS = [
  'EUR/USD', 'EUR/PHP', 'EUR/SGD', 'EUR/JPY', 'EUR/GBP',
  'EUR/SAR', 'EUR/AED', 'EUR/QAR', 'EUR/KWD', 'EUR/OMR',
  'EUR/BHD', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD', 'EUR/CHF',
  'EUR/NOK', 'EUR/SEK', 'EUR/HKD', 'EUR/MYR', 'EUR/TWD',
  'EUR/KRW', 'EUR/CNY', 'EUR/THB', 'EUR/MXN'
].join(',');

const COUNTRY_CURRENCY_MAP = {
  'SA': 'SAR', 'AE': 'AED', 'QA': 'QAR', 'KW': 'KWD', 'OM': 'OMR', 'BH': 'BHD',
  'GB': 'GBP', 'IT': 'EUR', 'ES': 'EUR', 'DE': 'EUR', 'FR': 'EUR', 'NL': 'EUR',
  'CH': 'CHF', 'NO': 'NOK', 'SE': 'SEK', 'SG': 'SGD', 'HK': 'HKD', 'MY': 'MYR',
  'TW': 'TWD', 'JP': 'JPY', 'KR': 'KRW', 'CN': 'CNY', 'TH': 'THB', 'US': 'USD',
  'CA': 'CAD', 'MX': 'MXN', 'AU': 'AUD', 'NZ': 'NZD', 'PH': 'PHP'
};

const EMERGENCY_RATES = {
  USD: 1.08, PHP: 63.5, SGD: 1.45, JPY: 162.0, GBP: 0.855,
  SAR: 4.05, AED: 3.97, QAR: 3.93, KWD: 0.332, OMR: 0.416,
  BHD: 0.407, EUR: 1.00, CAD: 1.50, AUD: 1.69, NZD: 1.85,
  CHF: 0.96, NOK: 11.55, SEK: 11.20, HKD: 8.42, MYR: 4.82,
  TWD: 34.90, KRW: 1460, CNY: 7.85, THB: 37.50, MXN: 21.8
};

export default {
    /**
     * Phase 1: Scheduled Sync (Twelve Data CRON)
     */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(performSync(env));
    },

    /**
     * Phase 2: Unified Fetch Handler
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // --- PUBLIC API ROUTES ---
        if (path === '/api/rates') return await handleRates(url, env, ctx);
        if (path === '/api/rate' || path === '/api/auto-detect') return await handleAutoDetect(request, env);
        if (path === '/api/social') return await handleSocial(env);

        // --- ADMIN API ROUTES ---
        if (path === '/api/admin/metrics') return await handleMetrics(request, env);
        if (path === '/api/admin/system') return await handleSystem(request, env);
        if (path === '/api/admin/sync') return await handleManualSync(request, env);
        if (path === '/api/admin/telemetry') return await handleTelemetry(request, env);

        // --- DASHBOARD ROUTE ---
        if (path === '/admin') return await handleAdminHTML(request, env);

        // --- FALLBACK TO ASSETS ---
        return await fetch(request);
    }
};

/**
 * HANDLER: Dashboard HTML Serving
 */
async function handleAdminHTML(request, env) {
    const token = (env.CF_ADMIN_TOKEN || 'ofwAk026').trim();
    const authHeader = request.headers.get('Authorization');
    const urlToken = new URL(request.url).searchParams.get('t');

    let isAuthorized = (urlToken === token);
    if (!isAuthorized && authHeader) {
        const authValue = authHeader.replace('Bearer ', '').replace('Basic ', '');
        if (authValue === token || b64decode(authValue).includes(token)) isAuthorized = true;
    }

    if (!isAuthorized) {
        return new Response('401 Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="Admin Access"', 'Content-Type': 'text/plain' }
        });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Control Panel | OFW PesoRate Admin</title>
    <style>:root { --bg: #0a0e1a; --text-primary: #f1f5f9; --accent: #3b82f6; --success: #22c55e; --warning: #f59e0b; --danger: #ef4444; } body { font-family: sans-serif; background: var(--bg); color: var(--text-primary); margin: 0; display: flex; height: 100vh; } .sidebar { width: 260px; border-right: 1px solid rgba(255,255,255,0.1); padding: 24px; } .main { flex-grow: 1; padding: 32px; overflow-y: auto; } .card { background: rgba(17,24,39,0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 20px; } .flex { display: flex; } .gap-2 { gap: 8px; } .h-3 { height: 12px; } .rounded-sm { border-radius: 2px; } .flex-1 { flex: 1; } .bg-success { background: var(--success); } .bg-warning { background: var(--warning); } .bg-danger { background: var(--danger); } .bg-gray { background: rgba(255,255,255,0.1); }</style>
</head>
<body>
    <aside class="sidebar"><h2 style="color:var(--accent)">OFW Admin</h2><nav style="display:flex;flex-direction:column;gap:12px;margin-top:30px"><a href="#" style="color:white;text-decoration:none">📊 Dashboard</a><a href="#social" style="color:rgba(255,255,255,0.5);text-decoration:none">📱 Social Traffic</a></nav></aside>
    <main class="main">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><h1>Dashboard</h1><p style="opacity:0.5">Twelve Data v4.2.0 Engine Active</p></div><div id="api-status" style="padding:6px 12px;border-radius:20px;background:rgba(34,197,94,0.1);color:var(--success);font-size:0.8rem">🟢 API: Healthy</div></div>
        <div class="card"><h3>DevOps Reliability Pulse</h3><div id="devops-alerts" style="display:flex;gap:3px;margin-top:10px"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:20px"><div class="card" style="margin:0"><h5>DAILY BUDGET</h5><p id="metrics-budget" style="font-size:1.5rem;font-weight:bold">-- / 700</p></div><div class="card" style="margin:0"><h5>LAST SYNC</h5><p id="sync-timestamp-text" style="font-size:1.5rem;font-weight:bold">--:--</p></div></div></div>
        <div class="card" id="social-section"><h3>📱 Social Traffic</h3><div id="social-status-text" style="margin-bottom:10px">Checking health...</div><div id="social-platform-cards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px"></div></div>
    </main>
    <script>const injectedToken = "${token}"; if(injectedToken) sessionStorage.setItem('ofw_admin_token', injectedToken);</script>
    <script src="admin.js?v=4.2.0"></script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

/**
 * HANDLER: Social Status (Fixed for 0 Traffic Health)
 */
async function handleSocial(env) {
    try {
        const result = await env.DB.prepare("SELECT platform, count(*) as count, sum(case when status='fail' then 1 else 0 end) as failed_count FROM social_traffic WHERE timestamp >= datetime('now', '-7 days') GROUP BY platform").all();
        return Response.json({ status: 'HEALTHY', platforms: result.results || [], timestamp: new Date().toISOString() }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch (e) {
        return Response.json({ status: 'DEGRADED', error: e.message }, { status: 500 });
    }
}

/**
 * HANDLER: Metrics (Sync Trends & Reliability)
 */
async function handleMetrics(request, env) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [devopsAudit, usage] = await Promise.all([
            env.DB.prepare("SELECT status, timestamp FROM devops_audit WHERE timestamp >= datetime('now', '-24 hours') ORDER BY timestamp ASC").all(),
            env.DB.prepare("SELECT fixer_calls FROM api_usage WHERE month = ?").bind(today).first()
        ]);
        return Response.json({
            devopsTrend: devopsAudit.results || [],
            metrics: { creditsUsedToday: usage?.fixer_calls || 0 },
            usageTrend: [{ date: today, credits_used: usage?.fixer_calls || 0 }]
        }, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
    } catch (e) {
        return Response.json({ status: 'error', message: e.message }, { status: 500 });
    }
}

/**
 * HANDLER: System Health (4h Sync Window)
 */
async function handleSystem(request, env) {
    try {
        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_twelvedata_fetch'").first();
        const syncTimestamp = row ? parseInt(row.value) : Date.now();
        const ageMs = Date.now() - syncTimestamp;
        let status = 'healthy';
        if (ageMs > 8 * 60 * 60 * 1000) status = 'down'; else if (ageMs > 4 * 60 * 60 * 1000) status = 'degraded';
        return Response.json({ status, last_sync: new Date(syncTimestamp).toISOString() }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch (e) { return Response.json({ status: 'error' }, { status: 500 }); }
}

/**
 * HANDLER: Rates Engine
 */
async function handleRates(url, env, ctx) {
    const base = (url.searchParams.get('base') || 'USD').toUpperCase();
    try {
        const row = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
        if (!row) throw new Error("No Cache");
        const rates = JSON.parse(row.rates_json);
        const eurToBase = rates[base] || 1;
        const normalized = {};
        for (const [cur, val] of Object.entries(rates)) normalized[cur] = parseFloat((val / eurToBase).toFixed(4));
        return Response.json({ success: true, base, rates: normalized, timestamp: row.updated_at, source: 'twelve_data' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    } catch (e) { return Response.json({ success: false, error: e.message }, { status: 503 }); }
}

/**
 * HANDLER: Auto-Detect
 */
async function handleAutoDetect(request, env) {
    const country = request.headers.get('cf-ipcountry') || 'US';
    return Response.json({ country, currency: COUNTRY_CURRENCY_MAP[country] || 'USD' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}

/**
 * HANDLER: Manual Sync
 */
async function handleManualSync(request, env) {
    await performSync(env);
    return Response.json({ success: true });
}

/**
 * HANDLER: Telemetry
 */
async function handleTelemetry(request, env) {
    const data = await request.json();
    await env.DB.prepare("INSERT INTO healing_logs (id, action, status, details, timestamp) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), data.action || 'MONITOR', data.status || 'OK', JSON.stringify(data), Date.now()).run();
    return Response.json({ success: true });
}

/**
 * CORE: Sync Logic
 */
async function performSync(env) {
    if (!env.CF_TWELVEDATA_KEY || !env.DB) return;
    const today = new Date().toISOString().split('T')[0];
    try {
        const res = await fetch(`https://api.twelvedata.com/price?symbol=${TWELVE_SYMBOLS}&apikey=${env.CF_TWELVEDATA_KEY.trim()}`);
        const data = await res.json();
        const rates = { EUR: 1.0 };
        for (const [pair, val] of Object.entries(data)) {
            const currency = pair.split('/')[1];
            if (currency && val.price) rates[currency] = parseFloat(val.price);
        }
        const now = Date.now();
        await env.DB.batch([
            env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?)").bind(JSON.stringify(rates), now),
            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)").bind(now.toString()),
            env.DB.prepare("INSERT INTO api_usage (month, fixer_calls) VALUES (?, 24) ON CONFLICT(month) DO UPDATE SET fixer_calls = fixer_calls + 24").bind(today, 24)
        ]);
        await env.DB.prepare("INSERT INTO devops_audit (id, status, actions_taken, timestamp) VALUES (?,?,?,datetime('now'))").bind(crypto.randomUUID(), 'HEALTHY', 'Sync Success', Date.now()).run();
    } catch (e) {
        await env.DB.prepare("INSERT INTO devops_audit (id, status, actions_taken, timestamp) VALUES (?,?,?,datetime('now'))").bind(crypto.randomUUID(), 'DEGRADED', 'Sync Error: ' + e.message, Date.now()).run();
    }
}

function b64decode(str) { try { return atob(str); } catch(e) { return "" } }
