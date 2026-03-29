/**
 * /api/admin/devops
 * Advanced DevOps Analysis Engine (v1.0.0)
 * Performs hourly deep-scan of system health, error rates, and credit budgets.
 * Returns the final 'Maintenance Authorization' for automated tasks.
 * Security: Bearer Token Auth
 */

import { checkAdminAuth } from './_auth.js';

export async function onRequest(context) {

    const { request, env } = context;

    // 1. Security Check
    const auth = checkAdminAuth(request, env);
    if (!auth.authorized) return auth.response;


    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    const hourAgo = now - (60 * 60 * 1000);

    try {
        if (!env.DB) throw new Error('Database connection missing');

        /**
         * 2. Comprehensive Metric Scan
         * Scan 1: Last 24h Error Metrics (api_logs, healing_logs)
         * Scan 2: Last 1h Performance (health_logs)
         * Scan 3: Credit Budget Protection (api_usage)
         */
        const [apiLogs, healingLogs, healthLogs, usageRow, auditHistory] = await env.DB.batch([
            env.DB.prepare("SELECT status, COUNT(*) as count FROM api_logs WHERE timestamp >= datetime('now', '-24 hours') GROUP BY status"),
            env.DB.prepare("SELECT status, COUNT(*) as count FROM healing_logs WHERE timestamp >= ? GROUP BY status").bind(hourAgo),
            env.DB.prepare("SELECT response_time_ms, status FROM health_logs WHERE timestamp >= datetime('now', '-1 hour') ORDER BY timestamp DESC LIMIT 10"),
            env.DB.prepare("SELECT fixer_calls FROM api_usage WHERE month = ?").bind(today).first(),
            env.DB.prepare("SELECT status, timestamp FROM devops_audit ORDER BY timestamp DESC LIMIT 5")
        ]);

        // 3. Health Analysis Logic
        const apiStats = Object.fromEntries(apiLogs.results.map(r => [r.status, r.count]));
        const failCount = apiStats['fail_twelve_data'] || 0;
        const successCount = apiStats['success_twelve_data'] || 0;
        const totalSyncs = failCount + successCount;
        const errorRate = totalSyncs > 0 ? (failCount / totalSyncs) * 100 : 0;

        const latentHealth = healthLogs.results;
        const avgLatency = latentHealth.length > 0 
            ? latentHealth.reduce((acc, curr) => acc + curr.response_time_ms, 0) / latentHealth.length 
            : 0;

        const creditsUsedToday = usageRow?.fixer_calls || 0;
        const creditsRemaining = 700 - creditsUsedToday;

        /**
         * 4. Verdict Engine (DevOps AI Rules)
         * Rule A: If Error Rate > 20% over 24h → DEGRADED
         * Rule B: If Latest Health Check is 'down' → DOWN
         * Rule C: If Credits Remaining < 24 → BLOCK_MAINTENANCE
         * Rule D: If Latency > 2000ms → DEGRADED
         */
        let status = 'HEALTHY';
        let maintenanceAllowed = true;
        const alerts = [];

        if (errorRate >= 20) {
            status = 'DEGRADED';
            alerts.push(`High API Error Rate: ${errorRate.toFixed(1)}%`);
        }

        if (latentHealth[0]?.status === 'down') {
            status = 'DOWN';
            maintenanceAllowed = false;
            alerts.push('Critical System Outage Detected (Latest Health: DOWN)');
        }

        if (avgLatency > 2000) {
            status = 'DEGRADED';
            alerts.push(`Critical Latency Spike: ${Math.round(avgLatency)}ms`);
        }

        if (creditsRemaining < 24) {
            maintenanceAllowed = false; // Cannot perform more Twelve Data calls
            alerts.push(`Quota Warning: Only ${creditsRemaining} credits left today. Maintenance blocked.`);
        }

        const findings = {
            twelve_data: { error_rate: errorRate, credits_used: creditsUsedToday, credits_left: creditsRemaining },
            performance: { avg_latency_1h: Math.round(avgLatency), sample_size: latentHealth.length },
            alerts: alerts,
            audit_history: auditHistory.results
        };

        // 5. Automated Audit Logging
        // This ensures the hourly check is recorded even if accessed via browser or Action.
        await env.DB.prepare(
            "INSERT INTO devops_audit (status, findings_json, actions_taken) VALUES (?, ?, ?)"
        ).bind(status, JSON.stringify(findings), maintenanceAllowed ? 'READY_FOR_TASKS' : 'MAINTENANCE_LOCKED').run();

        return new Response(JSON.stringify({
            success: true,
            status: status,
            allow_maintenance: maintenanceAllowed,
            findings: findings,
            timestamp: new Date().toISOString()
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'X-DevOps-Engine-Version': '1.0.0'
            }
        });

    } catch (err) {
        console.error('DevOps Engine Failure:', err.message);
        return new Response(JSON.stringify({
            success: false, status: 'UNKNOWN', allow_maintenance: false, error: err.message
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
