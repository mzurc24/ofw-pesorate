const fetch = require('node-fetch');

async function purgeCache() {
    console.log('🔄 Triggering Cloudflare Edge Cache Purge...');
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!zoneId || !apiToken) {
        console.error('❌ Missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN. Skipping purge locally.');
        // Don't fail the build locally if secrets are just missing, but log error
        process.exit(0);
    }

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ purge_everything: true })
        });
        
        const data = await res.json();
        if (data.success) {
            console.log('✅ Cache Purged Successfully');
            process.exit(0);
        } else {
            console.error('❌ Cache Purge Failed:', data.errors);
            process.exit(1);
        }
    } catch (e) {
        console.error('❌ Cache Purge Request Failed:', e.message);
        process.exit(1);
    }
}

purgeCache();
