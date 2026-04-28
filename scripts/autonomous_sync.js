/**
 * OFW Pesorate - Senior DevOps Autonomous Sync Agent
 * Implements the 6-step flow to maintain system health while maximizing Twelve Data efficiency.
 */

const { execSync } = require('child_process');
// Node.js 18+ has built-in fetch

// CONFIGURATION
const BASE_URL = process.env.TEST_URL || 'https://ofwpesorate.madzlab.site';
const ADMIN_TOKEN = process.env.CF_ADMIN_TOKEN;
if (!ADMIN_TOKEN) { console.error('❌ CF_ADMIN_TOKEN env var is required'); process.exit(1); }
const SYNC_URL = `${BASE_URL}/api/admin/sync`;
const RATES_URL = `${BASE_URL}/api/rates?base=USD`;

async function runStep(name, fn) {
    console.log(`\n[AGENT] STEP ${name}...`);
    try {
        return await fn();
    } catch (e) {
        console.error(`[AGENT] STEP ${name} FAILED: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log("🚀 STARTING AUTONOMOUS SYNC FLOW");

    // STEP 1: Check Cache First
    const cacheData = await runStep("1: CHECK CACHE", async () => {
        const res = await fetch(RATES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    });

    if (cacheData && cacheData.success) {
        const ageSecs = (Date.now() - cacheData.timestamp) / 1000;
        const ratesCount = Object.keys(cacheData.rates || {}).length;

        // STEP 2: Validate Data
        if (ageSecs < 43200 && ratesCount >= 150) { // < 12 hours and complete
            console.log(`✅ CACHE IS HEALTHY (Age: ${Math.round(ageSecs/3600)}h, Count: ${ratesCount}). Skipping Twelve Data.`);
            return finalize();
        }
        console.log(`⚠️ CACHE NEEDS REFRESH (Age: ${Math.round(ageSecs/3600)}h, Count: ${ratesCount})`);
    }

    // STEP 3: Controlled Sync
    const syncResult = await runStep("3: CONTROLLED SYNC", async () => {
        const res = await fetch(SYNC_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
        });
        const data = await res.json();
        console.log(`[AGENT] Sync Response: ${data.status} - ${data.message}`);
        return data;
    });

    // STEP 4: Retry Logic (Limited to 1 additional attempt if failed but not protected/degraded)
    if (syncResult && syncResult.status === 'error') {
        await runStep("4: LIMITED RETRY", async () => {
            console.log("[AGENT] Attempting Final Retry...");
            const res = await fetch(SYNC_URL, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
            });
            const data = await res.json();
            console.log(`[AGENT] Retry Response: ${data.status}`);
            return data;
        });
    }

    // STEP 5: Redeploy (Safe) - ONLY IF UI IS BROKEN
    console.log("\n[AGENT] STEP 5: ANALYZING UI HEALTH...");
    let healthPass = false;
    try {
        execSync('node scripts/health_check.js', { stdio: 'inherit' });
        healthPass = true;
    } catch (e) {
        console.error("[AGENT] UI HEALTH CHECK FAILED!");
    }

    if (!healthPass) {
        console.log("🚨 UI IS BROKEN. TRIGGERING SAFE REDEPLOY...");
        try {
            execSync('npm run deploy', { stdio: 'inherit' });
            console.log("✅ REDEPLOY COMPLETE.");
        } catch (e) {
            console.error("❌ REDEPLOY FAILED:", e.message);
        }
    }

    finalize();
}

function finalize() {
    console.log("\n🎯 AUTONOMOUS FLOW COMPLETE");
    // Run final health check to report status
    try {
        console.log("[AGENT] Final Health Verification...");
        execSync('node scripts/health_check.js', { stdio: 'inherit' });
        process.exit(0);
    } catch (e) {
        console.error("[AGENT] Final Health Check Reported Failures.");
        process.exit(1);
    }
}

main();
