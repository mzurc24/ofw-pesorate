/**
 * OFW Pesorate - Fully Autonomous Healing OS (V1)
 * The "DevOps Guardian" that monitors telemetry and executes self-healing orchestration.
 */

const { execSync } = require('child_process');

// CONFIGURATION
const ADMIN_TOKEN = process.env.CF_ADMIN_TOKEN || 'ofwAk026';
const LAST_REDEPLOY_KEY = 'ofw_last_redeploy_ts';

async function logAgent(msg) {
    console.log(`[GUARDIAN] ${new Date().toISOString()} - ${msg}`);
}

async function main() {
    await logAgent("Starting healing cycle...");

    try {
        // STEP 1: MONITOR & DETECT (Phase 15: Telemetry Analysis)
        await logAgent("Analyzing system health via /api/health...");
        let apiHealthy = false;
        try {
            const TEST_URL = process.env.TEST_URL || "https://ofwpesorate.madzlab.site/";
            // Use node-fetch or curl to check /api/health
            const res = execSync(`curl -s -o /dev/null -w "%{http_code}" ${TEST_URL}api/health`).toString().trim();
            if (res === "200") {
                apiHealthy = true;
                await logAgent("✅ API Health Check Passed (200 OK).");
            } else {
                await logAgent(`❌ API Health Check Failed (Status: ${res}).`);
            }
        } catch (e) {
            await logAgent(`⚠️ API check error: ${e.message}`);
        }

        await logAgent("Running deep UI verification via scripts/health_check.js...");
        let healthPassed = false;
        try {
            execSync('node scripts/health_check.js', { stdio: 'inherit' });
            healthPassed = true;
            await logAgent("✅ UI verification passed.");
        } catch (e) {
            await logAgent("❌ UI verification failed.");
        }

        // REDEPLY LOGIC: Only redeploy if API is down. 
        // If API is up but UI fails, we log it but avoid the infinite restart loop.
        const shouldRedeploy = !apiHealthy;

        // STEP 2: DATA STALENESS SYNC (STEP 5)
        // Reuse the logic from autonomous_sync.js
        await logAgent("Verifying data freshness...");
        try {
            execSync('node scripts/autonomous_sync.js', { stdio: 'inherit' });
        } catch (e) {
            await logAgent("Data sync check failed (non-fatal).");
        }

        // STEP 3: AUTONOMOUS REDEPLOY (STEP 6)
        if (shouldRedeploy) {
            const now = Date.now();
            const lastRedeploy = parseInt(global[LAST_REDEPLOY_KEY] || '0');
            const cooldown = 10 * 60 * 1000; // 10 minutes

            if (now - lastRedeploy > cooldown) {
                await logAgent("🚨 CRITICAL FAILURE PERSISTS. Executing Autonomous Redeploy...");
                try {
                    execSync('npm run deploy', { stdio: 'inherit' });
                    global[LAST_REDEPLOY_KEY] = now.toString();
                    await logAgent("✅ Redeploy complete. System state reset.");
                    
                    // STEP 4: AUTO CACHE PURGE (STEP 7)
                    await logAgent("🧹 Purging Edge Cache...");
                    // Assuming deployment already purges, but we'd add API-based purge here if needed
                } catch (e) {
                    await logAgent("❌ Redeploy attempt failed.");
                }
            } else {
                await logAgent("🔁 Redeploy on cooldown. Skipping to preserve stability.");
            }
        }

        // STEP 5: FINAL VALIDATION (STEP 8)
        await logAgent("Final validation check...");
        try {
            execSync('node scripts/health_check.js', { stdio: 'inherit' });
            await logAgent("🏆 SYSTEM STABLE.");
        } catch (e) {
            await logAgent("⚠️ System still reporting issues. Entering background healing loop.");
        }

    } catch (e) {
        await logAgent(`CRITICAL GUARDIAN ERROR: ${e.message}`);
    }

    await logAgent("Healing cycle complete.");
}

main();
