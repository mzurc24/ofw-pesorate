/**
 * Global Health Monitor & Resilience Verifier
 * Uses Puppeteer to load the app and verify the UI rendering,
 * simulating different country origins to test conditional UI/Edge logic.
 */

const puppeteer = require('puppeteer');

const TEST_URL = process.env.TEST_URL || 'https://ofwpesorate.madzlab.site/';
const TEST_TOKEN = process.env.CF_ADMIN_TOKEN || 'ofwAk026';

const REGIONS = [
    { country: 'MY', name: 'Malaysia' },
    { country: 'SG', name: 'Singapore' },
    { country: 'US', name: 'United States' },
    { country: 'PH', name: 'Philippines' }
];

async function verifyRegion(browser, region) {
    console.log(`\n🔍 Verifying Region: ${region.name} (${region.country})`);
    const page = await browser.newPage();
    let hasConsoleErrors = false;

    // Monitor for Client-Side Runtime Crashes (the exact cause of our blank page issue)
    page.on('pageerror', err => {
        console.error(`❌ [${region.country}] Page Crash:`, err.toString());
        hasConsoleErrors = true;
    });

    // Inject our test override headers
    await page.setExtraHTTPHeaders({
        'x-test-country': region.country,
        'x-test-token': TEST_TOKEN
    });

    try {
        // Go to URL and wait until network is mostly idle
        const response = await page.goto(TEST_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        
        if (!response.ok() && response.status() !== 304) {
            throw new Error(`HTTP Error: ${response.status()}`);
        }

        // Wait for the app bootloader to finish (resilience check)
        await page.waitForFunction(() => {
            const bootloader = document.getElementById('app-boot-loading');
            return !bootloader || bootloader.classList.contains('fade-out');
        }, { timeout: 10000 });

        // Ensure the dashboard loaded and populated a rate
        
        // Handle First-Visit Screen
        const isFirstVisit = await page.evaluate(() => {
            const fv = document.getElementById('first-visit');
            return fv && !fv.classList.contains('hidden');
        });

        if (isFirstVisit) {
            console.log(`[${region.country}] Running first-visit setup...`);
            await page.type('#name-input', 'TestBot');
            await page.click('#save-name-btn');
            // Wait for dashboard transition
            await page.waitForFunction(() => {
                const dash = document.getElementById('dashboard');
                return dash && !dash.classList.contains('hidden');
            }, { timeout: 5000 });
        }

        // Wait for rate to populate (not '--.--')
        await page.waitForFunction(() => {
            const rateEl = document.getElementById('rate-value');
            return rateEl && rateEl.textContent !== '--.--' && rateEl.textContent !== 'Err';
        }, { timeout: 10000 });

        const rateText = await page.$eval('#rate-value', el => el.textContent);

        // Ensure greeting rendered (verifying UUID fallback didn't break localstorage persistence logic completely)
        const greeting = await page.$eval('#greeting', el => el.textContent);
        if (!greeting || !greeting.startsWith('Hello,')) {
            throw new Error(`Greeting failed to render: ${greeting}`);
        }

        console.log(`✅ [${region.country}] Verified OK. UI Rendered. Rate: ${rateText}`);
        
        if (hasConsoleErrors) {
            console.error(`⚠️ [${region.country}] Rendered, but had console errors.`);
            return false;
        }

        return true;
    } catch (e) {
        console.error(`❌ [${region.country}] Test Failed:`, e.message);
        return false;
    } finally {
        await page.close();
    }
}

(async () => {
    console.log(`🚀 Starting Global Health Monitor against: ${TEST_URL}`);
    
    // Launch headless Chromium
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let allPass = true;

    for (const region of REGIONS) {
        const pass = await verifyRegion(browser, region);
        if (!pass) allPass = false;
    }

    await browser.close();

    if (allPass) {
        console.log('\n🏆 GLOBAL HEALTH CHECK PASSED');
        process.exit(0);
    } else {
        console.error('\n🚩 GLOBAL HEALTH CHECK FAILED (Blank Page or Crash Detected)');
        process.exit(1);
    }
})();
