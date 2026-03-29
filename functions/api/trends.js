export async function onRequest(context) {
    const { request, env } = context;

    try {
        // Fetch the 7 most recent snapshots from D1
        const query = await env.DB.prepare("SELECT date, snapshot_json FROM currency_snapshots ORDER BY date DESC LIMIT 7").all();
        
        if (!query.success || query.results.length === 0) {
            return new Response(JSON.stringify({ status: 'error', message: 'Historical trends not yet available.' }), { 
                status: 404, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Parse and restructure the trend payload for optimal frontend charting
        const trends = query.results.reverse().map(row => {
            const parsed = JSON.parse(row.snapshot_json);
            const rateMap = {};
            
            // Convert array of {pair: "SGD_PHP", rate: 50.1} to { SGD: 50.1, USD: ... }
            parsed.forEach(item => {
                const baseCurrency = item.pair.split('_')[0];
                rateMap[baseCurrency] = item.rate;
            });
            
            return {
                date: row.date,
                rates: rateMap
            };
        });

        // Serve with aggressive caching to protect D1 read limits from public traffic
        return new Response(JSON.stringify({ status: 'success', trends: trends }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600, s-maxage=3600'
            }
        });

    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
