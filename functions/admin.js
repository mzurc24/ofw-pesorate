/**
 * /admin
 * Premium Admin Dashboard Worker
 * Serves the glassmorphism management interface for the OFW Pesorate Platform.
 */

export async function onRequest(context) {
    const { request, env } = context;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Control Panel | OFW PesoRate Admin</title>
    <style>
        :root {
            --accent: #0071e3;
            --glass-bg: rgba(255, 255, 255, 0.04);
            --glass-border: rgba(255, 255, 255, 0.1);
            --success: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text-primary: #f8fafc;
            --text-muted: #94a3b8;
        }

        * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

        body {
            background: #000;
            color: var(--text-primary);
            min-height: 100vh;
            overflow-x: hidden;
        }

        .background-gradient {
            position: fixed;
            inset: 0;
            background: radial-gradient(circle at 50% -20%, #1e293b, #000);
            z-index: -1;
        }

        /* 🔒 AUTH OVERLAY */
        .auth-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(40px);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.5s ease;
        }

        .auth-card {
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            padding: 40px;
            border-radius: 28px;
            width: 360px;
            text-align: center;
            box-shadow: 0 40px 100px rgba(0,0,0,0.5);
        }

        .auth-card h2 { margin-bottom: 24px; font-weight: 800; letter-spacing: -1px; }

        input {
            width: 100%;
            padding: 14px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            color: white;
            text-align: center;
            font-size: 1rem;
            margin-bottom: 20px;
            outline: none;
        }

        button.login-btn {
            width: 100%;
            padding: 14px;
            background: var(--accent);
            border: none;
            border-radius: 12px;
            color: white;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 10px 40px rgba(0, 113, 227, 0.4);
        }

        .hidden { display: none !important; opacity: 0; pointer-events: none; }

        /* 📋 DASHBOARD MAIN */
        .dashboard-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
        }

        .status-bar {
            display: flex;
            gap: 20px;
            background: var(--glass-bg);
            padding: 10px 20px;
            border-radius: 40px;
            border: 1px solid var(--glass-border);
            font-size: 0.8rem;
        }

        .status-item { display: flex; align-items: center; gap: 8px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #444; }
        .dot.healthy { background: var(--success); box-shadow: 0 0 10px var(--success); }

        /* 📊 STATS GRID */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }

        .stat-card {
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            padding: 24px;
            border-radius: 20px;
            transition: transform 0.2s;
        }

        .stat-card:hover { transform: translateY(-5px); border-color: rgba(255,255,255,0.2); }
        .stat-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .stat-value { font-size: 1.8rem; font-weight: 800; letter-spacing: -1px; }

        /* ⚙️ CONTROLS */
        .controls-panel {
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            border-radius: 24px;
            padding: 30px;
            margin-bottom: 40px;
        }

        .panel-title { font-weight: 800; margin-bottom: 24px; font-size: 1.2rem; }

        .btn-group { display: flex; gap: 12px; flex-wrap: wrap; }

        .action-btn {
            padding: 12px 24px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.03);
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .action-btn:hover { background: rgba(255,255,255,0.08); }
        .action-btn.primary { background: var(--accent); border: none; }

        /* 📝 RATE TABLE */
        .table-container {
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            border-radius: 24px;
            overflow: hidden;
        }

        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 20px; background: rgba(255,255,255,0.02); color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; }
        td { padding: 20px; border-bottom: 1px solid var(--glass-border); }

        .flag { font-size: 1.4rem; margin-right: 10px; }
    </style>
</head>
<body>
    <div class="background-gradient"></div>

    <!-- 🔒 AUTH -->
    <div id="auth-overlay" class="auth-overlay">
        <div class="auth-card">
            <h2>Admin Login</h2>
            <input type="password" id="admin-token-input" placeholder="Secure Entry Token..." autocomplete="off">
            <p id="auth-error" style="color:var(--danger); font-size:0.8rem; margin-bottom:15px;" class="hidden">Invalid credential. Try again.</p>
            <button id="login-btn" class="login-btn">Secure Login</button>
        </div>
    </div>

    <!-- 📋 MAIN DASHBOARD -->
    <div class="dashboard-container">
        <header>
            <div>
                <h1 style="font-weight:900; letter-spacing:-1.5px; font-size:2rem;">Dashboard</h1>
                <p style="color:var(--text-muted); font-size:0.9rem;">Global Platform Oversight</p>
            </div>

            <div class="status-bar">
                <div class="status-item"><div id="api-status-dot" class="dot"></div> <span id="api-status-text">Connecting...</span></div>
                <div class="status-item"><div id="db-status-dot" class="dot"></div> <span id="db-status-text">Database</span></div>
                <button id="logout-btn" style="background:none; border:none; color:var(--danger); font-size:0.75rem; cursor:pointer">LOGOUT</button>
            </div>
        </header>

        <main>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Active Markets</div>
                    <div id="stat-countries" class="stat-value">--</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Users</div>
                    <div id="stat-users" class="stat-value">--</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Conversions (7d)</div>
                    <div id="stat-conversions" class="stat-value">--</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">System State</div>
                    <div id="rate-source-val" style="color:var(--success); font-weight:700; font-size:0.9rem; margin-top:5px;">IDLE</div>
                </div>
            </div>

            <div class="controls-panel">
                <div class="panel-title">Operations Control</div>
                <div class="btn-group">
                    <button id="sync-btn" class="action-btn primary">Manual Rate Sync</button>
                    <button id="snapshot-btn" class="action-btn">Daily Snapshot</button>
                    <button id="heal-social-btn" class="action-btn">🔧 Heal CDN</button>
                    <button id="cleanup-btn" class="action-btn" style="color:var(--danger)">Wipe Logs</button>
                </div>
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Corridor</th>
                            <th>Currency</th>
                            <th>Current Rate</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="rate-table-body">
                        <!-- Populated by JS -->
                    </tbody>
                </table>
            </div>
        </main>
    </div>

    <script src="/admin.js?v=4.2.0"></script>
</body>
</html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
}
