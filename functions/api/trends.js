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

        const trends = query.results.reverse().map(row => {
            const parsed = JSON.parse(row.snapshot_json);
            const rateMap = {};
            
            // Robust parsing: Handle both array and object snapshot formats
            let items = [];
            if (Array.isArray(parsed)) {
                items = parsed;
            } else if (typeof parsed === 'object' && parsed !== null) {
                // If it's the new USD-base object { PHP: 56.4, ... }
                items = Object.entries(parsed).map(([curr, rate]) => ({ pair: `${curr}_PHP`, rate: rate }));
            }

            items.forEach(item => {
                const parts = item.pair.split('_');
                const baseCurrency = parts[0];
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
