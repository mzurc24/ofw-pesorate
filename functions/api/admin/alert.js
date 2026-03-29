export async function onRequest(context) {
    const { request, env } = context;

    // Secure via existing admin token logic
    const validToken = (env.CF_ADMIN_TOKEN || '').trim();
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.replace('Bearer ', '').trim() !== validToken) {
        return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized' }), { status: 401 });
    }

    if (!env.DISCORD_WEBHOOK_URL) {
        return new Response(JSON.stringify({ status: 'ignored', message: 'No Discord Webhook configured.' }), { status: 200 });
    }

    try {
        const todayStr = new Date().toISOString().split('T')[0];
        
        // Prevent aggressive spam if triggered multiple times via DevOps hourly action
        const lastAlert = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_alert_date'").first('value');
        if (lastAlert === todayStr) {
            return new Response(JSON.stringify({ status: 'ignored', message: 'Daily alert already sent.' }), { status: 200 });
        }

        // Gather real-time rates
        const ratesRow = await env.DB.prepare("SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'").first();
        if (!ratesRow) return new Response('No rates available.', { status: 500 });
        
        const allRates = JSON.parse(ratesRow.rates_json);
        const phpRate = allRates['PHP'];
        const sgdRate = allRates['SGD'];
        const usdRate = allRates['USD'];
        const aedRate = allRates['AED'];
        
        const sgdToPhp = (phpRate / sgdRate).toFixed(2);
        const usdToPhp = (phpRate / usdRate).toFixed(2);
        const aedToPhp = (phpRate / aedRate).toFixed(2);

        // Broadcast Payload
        const payload = {
            content: `📣 **Daily OFW Rate Update**\n\n🇸🇬 1 SGD = **₱${sgdToPhp}**\n🇺🇸 1 USD = **₱${usdToPhp}**\n🇦🇪 1 AED = **₱${aedToPhp}**\n\nMonitor your remittances live at: https://ofwpesorate.madzlab.site/`
        };

        const alertRes = await fetch(env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (alertRes.ok) {
            await env.DB.prepare("REPLACE INTO settings (key, value) VALUES ('last_alert_date', ?)").bind(todayStr).run();
            return new Response(JSON.stringify({ status: 'success', message: 'Daily Rate Alert broadcasted.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ status: 'error', message: 'Discord Webhook failed.' }), { status: 500 });
        }

    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500 });
    }
}
