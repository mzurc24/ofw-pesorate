/**
 * scripts/devops_check.js
 * Advanced DevOps AI Monitoring Script
 * v1.0.0 (Twelve Data Engine)
 *
 * Designed to run hourly via GitHub Actions.
 * Analyzes system health and budget before allowing maintenance.
 */

const fs = require('fs');

async function checkHealth() {
    const ADMIN_TOKEN = process.env.CF_ADMIN_TOKEN || 'ofwAk026';
    const baseUrl = 'https://ofwpesorate.madzlab.site';

    console.log(`🔍 DevOps Check triggered at ${new Date().toISOString()}`);

    try {
        const response = await fetch(`${baseUrl}/api/admin/devops`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${ADMIN_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`❌ DevOps API failed with HTTP ${response.status}`);
            process.exit(1);
        }

        const data = await response.json();
        
        // 📊 Display Findings summary for GitHub Action Log
        console.log("-----------------------------------------");
        console.log(`📊 SYSTEM STATUS: ${data.status}`);
        console.log(`🛡️  MAINTENANCE ALLOWED: ${data.allow_maintenance ? 'YES' : 'NO'}`);
        console.log(`📉 Avg Latency (1h): ${data.findings.performance.avg_latency_1h}ms`);
        console.log(`💳 Credits Used Today: ${data.findings.twelve_data.credits_used}/700`);
        console.log(`💸 Credits Remaining: ${data.findings.twelve_data.credits_left}`);
        
        if (data.findings.alerts?.length) {
            console.log("\n⚠️  ACTIVE ALERTS:");
            data.findings.alerts.forEach(alert => console.log(`   - ${alert}`));
        }
        console.log("-----------------------------------------");

        // 🚨 Exit with error if CRITICAL outage detected
        if (data.status === 'DOWN') {
            console.error("⛔ CRITICAL: System is DOWN. Maintenance blocked.");
            process.exit(1);
        }

        // Output variables for GitHub Actions step dependencies
        // This is the standard way to set GITHUB_OUTPUT in Node.js
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `system_status=${data.status}\n`);
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `allow_maintenance=${data.allow_maintenance}\n`);
        }

    } catch (err) {
        console.error('❌ DevOps Script Failure:', err.message);
        process.exit(1);
    }
}

checkHealth();
