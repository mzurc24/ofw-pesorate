/**
 * /api/admin/sync
 * Manually or via Cron trigger a fresh rate sync from Fixer.
 * Security: Token required via param or header.
 */

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

  // Use a global try-catch for mission-critical reliability
  try {
    const now = Date.now();
    const CACHE_TTL = 86400; // 24 hours

    // 2. Throttling Check
    if (env.DB) {
      try {
        const lastFetchRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
        if (lastFetchRow && lastFetchRow.value) {
          const lastFetch = parseInt(lastFetchRow.value);
          if ((now - lastFetch) / 1000 < CACHE_TTL) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Rate limit safety: 1 call per 24 hours. Data is fresh.'
            }), {
              status: 429,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      } catch (dbErr) {
        console.error('Throttling check failed (non-fatal):', dbErr);
      }
    }

    // 3. Fetch from Fixer
    const apiKey = env.CF_FIXER_KEY || 'c056294df71360e7b8e84205ef080e47';
    const baseUrl = 'http://data.fixer.io/api/latest';
    
    const response = await fetch(`${baseUrl}?access_key=${apiKey}`);
    if (!response.ok) throw new Error(`Fixer API status: ${response.status}`);
    
    const data = await response.json();
    if (!data.success || !data.rates) {
      throw new Error(data.error?.info || 'Fixer response invalid');
    }

    const ratesJson = JSON.stringify(data.rates);

    // 4. Update D1
    if (env.DB) {
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO rates_cache (base_currency, rates_json, updated_at) VALUES ('EUR', ?, ?) ON CONFLICT(base_currency) DO UPDATE SET rates_json = excluded.rates_json, updated_at = excluded.updated_at").bind(ratesJson, now),
          env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_fixer_fetch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now.toString()),
          env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "success")
        ]);
      } catch (writeErr) {
         console.error('D1 Write Failed:', writeErr);
         // Fallback: log failure if possible
         try {
           await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "fail_write").run();
         } catch(e) {}
      }
    }

    return new Response(JSON.stringify({
      status: 'success',
      message: 'Sync completed successfully',
      timestamp: now,
      count: Object.keys(data.rates).length
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    console.error('Fatal Sync Error:', err);
    
    // Attempt to log failure to D1
    if (env.DB) {
      try {
        await env.DB.prepare("INSERT INTO api_logs (endpoint, status) VALUES (?, ?)").bind("/api/admin/sync", "fail_fatal").run();
      } catch(e) {}
    }

    return new Response(JSON.stringify({
      status: 'error',
      message: err.message,
      stack: err.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
