/**
 * Global API Middleware
 * Wraps all /api/* routes with:
 * 1. CORS headers
 * 2. Global error handler (prevents Worker 1101 crashes → HTML fallback)
 * 3. Request timing
 */

export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-user-name',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  try {
    // Pass through to the actual handler
    const response = await context.next();
    
    // Ensure CORS headers are always present
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    
    return newResponse;
  } catch (err) {
    // CRITICAL: Catch ALL unhandled errors so the Worker never crashes
    // A crash returns the static HTML page instead of JSON, breaking API clients
    console.error('UNHANDLED API ERROR:', err.message, err.stack);

    return new Response(JSON.stringify({
      status: 'error',
      message: 'Internal server error',
      _debug: err.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
