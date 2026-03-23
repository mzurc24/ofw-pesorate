export async function onRequest(context) {
    const { env } = context;
    return new Response(JSON.stringify({
        CF_ADMIN_TOKEN_EXISTS: !!env.CF_ADMIN_TOKEN,
        CF_ADMIN_TOKEN_LENGTH: env.CF_ADMIN_TOKEN?.length,
        // Only show first and last char for security
        CF_ADMIN_TOKEN_START: env.CF_ADMIN_TOKEN ? env.CF_ADMIN_TOKEN[0] : null,
        CF_ADMIN_TOKEN_END: env.CF_ADMIN_TOKEN ? env.CF_ADMIN_TOKEN[env.CF_ADMIN_TOKEN.length - 1] : null,
        DB_EXISTS: !!env.DB
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
