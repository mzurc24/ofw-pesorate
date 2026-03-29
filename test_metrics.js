const token = 'ofwAk026';

async function test() {
    console.log('Testing /api/admin/metrics...');
    try {
        const res = await fetch('https://ofwpesorate.madzlab.site/api/admin/metrics', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        console.log('Social Traffic:', JSON.stringify(data.socialTraffic, null, 2));
    } catch (e) { console.error('Metrics Error:', e); }

    console.log('\nTesting /api/social...');
    try {
        const res2 = await fetch('https://ofwpesorate.madzlab.site/api/social');
        const data2 = await res2.json();
        console.log('Social API:', JSON.stringify(data2, null, 2));
    } catch (e) { console.error('Social Error:', e); }
}

test();
