/**
 * OFW Pesorate Master Worker (v4.2.0)
 * Unified Twelve Data Engine & Social Media Resilience Layer.
 * Primary Entry Point for Cloudflare Pages.
 */

const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const TWELVE_SYMBOLS = [
  'EUR/USD', 'EUR/PHP', 'EUR/SGD', 'EUR/JPY', 'EUR/GBP',
  'EUR/SAR', 'EUR/AED', 'EUR/QAR', 'EUR/KWD', 'EUR/OMR',
  'EUR/BHD', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD', 'EUR/CHf',
  'EUR/NOK', 'EUR/SEK', 'EUR/HKD', 'EUR/MYR', 'EUR/TWD',
  'EUR/KRW', 'EUR/CNY', 'EUR/THB', 'EUR/MXN'
].join(',');

const EMERGENCY_RATES = {
  USD: 1.08, PHP: 63.5, SGD: 1.45, JPY: 162.0, GBP: 0.855,
  SAR: 4.05, AED: 3.97, QAR: 3.93, KWD: 0.332, OMR: 0.416,
  BHD: 0.407, EUR: 1.00, CAD: 1.50, AUD: 1.69, NZD: 1.85,
  CHF: 0.96, NOK: 11.55, SEK: 11.20, HKD: 8.42, MYR: 4.82,
  TWD: 34.90, KRW: 1460, CNY: 7.85, THB: 37.50, MXN: 21.8
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ══════════════════════════════════════════════════════════════════════
    // ROUTE: Admin Dashboard (Secure)
    // ══════════════════════════════════════════════════════════════════════
    if (path === '/admin') {
      const token = url.searchParams.get('t') || '';
      const validToken = (env.CF_ADMIN_TOKEN || 'ofwAk026').trim();
      
      if (token !== validToken) {
        return new Response('Unauthorized Access', { status: 401 });
      }

      // Serve the premium v4.2.0 HTML directly from the worker for guaranteed live deployment
      return new Response(getAdminHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ROUTE: API Admin Sync (Manual Sync Button)
    // ══════════════════════════════════════════════════════════════════════
    if (path === '/api/admin/sync') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      return await handleManualSync(request, env);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ROUTE: API Social (Resilient zero-traffic health)
    // ══════════════════════════════════════════════════════════════════════
    if (path === '/api/social') {
      return await handleSocialAPI(env);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ROUTE: API Metrics (Pulse & Credits)
    // ══════════════════════════════════════════════════════════════════════
    if (path === '/api/admin/metrics') {
      return await handleMetricsAPI(env);
    }

    // ══════════════════════════════════════════════════════════════════════
    // DEFAULT: Pass-through to Static Files (public/*)
    // ══════════════════════════════════════════════════════════════════════
    return env.ASSETS.fetch(request);
  }
};

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: Twelve Data Sync Engine
// ══════════════════════════════════════════════════════════════════════════
async function handleManualSync(request, env) {
    const now = Date.now();
    const lastSyncStr = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_twelvedata_fetch'").first('value');
    const lastSync = parseInt(lastSyncStr || '0');

    // 2-hour window protection
    if (now - lastSync < SYNC_INTERVAL_MS) {
        return Response.json({
            status: 'success',
            data_source: 'CACHE',
            message: 'Data is fresh (within 2h window). Sync skipped to protect API quota.'
        });
    }

    const apiKey = env.CF_TWELVEDATA_KEY;
    if (!apiKey) return Response.json({ status: 'error', message: 'API key not configured' }, { status: 500 });

    try {
        const rates = await fetchFromTwelveData(apiKey);
        const ratesJson = JSON.stringify(rates);
        
        await env.DB.batch([
            env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?)").bind(ratesJson, now),
            env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_twelvedata_fetch', ?)").bind(now.toString()),
            env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind('/api/admin/sync', 'success_twelve_data')
        ]);

        return Response.json({
            status: 'success',
            result: 'HEALTHY',
            message: 'Rates synced successfully from Twelve Data.',
            count: Object.keys(rates).length
        });
    } catch (e) {
        return Response.json({ status: 'error', message: e.message }, { status: 500 });
    }
}

async function fetchFromTwelveData(apiKey) {
    const url = `https://api.twelvedata.com/price?symbol=${TWELVE_SYMBOLS}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);

    const rates = { EUR: 1.0 };
    for (const [pair, val] of Object.entries(data)) {
        const currency = pair.split('/')[1];
        if (currency && val.price) rates[currency] = parseFloat(val.price);
    }
    return rates;
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: Social Media Analytics
// ══════════════════════════════════════════════════════════════════════════
async function handleSocialAPI(env) {
    const result = await env.DB.prepare("SELECT platform, COUNT(*) as count FROM social_traffic GROUP BY platform").all();
    const platforms = result.results || [];
    
    // Always HEALTHY in the worker logic if the query doesn't crash
    return Response.json({ 
        status: 'HEALTHY', 
        platforms: platforms.map(p => ({ platform: p.platform, count: p.count, name: p.platform, clicks: p.count }))
    });
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: Dashboard Metrics
// ══════════════════════════════════════════════════════════════════════════
async function handleMetricsAPI(env) {
    const usage = await env.DB.prepare("SELECT fixer_calls FROM api_usage ORDER BY month DESC LIMIT 1").first('fixer_calls');
    const logs = await env.DB.prepare("SELECT status, timestamp FROM api_logs WHERE endpoint = '/api/admin/sync' ORDER BY timestamp DESC LIMIT 24").all();
    
    return Response.json({
        usageTrend: [{ month: 'March', count: usage || 0 }],
        devopsTrend: logs.results || []
    });
}

// ══════════════════════════════════════════════════════════════════════════
// TEMPLATE: Admin HTML (v4.2.0)
// ══════════════════════════════════════════════════════════════════════════
function getAdminHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>OFW Pesorate Admin - Twelve Data v4.2.0</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="style.css">
    <style>
        :root { --p: #7c4dff; --p-glow: #7c4dff44; --bg: #030712; --glass: rgba(17, 24, 39, 0.7); }
        body { background: var(--bg); color: #f9fafb; font-family: 'Inter', sans-serif; display: flex; min-height: 100vh; overflow-x: hidden; }
        .sidebar { width: 260px; background: rgba(17, 24, 39, 0.95); border-right: 1px solid rgba(255,255,255,0.05); padding: 24px; display: flex; flex-direction: column; }
        .main-content { flex: 1; padding: 32px; overflow-y: auto; }
        .card { background: var(--glass); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); margin-bottom: 24px; }
        .btn { background: var(--p); border: none; padding: 10px 20px; border-radius: 8px; color: white; cursor: pointer; transition: 0.2s; }
        .btn:hover { box-shadow: 0 0 20px var(--p-glow); transform: scale(1.02); }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2>OFW Admin</h2>
        <p style="opacity:0.5; font-size: 0.8em;">Twelve Data v4.2.0 Engine Active</p>
    </div>
    <div class="main-content">
        <div class="card">
            <h1>System Status</h1>
            <button id="sync-btn" class="btn">🔄 Sync Rates</button>
        </div>
        <div id="logs" class="card">
            <h3>Activity Logs</h3>
            <div id="log-content">Loading...</div>
        </div>
    </div>
    <script src="admin.js"></script>
</body>
</html>`;
}
