export async function onRequest(context) {
    const { request, env } = context;

    // Fetch the original static index.html from Cloudflare Pages
    const response = await env.ASSETS.fetch(request);
    
    // Safety check: Only mutate the main HTML document
    if (response.headers.get("Content-Type")?.includes("text/html")) {
        try {
            // Retrieve real-time rates from the database cache
            const ratesRow = await env.DB.prepare("SELECT rates_json FROM rates_cache WHERE base_currency = 'EUR'").first();
            let phpRate = '--.--';
            let sgdRateNum = 0;
            let phpRateNum = 0;
            
            if (ratesRow) {
                const allRates = JSON.parse(ratesRow.rates_json);
                sgdRateNum = allRates['SGD'];
                phpRateNum = allRates['PHP'];
                
                if (sgdRateNum && phpRateNum) {
                    // Convert base EUR to Target PHP per SGD
                    phpRate = (phpRateNum / sgdRateNum).toFixed(2);
                }
            }

            // Construct our Dynamic Social Previews!
            const dynamicTitle = `OFW Pesorate | SGD to PHP at ₱${phpRate}`;
            const dynamicDesc = `Real-time Smart Remittance tracking. Current Exchange: 1 SGD = ₱${phpRate}. Built for Global Filipinos to optimize their financial transfers.`;

            // Use Cloudflare's ultra-fast Edge HTMLRewriter to silently inject dynamic OG tags into the static HTML
            return new HTMLRewriter()
                .on('title', { element(e) { e.setInnerContent(dynamicTitle) } })
                .on('meta[property="og:title"]', { element(e) { e.setAttribute("content", dynamicTitle) } })
                .on('meta[name="twitter:title"]', { element(e) { e.setAttribute("content", dynamicTitle) } })
                .on('meta[property="og:description"]', { element(e) { e.setAttribute("content", dynamicDesc) } })
                .on('meta[name="twitter:description"]', { element(e) { e.setAttribute("content", dynamicDesc) } })
                .on('meta[name="description"]', { element(e) { e.setAttribute("content", dynamicDesc) } })
                .transform(response);
                
        } catch (err) {
            // Fail gracefully to the static index.html if DB or injection fails
            return response;
        }
    }

    return response;
}
