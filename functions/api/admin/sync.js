/**
 * /api/admin/sync
 * Manually or via Cron trigger a fresh rate sync from Fixer.
 * Security: Token required via param or header.
 * Version: 2.0.0 (Self-Healing with Retry)
 */

async function fetchWithRetry(url, retries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return res;
      console.error(`Sync fetch attempt ${attempt}/${retries}: HTTP ${res.status}`);
    } catch (e) {
      console.error(`Sync fetch attempt ${attempt}/${retries}: ${e.message}`);
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. Security Check
  const rawToken = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
  const validToken = env.CF_ADMIN_TOKEN || 'ofwAk026';

  if (!rawToken || rawToken !== validToken) {
    return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const now = Date.now();
    const CACHE_TTL = 86400; // 24 hours

    // 2. Throttling Check (skip if force=true)
    const forceSync = url.searchParams.get('force') === 'true';
    if (!forceSync && env.DB) {
      try {
        const lastFetchRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
        if (lastFetchRow && lastFetchRow.value) {
          const lastFetch = parseInt(lastFetchRow.value);
          if ((now - lastFetch) / 1000 < CACHE_TTL) {
            return new Response(JSON.stringify({
              status: 'throttled',
              message: 'Rate limit safety: 1 call per 24 hours. Data is fresh.',
              last_sync: new Date(lastFetch).toISOString(),
              next_sync_available: new Date(lastFetch + CACHE_TTL * 1000).toISOString()
            }), {
              status: 429,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
        }
      } catch (dbErr) {
        console.error('Throttling check failed (non-fatal):', dbErr.message);
      }
    }

    // 3. Fetch from Fixer with retry
    const apiKey = env.CF_FIXER_KEY || 'c056294df71360e7b8e84205ef080e47';
    const baseUrl = 'http://data.fixer.io/api/latest';
    
    const response = await fetchWithRetry(`${baseUrl}?access_key=${apiKey}`);
    if (!response) {
      console.error('CRITICAL: All sync retries exhausted');
      if (env.DB) {
        try { await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "fail_all_retries").run(); } catch(e) {}
      }
      return new Response(JSON.stringify({
        status: 'error',
        message: 'All Fixer API retries exhausted. Cached data still being served.'
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    const data = await response.json();
    if (!data.success || !data.rates) {
      throw new Error(data.error?.info || 'Fixer response invalid');
    }

    const ratesJson = JSON.stringify(data.rates);

    // 4. Update D1
    if (env.DB) {
      try {
        await env.DB.prepare("REPLACE INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?)").bind(ratesJson, now).run();
        try {
          await env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_fixer_fetch', ?)").bind(now.toString()).run();
          await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "success").run();
        } catch(e) { console.error('Secondary write failed', e); }
      } catch (writeErr) {
         console.error('D1 Write Failed:', writeErr.message);
         try {
           await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "fail_write").run();
         } catch(e) {}
      }
    }

    return new Response(JSON.stringify({
      status: 'success',
      message: 'Sync completed successfully',
      timestamp: new Date(now).toISOString(),
      rates_count: Object.keys(data.rates).length
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    console.error('Fatal Sync Error:', err.message);
    if (env.DB) {
      try {
        await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "fail_fatal").run();
      } catch(e) {}
    }
    return new Response(JSON.stringify({
      status: 'error',
      message: err.message
      // No stack trace in production
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
