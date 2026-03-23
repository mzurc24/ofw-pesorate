/**
 * /api/rates
 * Centralized Fixer.io Sync Service
 * Throttled to 1 call per 24 hours.
 * Caches in Cloudflare KV.
 * Logs success/failure to D1 api_logs.
 */

const CACHE_TTL = 86400; // 24 hours in seconds

async function shouldFetch(env) {
  if (!env.KV) return true; // Fallback to live if KV missing (not recommended)
  const lastFetch = await env.KV.get("last_fetch");
  if (!lastFetch) return true;
  const now = Date.now();
  return (now - parseInt(lastFetch)) / 1000 >= CACHE_TTL;
}

async function logUsage(env, endpoint, status) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO api_logs (endpoint, status, timestamp)
      VALUES (?, ?, datetime('now'))
    `)
    .bind(endpoint, status)
    .run();
  } catch (e) {
    console.error("Failed to log usage:", e);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. Check for cached data first
  let cached = null;
  if (env.KV) {
    cached = await env.KV.get("rates_cache", { type: "json" });
  }

  // 2. Decide whether to fetch fresh or return cached
  const needFetch = await shouldFetch(env);
  
  if (!needFetch && cached) {
    console.log("Serving cached daily data from KV");
    return new Response(JSON.stringify({
      ...cached,
      _meta: { strategy: "daily_cache", source: "KV" }
    }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  console.log("Fetching fresh daily data from Fixer.io");
  const apiKey = env.CF_FIXER_KEY || 'c056294df71360e7b8e84205ef080e47';
  const fixerUrl = "http://data.fixer.io/api/latest"; // Use http for free plan compatibility

  try {
    // Only fetch common currencies to save bandwidth/complexity if needed, 
    // but Fixer returns all by default. We'll specify symbols for efficiency.
    const res = await fetch(`${fixerUrl}?access_key=${apiKey}&symbols=USD,SGD,PHP,JPY,EUR,SAR,AED,QAR,KWD,OMR,BHD,GBP,CAD,AUD,NZD`);
    
    if (!res.ok) throw new Error(`Fixer API returned ${res.status}`);
    
    const data = await res.json();
    if (!data.success) throw new Error(data.error?.info || "Fixer sync failed");

    // 3. Update Cache
    if (env.KV) {
      await env.KV.put("rates_cache", JSON.stringify(data), { expirationTtl: CACHE_TTL });
      await env.KV.put("last_fetch", Date.now().toString());
    }

    // 4. Log Success
    await logUsage(env, "/api/rates", "success");

    return new Response(JSON.stringify({
      ...data,
      _meta: { strategy: "fresh_sync", source: "Fixer.io" }
    }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    console.error("Fixer API fetch failed:", err);
    
    // 5. Log Failure
    await logUsage(env, "/api/rates", "fail");

    // 6. Fallback to cached data if available
    if (cached) {
      return new Response(JSON.stringify({
        ...cached,
        _meta: { strategy: "fallback_cache", error: err.message }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response(JSON.stringify({ 
      status: "error", 
      message: err.message 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
