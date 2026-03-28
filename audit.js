const https = require('https');

const DOMAINS = [
    'ofw-pesorate.pages.dev',
    'ofwpesorate.madzlab.site'
];

async function checkDomain(domain) {
    console.log(`\n🔍 Auditing Security Headers: ${domain}`);
    
    return new Promise((resolve) => {
        https.get(`https://${domain}`, (res) => {
            const headers = res.headers;
            const requiredHeaders = [
                'strict-transport-security',
                'x-frame-options',
                'x-content-type-options',
                'content-security-policy'
            ];

            let passes = true;
            requiredHeaders.forEach(h => {
                if (headers[h]) {
                    console.log(`✅ ${h}: ${headers[h].slice(0, 50)}...`);
                } else {
                    console.error(`❌ ${h} is MISSING!`);
                    passes = false;
                }
            });

            // Check Cache-Control for assets
            https.get(`https://${domain}/assets/img1.webp`, (resAsset) => {
                const cacheHeader = resAsset.headers['cache-control'];
                if (cacheHeader && cacheHeader.includes('immutable')) {
                    console.log(`✅ Asset Cache-Control: ${cacheHeader}`);
                } else {
                    console.error(`❌ Asset Caching (immutable) is MISSING!`);
                    passes = false;
                }
                resolve(passes);
            });
        }).on('error', (err) => {
            console.error(`🚨 Connection Failed: ${err.message}`);
            resolve(false);
        });
    });
}

(async () => {
    console.log('🚀 Starting DevSecOps Production Audit...');
    let allPass = true;
    for (const domain of DOMAINS) {
        const pass = await checkDomain(domain);
        if (!pass) allPass = false;
    }

    if (allPass) {
        console.log('\n🏆 AUDIT SUCCESS: All production domains are hardened and synced.');
        process.exit(0);
    } else {
        console.error('\n🚩 AUDIT FAILED: Vulnerabilities or sync issues detected.');
        process.exit(1);
    }
})();
