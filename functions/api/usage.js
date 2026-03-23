/**
 * /api/usage
 * Returns Fixer.io API usage analytics from D1 api_logs.
 */

export async function onRequest(context) {
  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({ status: "error", message: "Database not available" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Get last 50 logs + summary
    const [usage, counts] = await Promise.all([
      env.DB.prepare("SELECT * FROM api_logs ORDER BY timestamp DESC LIMIT 50").all(),
      env.DB.prepare(`
        SELECT 
          status, 
          COUNT(*) as count, 
          MAX(timestamp) as last_seen 
        FROM api_logs 
        GROUP BY status
      `).all()
    ]);

    return new Response(JSON.stringify({
      recent_logs: usage.results,
      summary: counts.results,
      timestamp: new Date().toISOString()
    }), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ status: "error", message: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
