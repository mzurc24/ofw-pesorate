document.addEventListener('DOMContentLoaded', () => {
    const loginOverlay  = document.getElementById('login-overlay');
    const dashContent   = document.getElementById('dashboard-content');
    const tokenInput    = document.getElementById('token-input');
    const loginBtn      = document.getElementById('login-btn');
    const loginError    = document.getElementById('login-error');
    const refreshBtn    = document.getElementById('refresh-btn');
    const signoutBtn    = document.getElementById('signout-btn');
    const cronBadge     = document.getElementById('cron-badge');
    const lastUpdated   = document.getElementById('last-updated-label');

    let adminToken   = '';
    let chartInst    = null;
    let cronInterval = null;

    // ── Bootstrap ──────────────────────────────────────────────────
    // Try token from URL param first (redirect from login.html)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
        adminToken = urlToken;
        sessionStorage.setItem('admin_token', adminToken);
        // Clean URL without reload
        history.replaceState(null, '', '/admin.html');
        activate();
    } else {
        // Try session storage (already logged in)
        const stored = sessionStorage.getItem('admin_token');
        if (stored) {
            adminToken = stored;
            activate();
        }
    }

    // ── Login ───────────────────────────────────────────────────────
    loginBtn.addEventListener('click', doLogin);
    tokenInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });

    async function doLogin() {
        const tok = tokenInput.value.trim();
        if (!tok) return;
        loginBtn.textContent = 'Checking...';
        loginBtn.disabled = true;
        loginError.style.display = 'none';

        try {
            const res = await fetch('/api/admin/metrics', {
                headers: { 'Authorization': `Bearer ${tok}` }
            });
            if (!res.ok) throw new Error('auth');
            adminToken = tok;
            sessionStorage.setItem('admin_token', tok);
            activate();
        } catch {
            loginError.style.display = 'block';
            loginBtn.textContent = 'Access Dashboard';
            loginBtn.disabled = false;
        }
    }

    function activate() {
        loginOverlay.style.display   = 'none';
        dashContent.style.display    = 'block';
        loadDashboard();
        startCron();
    }

    // ── Sign Out ────────────────────────────────────────────────────
    signoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('admin_token');
        clearInterval(cronInterval);
        loginOverlay.style.display = 'flex';
        dashContent.style.display  = 'none';
        tokenInput.value = '';
        adminToken = '';
    });

    // ── Refresh ─────────────────────────────────────────────────────
    refreshBtn.addEventListener('click', loadDashboard);

    // ── Auto-refresh every 60s ──────────────────────────────────────
    function startCron() {
        let remaining = 60;
        cronBadge.textContent = `Auto-refresh: ${remaining}s`;
        cronInterval = setInterval(() => {
            remaining--;
            cronBadge.textContent = `Auto-refresh: ${remaining}s`;
            if (remaining <= 0) {
                remaining = 60;
                loadDashboard();
            }
        }, 1000);
    }

    // ── Load Dashboard Data ─────────────────────────────────────────
    async function loadDashboard() {
        refreshBtn.textContent = '↻ Refreshing...';
        refreshBtn.disabled    = true;

        try {
            const res = await fetch('/api/admin/metrics', {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });

            if (res.status === 401) {
                signoutBtn.click();
                return;
            }

            if (!res.ok) throw new Error('Failed');
            const data = await res.json();

            // Stats
            const m = data.metrics || {};
            document.getElementById('stat-users').textContent       = fmt(m.newUsers7d ?? 0);
            document.getElementById('stat-conversions').textContent = fmt(m.conversions7d ?? 0);
            document.getElementById('stat-countries').textContent   = fmt(m.countries ?? '—');

            const daily  = data.daily || [];
            const avgVal = daily.length
                ? Math.round(daily.reduce((s, d) => s + (d.conversions||0), 0) / daily.length)
                : 0;
            document.getElementById('stat-avg').textContent = fmt(avgVal);

            // Timestamp
            lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

            // Chart
            renderChart(daily);

            // Popular Pairs table
            const pairs = data.popularPairs || [];
            const totalConv = pairs.reduce((s, p) => s + (p.count || 0), 0);
            document.getElementById('pairs-count').textContent = `${pairs.length} pairs`;
            const pBody = document.getElementById('pairs-table');
            if (pairs.length === 0) {
                pBody.innerHTML = `<tr><td colspan="3" class="loading-row">No data yet</td></tr>`;
            } else {
                pBody.innerHTML = pairs.slice(0, 8).map((p, i) => {
                    const pct = totalConv > 0 ? ((p.count / totalConv) * 100).toFixed(1) : '0.0';
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                    return `<tr>
                        <td><span class="currency-pair">${medal} ${p.from_currency} <span class="currency-arrow">→</span> ${p.to_currency}</span></td>
                        <td>${fmt(p.count)}</td>
                        <td style="color:var(--text-3)">${pct}%</td>
                    </tr>`;
                }).join('');
            }

            // Users table
            const users = data.users || [];
            const uBody = document.getElementById('users-table');
            if (users.length === 0) {
                uBody.innerHTML = `<tr><td colspan="3" class="loading-row">No leads yet</td></tr>`;
            } else {
                uBody.innerHTML = users.slice(0, 8).map(u => {
                    const date = u.first_seen
                        ? new Date(u.first_seen).toLocaleDateString([], { month: 'short', day: 'numeric' })
                        : '—';
                    const flag = countryFlag(u.country);
                    return `<tr>
                        <td style="font-weight:500">${sanitize(u.name || u.id?.slice(0,8) || '—')}</td>
                        <td>${flag} ${u.country || '—'}</td>
                        <td style="color:var(--text-3)">${date}</td>
                    </tr>`;
                }).join('');
            }

        } catch (err) {
            console.error('Dashboard load error:', err);
        } finally {
            refreshBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh';
            refreshBtn.disabled = false;
        }
    }

    // ── Chart ───────────────────────────────────────────────────────
    function renderChart(dailyData) {
        const ctx = document.getElementById('dailyChart')?.getContext('2d');
        if (!ctx) return;

        const labels = dailyData.map(d => {
            const dt = new Date(d.date);
            return dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        });
        const values = dailyData.map(d => d.conversions || 0);

        if (chartInst) chartInst.destroy();

        chartInst = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Conversions',
                    data: values,
                    borderColor: '#3b82f6',
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const { ctx: c, chartArea } = chart;
                        if (!chartArea) return;
                        const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, 'rgba(59,130,246,0.25)');
                        gradient.addColorStop(1, 'rgba(59,130,246,0.0)');
                        return gradient;
                    },
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#3b82f6',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#18181b',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        titleColor: '#a1a1aa',
                        bodyColor: '#fafafa',
                        padding: 10,
                        callbacks: {
                            label: (ctx) => ` ${ctx.parsed.y} conversions`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#52525b', font: { size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        border: { display: false }
                    },
                    x: {
                        ticks: { color: '#52525b', font: { size: 11 } },
                        grid: { display: false },
                        border: { display: false }
                    }
                }
            }
        });
    }

    // ── Tab switching ──────────────────────────────────────────────
    window.switchTab = function(tab) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        event.currentTarget.classList.add('active');
    };

    // ── Helpers ────────────────────────────────────────────────────
    function fmt(n) {
        if (n === '—' || n == null) return '—';
        return Number(n).toLocaleString();
    }
    function sanitize(str) {
        return String(str).replace(/[<>&"']/g, '');
    }
    function countryFlag(code) {
        if (!code || code.length !== 2) return '';
        return String.fromCodePoint(
            ...code.toUpperCase().split('').map(c => 0x1F1E6 - 65 + c.charCodeAt(0))
        );
    }
});
