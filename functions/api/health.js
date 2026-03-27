/**
 * /api/health
 * System health check endpoint — no auth required.
 * Returns system status, rates freshness, and D1 connectivity.
 * Used by monitoring systems and cron self-checks.
 */

export async function onRequest(context) {
  const { env } = context;
  const startTime = Date.now();

  const health = {
    status: 'ok',
    timestamp: startTime,
    iso: new Date(startTime).toISOString(),
    checks: {
      database: { status: 'unknown' },
      rates: { status: 'unknown', available: false },
      fixer_api: { status: 'unknown' }
    }
  };

  // 1. Check D1 Database
  if (!env.DB) {
    health.checks.database = { status: 'missing', error: 'DB binding not found' };
    health.status = 'degraded';
  } else {
    try {
      const testRow = await env.DB.prepare("SELECT 1 as test").first();
      health.checks.database = { 
        status: testRow ? 'healthy' : 'error',
        response_time_ms: Date.now() - startTime
      };
    } catch (e) {
      health.checks.database = { status: 'error', error: e.message };
      health.status = 'degraded';
    }
  }

  // 2. Check Rates Freshness
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT rates_json, updated_at FROM rates_cache WHERE base_currency = 'EUR'").first();
      if (row) {
        const age = Date.now() - row.updated_at;
        const ageHours = (age / (1000 * 60 * 60)).toFixed(1);
        const ratesCount = Object.keys(JSON.parse(row.rates_json)).length;
        
        health.checks.rates = {
          status: age < 48 * 60 * 60 * 1000 ? 'healthy' : 'stale',
          available: true,
          rates_count: ratesCount,
          age_hours: parseFloat(ageHours),
          last_updated: new Date(row.updated_at).toISOString()
        };

        if (age > 48 * 60 * 60 * 1000) {
          health.status = 'degraded';
        }
      } else {
        health.checks.rates = { status: 'empty', available: false };
        health.status = 'degraded';
      }
    } catch (e) {
      health.checks.rates = { status: 'error', available: false, error: e.message };
      health.status = 'degraded';
    }
  }

  // 3. Check Last Fixer Sync
  if (env.DB) {
    try {
      const lastSync = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_fixer_fetch'").first();
      if (lastSync) {
        const syncAge = Date.now() - parseInt(lastSync.value);
        health.checks.fixer_api = {
          status: syncAge < 25 * 60 * 60 * 1000 ? 'healthy' : 'overdue',
          last_sync: new Date(parseInt(lastSync.value)).toISOString(),
          next_due: new Date(parseInt(lastSync.value) + 24 * 60 * 60 * 1000).toISOString()
        };
      } else {
        health.checks.fixer_api = { status: 'never_synced' };
        health.status = 'degraded';
      }
    } catch (e) {
      health.checks.fixer_api = { status: 'unknown', note: 'settings table may not exist' };
    }
  }

  // 4. Calculate total response time
  health.response_time_ms = Date.now() - startTime;

  // 5. Log health check (non-blocking)
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT INTO health_logs (status, details, response_time_ms) VALUES (?, ?, ?)")
        .bind(health.status, JSON.stringify(health.checks), health.response_time_ms)
        .run();
    } catch (e) {
      // Don't crash if health_logs table doesn't exist yet
    }
  }

  const httpStatus = health.status === 'ok' ? 200 : 207; // 207 for degraded

  return new Response(JSON.stringify(health), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
