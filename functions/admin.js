/**
 * /admin
 * Edge-secured Admin Dashboard
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    
    // 1. Authentication (Basic Auth & Bearer Token fallback)
    const validToken = (env.CF_ADMIN_TOKEN || 'ofwAk026').trim();
    const expectedUser = 'admin';
    const expectedPass = validToken;
    
    let isAuthorized = false;
    let finalToken = '';

    const authHeader = request.headers.get('Authorization');
    const urlToken = url.searchParams.get('t');

    if (urlToken === validToken) {
        isAuthorized = true;
        finalToken = urlToken;
    } else if (authHeader) {
        if (authHeader.startsWith('Basic ')) {
            try {
                const b64 = authHeader.replace('Basic ', '');
                // atob is available in Cloudflare Workers
                const credentials = atob(b64);
                const [user, pass] = credentials.split(':');
                if (user === expectedUser && pass === expectedPass) {
                    isAuthorized = true;
                    // Standardize to Bearer for client storage if reached via Basic
                    finalToken = pass; 
                }
            } catch (e) {
                // b64 error
            }
        } else if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            if (token === validToken) {
                isAuthorized = true;
                finalToken = token;
            }
        }
    }

    // 2. Enforce Authentication
    if (!isAuthorized) {
        return new Response('401 Unauthorized - Admin access restricted.', {
            status: 401,
            headers: {
                'WWW-Authenticate': 'Basic realm="Admin Access"',
                'Content-Type': 'text/plain'
            }
        });
    }

    // 2. Serve the Admin HTML
    // (Content captured from public/admin.html)
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Control Panel | OFW PesoRate Admin</title>
    <meta name="description" content="OFW PesoRate Admin Dashboard — system health, currency analytics, and monitoring.">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0e1a;
            --bg-elevated: #111827;
            --glass-bg: rgba(17, 24, 39, 0.65);
            --glass-bg-hover: rgba(17, 24, 39, 0.80);
            --glass-border: rgba(255, 255, 255, 0.08);
            --glass-border-hover: rgba(255, 255, 255, 0.14);
            --card-bg: rgba(31, 41, 55, 0.55);
            --card-border: rgba(255, 255, 255, 0.07);
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent: #3b82f6;
            --accent-glow: rgba(59, 130, 246, 0.25);
            --accent-soft: rgba(59, 130, 246, 0.12);
            --success: #22c55e;
            --success-soft: rgba(34, 197, 94, 0.12);
            --warning: #f59e0b;
            --warning-soft: rgba(245, 158, 11, 0.12);
            --danger: #ef4444;
            --danger-soft: rgba(239, 68, 68, 0.12);
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 16px;
            --radius-xl: 20px;
            --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
            --shadow-md: 0 4px 16px rgba(0,0,0,0.25);
            --shadow-lg: 0 8px 32px rgba(0,0,0,0.35);
            --transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            background: var(--bg);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            -webkit-font-smoothing: antialiased;
            overflow: hidden;
        }

        body::before {
            content: '';
            position: fixed;
            top: -20%;
            left: -10%;
            width: 500px;
            height: 500px;
            background: radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
        }
        body::after {
            content: '';
            position: fixed;
            bottom: -20%;
            right: -10%;
            width: 600px;
            height: 600px;
            background: radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
        }

        .sidebar {
            width: 260px;
            background: var(--bg-elevated);
            border-right: 1px solid var(--glass-border);
            display: flex;
            flex-direction: column;
            padding: 24px;
            flex-shrink: 0;
            z-index: 10;
            backdrop-filter: blur(20px);
        }
        .sidebar-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 40px;
        }
        .logo-box {
            width: 36px; height: 36px;
            background: linear-gradient(135deg, var(--accent), #8b5cf6);
            border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            font-weight: 800; color: white; font-size: 1.1rem;
            box-shadow: 0 0 20px var(--accent-glow);
        }
        .logo-text { font-size: 1.05rem; font-weight: 700; letter-spacing: -0.5px; }

        .nav-item {
            display: flex; align-items: center; gap: 12px;
            padding: 11px 16px; border-radius: var(--radius-md);
            color: var(--text-secondary); text-decoration: none;
            font-size: 0.9rem; font-weight: 500;
            transition: all var(--transition); margin-bottom: 2px;
            border: 1px solid transparent;
        }
        .nav-item:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
        .nav-item.active {
            background: var(--accent-soft);
            color: var(--accent);
            border-color: rgba(59,130,246,0.15);
            font-weight: 600;
        }
        .nav-icon { font-size: 1.1rem; width: 22px; text-align: center; }

        .main {
            flex-grow: 1;
            padding: 32px 40px;
            overflow-y: auto;
            z-index: 1;
            max-height: 100vh;
        }

        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
        }
        .page-title h1 {
            font-size: 1.65rem;
            font-weight: 800;
            letter-spacing: -0.8px;
            background: linear-gradient(135deg, #f1f5f9, #93c5fd);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .page-title p { color: var(--text-secondary); font-size: 0.88rem; margin-top: 2px; }

        .top-actions { display: flex; gap: 10px; align-items: center; }

        .status-bar {
            display: flex;
            gap: 16px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }
        .status-item {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 14px;
            background: var(--glass-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-md);
            font-size: 0.8rem;
            color: var(--text-secondary);
            transition: all var(--transition);
        }
        .status-dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .status-dot.healthy { background: var(--success); box-shadow: 0 0 8px rgba(34,197,94,0.5); }
        .status-dot.degraded { background: var(--warning); box-shadow: 0 0 8px rgba(245,158,11,0.5); }
        .status-dot.down { background: var(--danger); box-shadow: 0 0 8px rgba(239,68,68,0.5); }
        .status-dot.unknown { background: var(--text-muted); }

        .status-dot.healthy, .status-dot.degraded, .status-dot.down {
            animation: pulse-glow 2s infinite;
        }

        @keyframes pulse-glow {
            0%, 100% { opacity: 0.7; }
            50% { opacity: 1; }
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        .stat-card {
            background: var(--glass-bg);
            backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-lg);
            padding: 22px;
            transition: all var(--transition);
            position: relative;
            overflow: hidden;
        }
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
        }
        .stat-card:hover {
            border-color: var(--glass-border-hover);
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
        }
        .stat-label {
            color: var(--text-muted);
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 10px;
        }
        .stat-value {
            font-size: 1.65rem;
            font-weight: 700;
            letter-spacing: -0.5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .stat-sub {
            font-size: 0.78rem;
            color: var(--text-muted);
            margin-top: 6px;
        }
        .pill {
            font-size: 0.68rem;
            padding: 3px 8px;
            border-radius: 20px;
            font-weight: 600;
            letter-spacing: 0.3px;
        }
        .pill-success { background: var(--success-soft); color: var(--success); border: 1px solid rgba(34,197,94,0.15); }
        .pill-warning { background: var(--warning-soft); color: var(--warning); border: 1px solid rgba(245,158,11,0.15); }
        .pill-danger { background: var(--danger-soft); color: var(--danger); border: 1px solid rgba(239,68,68,0.15); }

        .card {
            background: var(--glass-bg);
            backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-xl);
            overflow: hidden;
            margin-bottom: 20px;
            transition: all var(--transition);
        }
        .card:hover { border-color: var(--glass-border-hover); }
        .card-header {
            padding: 20px 24px;
            border-bottom: 1px solid var(--glass-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .card-header h2 { font-size: 1rem; font-weight: 700; letter-spacing: -0.3px; }
        .card-body { padding: 24px; }

        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 20px; }

        @media (max-width: 1200px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }
        @media (max-width: 768px) {
            .sidebar { display: none; }
            .main { padding: 20px; }
            .stats-grid { grid-template-columns: 1fr 1fr; }
        }

        table { width: 100%; border-collapse: collapse; }
        th {
            padding: 12px 20px;
            text-align: left;
            font-size: 0.72rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            border-bottom: 1px solid var(--glass-border);
        }
        td {
            padding: 14px 20px;
            font-size: 0.88rem;
            border-bottom: 1px solid rgba(255,255,255,0.03);
            color: var(--text-primary);
        }
        tr:last-child td { border-bottom: none; }
        tr { transition: background var(--transition); }
        tr:hover td { background: rgba(255,255,255,0.02); }

        .flag { font-size: 1.15rem; margin-right: 6px; }
        .currency-code { font-family: 'SF Mono', 'JetBrains Mono', monospace; font-weight: 700; color: var(--accent); font-size: 0.85rem; }

        .btn {
            padding: 9px 16px;
            border-radius: var(--radius-sm);
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
            border: none;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            letter-spacing: -0.1px;
        }
        .btn:active { transform: scale(0.97); }
        .btn-primary {
            background: linear-gradient(135deg, var(--accent), #6366f1);
            color: white;
            box-shadow: 0 2px 12px var(--accent-glow);
        }
        .btn-primary:hover { box-shadow: 0 4px 20px rgba(59,130,246,0.4); transform: translateY(-1px); }
        .btn-outline {
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--glass-border);
            color: var(--text-secondary);
        }
        .btn-outline:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); border-color: var(--glass-border-hover); }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
        }

        .chart-container {
            position: relative;
            width: 100%;
            height: 260px;
        }
        .chart-container canvas {
            width: 100% !important;
            height: 100% !important;
        }

        .bar-chart-container {
            position: relative;
            width: 100%;
            min-height: 240px;
        }
        .bar-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 6px 0;
        }
        .bar-label {
            flex-shrink: 0;
            width: 140px;
            font-size: 0.82rem;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .bar-track {
            flex-grow: 1;
            height: 24px;
            background: rgba(255,255,255,0.03);
            border-radius: 6px;
            overflow: hidden;
            position: relative;
        }
        .bar-fill {
            height: 100%;
            border-radius: 6px;
            background: linear-gradient(90deg, var(--accent), #8b5cf6);
            transition: width 0.8s cubic-bezier(0.25, 1, 0.5, 1);
            min-width: 2px;
        }
        .bar-value {
            flex-shrink: 0;
            width: 60px;
            text-align: right;
            font-size: 0.82rem;
            font-weight: 600;
            color: var(--text-primary);
        }

        .skeleton {
            background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.8s ease-in-out infinite;
            border-radius: var(--radius-sm);
        }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .skeleton-text { height: 14px; width: 80%; margin-bottom: 8px; }
        .skeleton-value { height: 28px; width: 60%; }
        .skeleton-chart { height: 200px; width: 100%; border-radius: var(--radius-md); }

        .log-panel {
            max-height: 260px;
            overflow-y: auto;
            padding: 16px 20px;
        }
        .log-panel::-webkit-scrollbar { width: 4px; }
        .log-panel::-webkit-scrollbar-track { background: transparent; }
        .log-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .log-entry {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.03);
            font-size: 0.8rem;
        }
        .log-entry:last-child { border-bottom: none; }
        .log-time { color: var(--text-muted); font-family: monospace; flex-shrink: 0; font-size: 0.72rem; }
        .log-msg { color: var(--text-secondary); }
        .log-level {
            flex-shrink: 0;
            font-size: 0.65rem;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .log-level.info { background: var(--accent-soft); color: var(--accent); }
        .log-level.warn { background: var(--warning-soft); color: var(--warning); }
        .log-level.error { background: var(--danger-soft); color: var(--danger); }
        .log-level.success { background: var(--success-soft); color: var(--success); }

        .currency-filter {
            display: flex; gap: 6px; flex-wrap: wrap;
        }
        .currency-chip {
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.72rem;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid var(--glass-border);
            background: transparent;
            color: var(--text-secondary);
            font-family: 'SF Mono', monospace;
            transition: all var(--transition);
        }
        .currency-chip:hover { border-color: var(--accent); color: var(--accent); }
        .currency-chip.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }

        .chart-tooltip {
            position: absolute;
            background: rgba(15,23,42,0.95);
            backdrop-filter: blur(12px);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-sm);
            padding: 10px 14px;
            font-size: 0.78rem;
            pointer-events: none;
            z-index: 100;
            opacity: 0;
            transition: opacity 0.15s;
            box-shadow: var(--shadow-lg);
        }
        .chart-tooltip.visible { opacity: 1; }
        .tooltip-date { color: var(--text-muted); font-size: 0.7rem; margin-bottom: 4px; }
        .tooltip-value { font-weight: 700; color: var(--text-primary); }
        .tooltip-change { font-size: 0.7rem; margin-top: 2px; }
        .tooltip-change.up { color: var(--success); }
        .tooltip-change.down { color: var(--danger); }

        .hidden { display: none !important; }

        .toast-container {
            position: fixed; top: 20px; right: 20px; z-index: 2000;
            display: flex; flex-direction: column; gap: 8px;
        }
        .toast {
            padding: 12px 18px;
            border-radius: var(--radius-md);
            font-size: 0.82rem;
            font-weight: 500;
            backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
            box-shadow: var(--shadow-md);
            animation: toast-in 0.3s ease, toast-out 0.3s ease 3.7s forwards;
            display: flex; align-items: center; gap: 8px;
        }
        .toast-success { background: rgba(34,197,94,0.15); color: var(--success); border-color: rgba(34,197,94,0.2); }
        .toast-error { background: rgba(239,68,68,0.15); color: var(--danger); border-color: rgba(239,68,68,0.2); }
        .toast-info { background: rgba(59,130,246,0.15); color: var(--accent); border-color: rgba(59,130,246,0.2); }

        @keyframes toast-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes toast-out { from { opacity: 1; } to { opacity: 0; transform: translateX(40px); } }

        .main::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

        /* Utility classes for DevOps Pulse Bar */
        .flex { display: flex; }
        .flex-1 { flex: 1; }
        .flex-col { flex-direction: column; }
        .items-center { align-items: center; }
        .justify-between { justify-content: space-between; }
        .gap-1 { gap: 0.25rem; }
        .gap-2 { gap: 0.5rem; }
        .gap-4 { gap: 1rem; }
        .h-3 { height: 0.75rem; }
        .rounded-sm { border-radius: 2px; }
        .mb-2 { margin-bottom: 0.5rem; }
        .mb-4 { margin-bottom: 1rem; }
        .tracking-wider { letter-spacing: 0.05em; }
        .uppercase { text-transform: uppercase; }
        .font-mono { font-family: 'SF Mono', 'JetBrains Mono', monospace; }
        .font-bold { font-weight: 700; }
        .opacity-40 { opacity: 0.4; }
        .text-white\/40 { color: rgba(255,255,255,0.4); }
        .text-\[10px\] { font-size: 10px; }
    </style>
</head>
<body>

    <div class="toast-container" id="toast-container"></div>

    <aside class="sidebar">
        <div class="sidebar-header">
            <div class="logo-box">₱</div>
            <span class="logo-text">OFW PesoRate</span>
        </div>
        <nav>
            <a href="#" class="nav-item active">
                <span class="nav-icon">📊</span> Dashboard
            </a>
            <a href="#" class="nav-item" onclick="scrollToSection('social-section')">
                <span class="nav-icon">📱</span> Social Traffic
                <span id="social-nav-badge" style="margin-left:auto;font-size:0.65rem;padding:2px 7px;border-radius:10px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:700;display:none">!</span>
            </a>
            <a href="#" class="nav-item" onclick="scrollToSection('analytics-section')">
                <span class="nav-icon">🌍</span> Analytics
            </a>
            <a href="#" class="nav-item" onclick="scrollToSection('charts-section')">
                <span class="nav-icon">💱</span> Currency Trends
            </a>
            <a href="#" class="nav-item" onclick="scrollToSection('health-section')">
                <span class="nav-icon">🔧</span> System Health
            </a>
        </nav>
        <div style="margin-top: auto">
            <a href="#" class="nav-item" id="logout-btn">
                <span class="nav-icon">🚪</span> Log out
            </a>
        </div>
    </aside>

    <main class="main" id="main-content">
        <div class="top-bar">
            <div class="page-title">
                <h1>Dashboard</h1>
                <p>System metrics & currency health monitoring</p>
            </div>
            <div class="top-actions">
                <button class="btn btn-outline" id="cleanup-btn">🗑 Cleanup</button>
                <button class="btn btn-outline" id="sync-btn">🔄 Sync</button>
                <button class="btn btn-primary" id="snapshot-btn">📸 Snapshot</button>
            </div>
        </div>

        <div class="status-bar" id="status-bar">
            <div class="status-item">
                <span class="status-dot unknown" id="api-status-dot"></span>
                <span>API: <strong id="api-status-text">Checking…</strong></span>
            </div>
            <div class="status-item">
                <span class="status-dot unknown" id="db-status-dot"></span>
                <span>DB: <strong id="db-status-text">Checking…</strong></span>
            </div>
            <div class="status-item" id="sync-timestamp-item">
                🕐 Last Sync: <strong id="sync-timestamp-text">--:--</strong>
            </div>
            <div class="status-item" id="response-time-item">
                ⚡ Response: <strong id="response-time-text">-- ms</strong>
            </div>
            <div class="status-item" id="social-status-item" style="cursor:pointer" onclick="scrollToSection('social-section')">
                📱 Social: <strong id="social-status-text">Loading…</strong>
            </div>
        </div>

        <div class="stats-grid" id="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Active Countries</div>
                <div class="stat-value" id="stat-countries"><span class="skeleton skeleton-value" style="width:40px; height:28px"></span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Users</div>
                <div class="stat-value" id="stat-users"><span class="skeleton skeleton-value" style="width:50px; height:28px"></span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Conversions (7d)</div>
                <div class="stat-value" id="stat-conversions"><span class="skeleton skeleton-value" style="width:50px; height:28px"></span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Snapshot Status</div>
                <div class="stat-value" id="stat-snapshot" style="font-size: 1.1rem"><span class="skeleton skeleton-value" style="width:80px; height:28px"></span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Retention Policy</div>
                <div class="stat-value" style="font-size: 1.1rem">7 Days</div>
                <div class="stat-sub" id="stat-cleanup">Last Purge: --:--</div>
            </div>
        </div>

        <div id="social-section" style="margin-bottom: 20px;">
            <div class="card">
                <div class="card-header">
                    <h2>📱 Social Media Traffic</h2>
                    <div style="display:flex;gap:10px;align-items:center">
                        <span id="social-healing-badge" class="pill pill-success" style="display:none;background:rgba(34,197,94,0.1);color:var(--success)">✨ Self-Healing Active</span>
                        <button id="heal-social-btn" class="btn btn-outline" style="padding:4px 10px;font-size:0.7rem;border-color:var(--success-soft);color:var(--success)">🔧 Heal Now</button>
                        <span id="social-total-badge" style="font-size:0.75rem;color:var(--text-muted)">7-day window</span>
                        <span id="social-error-badge" class="pill pill-danger" style="display:none">0 failures</span>
                    </div>
                </div>
                <div class="card-body">
                    <div id="social-platform-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px">
                        <div class="skeleton skeleton-chart" style="height:90px"></div>
                        <div class="skeleton skeleton-chart" style="height:90px"></div>
                        <div class="skeleton skeleton-chart" style="height:90px"></div>
                        <div class="skeleton skeleton-chart" style="height:90px"></div>
                    </div>
                    <div id="social-bar-chart" style="margin-top:8px">
                        <div class="skeleton skeleton-chart" style="height:160px"></div>
                    </div>
                    <div id="social-failures-panel" class="hidden" style="margin-top:20px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px 20px">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                            <span style="font-size:1.2rem">⚠️</span>
                            <strong style="color:#ef4444">Failed Loads Detected</strong>
                            <span id="social-failure-count" class="pill pill-danger" style="margin-left:4px">0</span>
                        </div>
                        <div id="social-failure-body" style="font-size:0.83rem;color:var(--text-secondary);margin-bottom:12px">Loading failed load data…</div>
                        <div id="social-healing-history" style="font-size:0.7rem;padding-top:10px;border-top:1px solid rgba(239,68,68,0.1)">
                            <div style="color:var(--text-muted);margin-bottom:4px">Recovery History:</div>
                            <div id="healing-logs-list" style="display:flex;flex-direction:column;gap:4px"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="analytics-section">
            <div class="grid-2">
                <div class="card">
                    <div class="card-header">
                        <h2>🌍 Users by Country</h2>
                        <span style="font-size: 0.75rem; color: var(--text-muted)" id="country-sort-label">Top performers</span>
                    </div>
                    <div class="card-body" id="country-chart-body">
                        <div class="skeleton skeleton-chart"></div>
                    </div>
                </div>
                <div class="card">
                    <div class="card-header">
                        <h2>📈 Conversion Rates</h2>
                        <span style="font-size: 0.75rem; color: var(--text-muted)">by country</span>
                    </div>
                    <!-- System Health & Status -->
                    <div class="card p-6 rounded-2xl border border-white/10" id="devops-card">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-lg font-semibold flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                                DevOps Engine Monitor
                            </h3>
                            <span id="devops-verdict" class="px-3 py-1 rounded-full text-xs font-bold bg-white/5 border border-white/10">Scanning...</span>
                        </div>
                        <div id="devops-content" class="space-y-4">
                            <div class="grid grid-cols-2 gap-4">
                                <div class="p-3 rounded-xl bg-white/5 border border-white/10">
                                    <p class="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Avg Latency (1h)</p>
                                    <p class="text-xl font-bold font-mono" id="metrics-latency">--</p>
                                </div>
                                <div class="p-3 rounded-xl bg-white/5 border border-white/10">
                                    <p class="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Daily Budget</p>
                                    <p class="text-xl font-bold font-mono" id="metrics-budget">--</p>
                                </div>
                            </div>
                            <div id="devops-alerts" class="space-y-2"></div>
                            <div class="border-t border-white/10 pt-4 mt-4">
                                <p class="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Audit History (Last 5 Checks)</p>
                                <div id="audit-history" class="space-y-1 font-mono text-[10px]"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Sync Controls -->
                    <div class="card p-6 rounded-2xl border border-white/10">
                        <div class="skeleton skeleton-chart"></div>
                    </div>
                </div>
            </div>
        </div>

        <div id="charts-section">
            <div class="card">
                <div class="card-header">
                    <h2>💱 Real-Time Currency Trends</h2>
                    <div style="display:flex;align-items:center;gap:12px">
                        <span id="trend-live-badge"></span>
                        <div class="currency-filter" id="currency-filter"></div>
                    </div>
                </div>
                <div class="card-body">
                    <div class="chart-container" id="trend-chart-container">
                        <canvas id="trend-chart"></canvas>
                        <div class="chart-tooltip" id="trend-tooltip">
                            <div class="tooltip-date" id="tooltip-date"></div>
                            <div class="tooltip-value" id="tooltip-value"></div>
                            <div class="tooltip-change" id="tooltip-change"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Real-Time Currency Monitor (vs PHP)</h2>
                <span style="font-size: 0.75rem; color: var(--text-muted)" id="rate-source-val">Source: --</span>
            </div>
            <div style="max-height: 420px; overflow-y: auto">
                <table id="rate-table">
                    <thead>
                        <tr>
                            <th>Country</th>
                            <th>Currency</th>
                            <th>Rate (PHP)</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="rate-table-body">
                        <tr><td colspan="4" style="text-align:center; padding: 40px"><div class="skeleton skeleton-chart" style="height:120px"></div></td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div id="health-section">
            <div class="card">
                <div class="card-header">
                    <h2>🔧 System Health</h2>
                    <span style="font-size: 0.75rem; color: var(--text-muted)" id="log-count">0 events</span>
                </div>
                <div class="log-panel" id="log-panel">
                    <div class="log-entry">
                        <span class="log-level info">INFO</span>
                        <span class="log-time">--:--:--</span>
                        <span class="log-msg">Waiting for dashboard initialization…</span>
                    </div>
                </div>
            </div>
        </div>

        <div style="height: 40px"></div>
    </main>

    <div id="loading-watchdog-overlay" class="hidden" style="position:fixed; inset:0; z-index: 9999; background: rgba(10,15,30,0.95); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px;">
        <div style="font-size: 4rem; margin-bottom: 20px;">⏳</div>
        <h2 style="color: #fff; margin-bottom: 15px;">Connection Timeout</h2>
        <p style="color: var(--text-secondary); max-width: 400px; margin-bottom: 30px; line-height: 1.6;">
            The dashboard is taking longer than expected to load. This might be due to a slow connection or a temporary API issue.
        </p>
        <div style="display: flex; gap: 15px;">
            <button class="btn btn-primary" onclick="location.reload(true)" style="padding: 12px 24px; border-radius: 12px; cursor: pointer;">🔄 Refresh Page</button>
            <button class="btn btn-outline" id="force-reset-btn" style="padding: 12px 24px; border-radius: 12px; cursor: pointer;">🧹 Force Reset</button>
        </div>
        <p style="margin-top: 30px; font-size: 0.75rem; color: rgba(255,255,255,0.2);">
            Error code: DASHBOARD_INIT_TIMEOUT
        </p>
    </div>

    <script>
        // Store securely authenticated token so admin.js can read it upon boot
        const injectedToken = "${finalToken}";
        if (injectedToken) {
            sessionStorage.setItem('ofw_admin_token', injectedToken);
        }
    </script>
    <script src="admin.js?v=4.0.2"></script>
    <script>

        setTimeout(() => {
            if (!window.dashboardInitialized) {
                const overlay = document.getElementById('loading-watchdog-overlay');
                if (overlay) overlay.classList.remove('hidden');
            }
        }, 8000);

        document.getElementById('force-reset-btn').addEventListener('click', () => {
            sessionStorage.clear();
            localStorage.clear();
            if (navigator.serviceWorker) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    for(let registration of registrations) registration.unregister();
                });
            }
            location.href = '/admin'; // Native Basic auth will handle credentials on reload
        });
    </script>
</body>
</html>`;

    return new Response(html, {
        headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Frame-Options': 'DENY'
        }
    });
}
