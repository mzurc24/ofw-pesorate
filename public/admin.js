(() => {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════
    // SECURITY: Strip secret token from URL to prevent history leaks
    // ══════════════════════════════════════════════════════════════════════
    if (window.history && window.history.replaceState) {
        const urlObj = new URL(window.location.href);
        if (urlObj.searchParams.has('t')) {
            urlObj.searchParams.delete('t');
            window.history.replaceState({ path: urlObj.href }, '', urlObj.href);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // DOM REFERENCES
    // ══════════════════════════════════════════════════════════════════════
    const $ = id => document.getElementById(id);

    const authOverlay   = $('auth-overlay');
    const tokenInput    = $('admin-token-input');
    const loginBtn      = $('login-btn');
    const authError     = $('auth-error');
    const logoutBtn     = $('logout-btn');

    // Status bar
    const apiStatusDot  = $('api-status-dot');
    const apiStatusText = $('api-status-text');
    const dbStatusDot   = $('db-status-dot');
    const dbStatusText  = $('db-status-text');
    const syncTimestamp  = $('sync-timestamp-text');
    const responseTime   = $('response-time-text');

    // Stats
    const statCountries    = $('stat-countries');
    const statUsers        = $('stat-users');
    const statConversions  = $('stat-conversions');
    const statSnapshot     = $('stat-snapshot');
    const statCleanup      = $('stat-cleanup');
    const sourceVal        = $('rate-source-val');
    const rateTableBody    = $('rate-table-body');

    // Buttons
    const cleanupBtn   = $('cleanup-btn');
    const syncBtn      = $('sync-btn');
    const snapshotBtn  = $('snapshot-btn');
    const healSocialBtn = $('heal-social-btn');

    // Charts / Analytics
    const countryChartBody     = $('country-chart-body');
    const conversionRatesBody  = $('conversion-rates-body');
    const currencyFilter       = $('currency-filter');
    const trendCanvas          = $('trend-chart');
    const trendTooltip         = $('trend-tooltip');
    const tooltipDate          = $('tooltip-date');
    const tooltipValue         = $('tooltip-value');
    const tooltipChange        = $('tooltip-change');

    // DevOps monitor
    const devopsVerdict   = $('devops-verdict');
    const metricsLatency  = $('metrics-latency');
    const metricsBudget   = $('metrics-budget');
    const devopsAlerts    = $('devops-alerts');
    const auditHistory    = $('audit-history');
    
    // Logs
    const logPanel        = $('log-body');

    // ══════════════════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════════════════
    let adminToken = sessionStorage.getItem('ofw_admin_token');
    let cachedSystemData = null;
    let cachedMetricsData = null;
    let selectedCurrencies = ['USD', 'SGD', 'SAR', 'GBP', 'AUD'];
    let logEntries = [];
    let refreshInterval = null;
    let requestQueue = [];
    let isProcessingQueue = false;
    const SWR_CACHE = new Map();
    const SWR_TTL = 30000; // 30s stale-while-revalidate

    // ══════════════════════════════════════════════════════════════════════
    // AUTH (PRESERVED EXACTLY)
    // ══════════════════════════════════════════════════════════════════════
    if (adminToken) {
        if (authOverlay) authOverlay.classList.add('hidden');
        initDashboard();
    }

    if (loginBtn && tokenInput && authError && authOverlay) {
        loginBtn.addEventListener('click', async () => {
            const token = tokenInput.value.trim();
            if (!token) return;

            loginBtn.disabled = true;
            loginBtn.textContent = 'Verifying…';
            authError.classList.add('hidden');

            const success = await verifyToken(token);
            if (success) {
                adminToken = token;
                sessionStorage.setItem('ofw_admin_token', token);
                authOverlay.classList.add('hidden');
                initDashboard();
            } else {
                authError.classList.remove('hidden');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Secure Login';
            }
        });

        tokenInput.addEventListener('keypress', e => { if (e.key === 'Enter') loginBtn.click(); });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('ofw_admin_token');
            if (refreshInterval) clearInterval(refreshInterval);
            location.href = '/';
        });
    }

    async function verifyToken(token) {
        try {
            const res = await fetch('/api/admin/system', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) { return false; }
    }

    // ══════════════════════════════════════════════════════════════════════
    // BUTTON HANDLERS
    // ══════════════════════════════════════════════════════════════════════
    // Heal Now button removed — CDN purge not required for normal operation
    // healSocialBtn handler intentionally omitted

    // ══════════════════════════════════════════════════════════════════════
    // CENTRALIZED API LAYER (with retry, SWR, queue)
    // ══════════════════════════════════════════════════════════════════════
    async function fetchWithRetry(url, options = {}, retries = 3) {
        const cacheKey = url + JSON.stringify(options);
        const cached = SWR_CACHE.get(cacheKey);

        // Stale-while-revalidate: return cached immediately if fresh enough
        if (cached && (Date.now() - cached.time < SWR_TTL)) {
            return cached.data;
        }

        let lastError = null;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const startMs = Date.now();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);

                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeout);

                const elapsed = Date.now() - startMs;

                if (res.status === 429) {
                    addLog('warn', `Rate limited (429) on ${url}. Backing off…`);
                    const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                    await sleep(backoff);
                    continue;
                }

                if (res.status === 401) {
                    addLog('error', 'Session expired. Logging out…');
                    logoutBtn.click();
                    return null;
                }

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();
                data._responseTime = elapsed;

                // Update SWR cache
                SWR_CACHE.set(cacheKey, { data, time: Date.now() });

                return data;

            } catch (e) {
                lastError = e;
                if (e.name === 'AbortError') {
                    addLog('warn', `Request timeout on ${url}. Attempt ${attempt + 1}/${retries}`);
                } else {
                    addLog('warn', `Fetch failed: ${e.message}. Attempt ${attempt + 1}/${retries}`);
                }

                if (attempt < retries - 1) {
                    const backoff = Math.pow(2, attempt) * 1000;
                    await sleep(backoff);
                }
            }
        }

        // All retries failed — use stale cache if available
        if (cached) {
            addLog('warn', `Using stale cache for ${url}`);
            return cached.data;
        }

        // If it was a critical fetch (system or metrics), return an empty object rather than null
        // so that the UI can at least render with empty states instead of hanging.
        addLog('error', `Failed after ${retries} retries: ${url}`);
        return { _failed: true };
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function authHeaders() {
        return { 'Authorization': `Bearer ${adminToken}` };
    }

    // ══════════════════════════════════════════════════════════════════════
    // DASHBOARD INIT & REFRESH
    // ══════════════════════════════════════════════════════════════════════
    function initDashboard() {
        addLog('info', 'Dashboard initialized — real-time sync active');
        refreshAll();
        refreshInterval = setInterval(refreshAll, 60000);
        // Auto-trigger a silent snapshot on boot to seed the trend chart
        silentAutoSnapshot();
    }

    async function silentAutoSnapshot() {
        try {
            await fetch('/api/admin/snapshot', {
                method: 'POST',
                headers: authHeaders()
            });
            addLog('info', 'Auto-snapshot seeded for real-time trend chart');
        } catch (_) { /* non-fatal */ }
    }

    async function refreshAll() {
        try {
            // DevOps runs independently (non-blocking)
            fetchDevOpsStatus();

            const [systemData, metricsData] = await Promise.all([
                fetchWithRetry('/api/admin/system', { headers: authHeaders() }),
                fetchWithRetry('/api/admin/metrics', { headers: authHeaders() })
            ]);

            if (systemData && !systemData._failed) {
                cachedSystemData = systemData;
                renderSystemData(systemData);
            }

            if (metricsData && !metricsData._failed) {
                cachedMetricsData = metricsData;
                renderMetrics(metricsData);
                if (metricsData.usageTrend) renderUsageChart(metricsData.usageTrend);
            }

            // Social renders AFTER metrics is cached (reads from cachedMetricsData)
            fetchSocialData();

            // Signal initialization success to watchdog
            window.dashboardInitialized = true;
            const overlay = $('loading-watchdog-overlay');
            if (overlay) overlay.classList.add('hidden');

            addLog('success', 'Dashboard refreshed successfully');
        } catch (e) {
            addLog('error', `Refresh error: ${e.message}`);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // RENDER: System Data
    // ══════════════════════════════════════════════════════════════════════
    function renderSystemData(data) {
        // Health status
        const health = data.health || {};
        setStatusDot(apiStatusDot, apiStatusText, health.api || 'unknown', 'API');
        setStatusDot(dbStatusDot, dbStatusText, health.db || 'unknown', 'DB');

        // Response time
        if (data._responseTime) {
            responseTime.textContent = `${data._responseTime} ms`;
        }

        // Last sync
        if (data.last_updated) {
            syncTimestamp.textContent = formatTime(new Date(data.last_updated));
        }

        // Stats
        statCountries.textContent = data.countries?.length || 0;

        const analytics = data.analytics || {};
        statUsers.textContent = formatNumber(analytics.total_users || 0);
        statConversions.textContent = formatNumber(analytics.total_conversions_7d || 0);

        // Snapshot
        if (data.snapshot_saved) {
            statSnapshot.innerHTML = '<span style="color:var(--success)">✅ Saved</span>';
        } else {
            statSnapshot.innerHTML = '<span style="color:var(--warning)">⏳ Pending</span>';
        }

        // Cleanup
        if (data.last_cleanup) {
            statCleanup.textContent = `Last Purge: ${formatTime(new Date(data.last_cleanup))}`;
        }

        // Source
        sourceVal.textContent = `Source: ${(data.source || 'unknown').toUpperCase()}`;

        // Rate Table
        renderRateTable(data);

        // Country Analytics (from system data)
        if (analytics.users_by_country?.length) {
            renderCountryChart(analytics.users_by_country);
        }
    }

    function setStatusDot(dot, text, status, prefix = '') {
        dot.className = 'status-dot ' + status;
        const labels = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', error: 'Error', unknown: 'Unknown' };
        const label = labels[status] || status;
        text.innerHTML = prefix
            ? `<span style="color:var(--text-muted);font-size:0.75rem;margin-right:4px">${prefix}</span>${label}`
            : label;
    }

    function renderRateTable(data) {
        if (!data.countries || !data.rates) return;
        rateTableBody.innerHTML = '';

        const displayedCurrencies = new Set();

        data.countries.forEach(country => {
            if (displayedCurrencies.has(country.currency)) return;
            displayedCurrencies.add(country.currency);

            const pair = `${country.currency}_PHP`;
            const rate = data.rates[pair];
            const rateStr = rate != null ? `₱ ${rate.toFixed(4)}` : 'N/A';

            // Distinct representation for Eurozone
            const isEuro = country.currency === 'EUR';
            const flag = isEuro ? '🇪🇺' : getFlagEmoji(country.code);
            const name = isEuro ? 'Eurozone' : country.name;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="flag">${flag}</span> ${name}</td>
                <td class="currency-code">${country.currency}</td>
                <td style="font-weight:600">${rateStr}</td>
                <td><span class="pill pill-success">Online</span></td>
            `;
            rateTableBody.appendChild(tr);
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // RENDER: Country Bar Chart (CSS-based)
    // ══════════════════════════════════════════════════════════════════════
    function renderCountryChart(countriesData) {
        if (!countriesData.length) {
            countryChartBody.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px">No data yet</p>';
            return;
        }

        const maxUsers = Math.max(...countriesData.map(c => c.users));
        const top10 = countriesData.slice(0, 10);

        countryChartBody.innerHTML = top10.map(c => {
            const pct = Math.max((c.users / maxUsers) * 100, 2);
            const code = c.country || '??';
            const flag = getFlagEmoji(code);
            return `
                <div class="bar-row">
                    <div class="bar-label">${flag} ${code}</div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width: ${pct}%"></div>
                    </div>
                    <div class="bar-value">${c.users}</div>
                </div>
            `;
        }).join('');
    }

    // ══════════════════════════════════════════════════════════════════════
    // RENDER: Metrics (Conversion rates, currency trends)
    // ══════════════════════════════════════════════════════════════════════
    // RENDER: Metrics (Conversion rates, currency trends, social traffic)
    // ══════════════════════════════════════════════════════════════════════
    async function fetchSocialData() {
        // Social data is loaded from /api/admin/metrics (already auth-protected)
        // We wait for cachedMetricsData to be populated, then render from it.
        // This avoids the unauthenticated /api/social endpoint which always degraded.
        if (cachedMetricsData?.socialTraffic) {
            const social = cachedMetricsData.socialTraffic;
            // Normalise to { platforms: [{name, clicks}] } shape
            const platforms = (social.platforms || []).map(p => ({
                name: p.name || p.platform || 'Unknown',
                clicks: p.clicks || p.count || 0
            }));
            renderSocialAnalytics({ platforms, status: 'OK' }, false);
        } else {
            // Metrics not loaded yet — fetch it directly
            try {
                const data = await fetchWithRetry('/api/admin/metrics', { headers: authHeaders() });
                if (data?.socialTraffic) {
                    const social = data.socialTraffic;
                    const platforms = (social.platforms || []).map(p => ({
                        name: p.name || p.platform || 'Unknown',
                        clicks: p.clicks || p.count || 0
                    }));
                    renderSocialAnalytics({ platforms, status: 'OK' }, false);
                } else {
                    // No data yet — show empty state (not ERROR)
                    renderSocialAnalytics({ platforms: [], status: 'OK' }, false);
                }
            } catch (e) {
                console.warn('Social data fetch failed:', e.message);
                renderSocialAnalytics({ platforms: [], status: 'OK' }, false);
            }
        }
    }

    function renderSocialAnalytics(data, isDegraded) {
        const platforms = data.platforms || [];
        const totalVisits = platforms.reduce((a, p) => a + (p.clicks || 0), 0);
        
        const socialStatusText = $('social-status-text');
        if (socialStatusText) {
            socialStatusText.innerHTML = isDegraded 
                ? `<span style="color:var(--danger)">🔴 ERROR</span>` 
                : platforms.length > 0 
                    ? `<span style="color:var(--success)">●</span> ${totalVisits} visits`
                    : `<span style="color:var(--text-muted)">⚪ No traffic yet</span>`;
        }

        const cardsEl = $('social-platform-cards');
        if (cardsEl) {
            if (!platforms.length) {
                cardsEl.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 16px;">
                        <p style="color: var(--text-muted); font-size: 0.9rem;">📡 Waiting for social media traffic...</p>
                        <p style="color: var(--text-muted); font-size: 0.7rem; margin-top: 8px;">Analytics will appear here when users visit via Facebook, Instagram, etc.</p>
                    </div>
                `;
            } else {
                const maxClicks = Math.max(...platforms.map(p => p.clicks || 0), 1);
                cardsEl.innerHTML = platforms.map(p => {
                    const meta = SOCIAL_META[p.name] || SOCIAL_META.Unknown;
                    const barPct = Math.max(((p.clicks || 0) / maxClicks) * 100, 4);
                    return `<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;padding:18px;position:relative;overflow:hidden;transition:border-color 0.2s">
                        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${meta.grad}"></div>
                        <div style="font-size:1.8rem;margin-bottom:8px">${meta.icon}</div>
                        <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px">${p.name}</div>
                        <div style="font-size:1.5rem;font-weight:800;letter-spacing:-0.5px;color:var(--text-primary)">${p.clicks || 0}</div>
                        <div style="height:4px;background:rgba(255,255,255,0.05);border-radius:2px;margin-top:10px">
                            <div style="height:100%;width:${barPct}%;background:${meta.grad};border-radius:2px"></div>
                        </div>
                    </div>`;
                }).join('');
            }
        }

        const barChartEl = $('social-bar-chart');
        if (barChartEl && platforms.length) {
            const maxClicks = Math.max(...platforms.map(p => p.clicks || 0), 1);
            barChartEl.innerHTML = platforms.map(p => {
                const meta = SOCIAL_META[p.name] || SOCIAL_META.Unknown;
                const pct = Math.max(((p.clicks || 0) / maxClicks) * 100, 2);
                return `<div class="bar-row">
                    <div class="bar-label">${meta.icon} ${p.name}</div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width:${pct}%;background:${meta.grad}"></div>
                    </div>
                    <div class="bar-value">${p.clicks || 0}</div>
                </div>`;
            }).join('');
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // RENDER: DevOps Engine
    // ══════════════════════════════════════════════════════════════════════
    async function fetchDevOpsStatus() {
        try {
            const data = await fetchWithRetry('/api/admin/devops', { headers: authHeaders() });
            if (data && !data._failed) {
                renderDevOps(data);
            }
        } catch (e) {
            console.warn('DevOps fetch failed:', e);
        }
    }

    function renderDevOps(data) {
        if (!devopsVerdict || !metricsLatency || !metricsBudget) return;

        // 1. Verdict & Status
        const statusColors = { HEALTHY: '#22c55e', DEGRADED: '#f59e0b', DOWN: '#ef4444' };
        devopsVerdict.textContent = data.status || 'UNKNOWN';
        devopsVerdict.style.color = statusColors[data.status] || '#94a3b8';
        devopsVerdict.style.backgroundColor = `${statusColors[data.status]}15`;
        devopsVerdict.style.borderColor = `${statusColors[data.status]}30`;

        // 2. Metrics
        metricsLatency.textContent = `${data.findings.performance.avg_latency_1h || '--'} ms`;
        metricsBudget.textContent = `${data.findings.twelve_data.credits_left} left`;

        // 3. Alerts
        devopsAlerts.innerHTML = '';
        if (data.findings.alerts?.length) {
            data.findings.alerts.forEach(alert => {
                const div = document.createElement('div');
                div.className = 'p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-200 flex items-center gap-2';
                div.innerHTML = `<span>⚠️</span> ${alert}`;
                devopsAlerts.appendChild(div);
            });
        } else {
            devopsAlerts.innerHTML = '<p class="text-[10px] text-green-400 font-medium">✨ All systems nominal</p>';
        }

        // 4. Audit History
        if (auditHistory && data.findings.audit_history) {
            auditHistory.innerHTML = data.findings.audit_history.map(a => {
                const color = statusColors[a.status] || '#94a3b8';
                const time = new Date(a.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                return `<div class="flex justify-between items-center py-1 border-b border-white/5 last:border-0">
                    <span style="color:${color}">● ${a.status}</span>
                    <span class="opacity-40">${time}</span>
                </div>`;
            }).join('');
        }
    }

    function renderMetrics(data) {
        // Conversion rates by country
        if (data.countryBreakdown?.length) {
            renderConversionRates(data.countryBreakdown);
        } else {
            conversionRatesBody.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px">No conversion data yet</p>';
        }

        // Currency trends (real-time chart)
        if (data.currencyTrends?.length) {
            renderCurrencyFilter(data.currencyTrends);
            renderTrendChart(data.currencyTrends);
            // Update LIVE badge
            const liveBadge = $('trend-live-badge');
            if (liveBadge) {
                const now = new Date();
                liveBadge.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--success);background:var(--success-soft);border:1px solid rgba(34,197,94,0.15);padding:3px 8px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:var(--success);display:inline-block;animation:pulse-glow 2s infinite"></span>LIVE · ${now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true})}</span>`;
            }
        }

        // DevOps Reliability Trend (Pulse Bar)
        if (data.devopsTrend) {
            renderDevOpsTrend(data.devopsTrend);
        }
        
        // Usage Trend (Credit Budgeting)
        if (data.usageTrend) {
            renderUsageChart(data.usageTrend);
        }
    }

    function renderDevOpsTrend(trend) {
        const container = $('devops-alerts'); // We'll put the trend bar above alerts
        if (!container) return;

        // Create a 24-dot reliability bar
        const statusColors = { HEALTHY: '#22c55e', DEGRADED: '#f59e0b', DOWN: '#ef4444' };
        
        let html = `<p class="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">24h Reliability Sync Pulse</p>`;
        html += `<div class="flex gap-1 mb-4">`;
        
        // If we have less than 24, pad with 'pending'
        const fullTrend = [...trend];
        while (fullTrend.length < 24) fullTrend.unshift({ status: 'PENDING' });

        fullTrend.slice(-24).forEach(t => {
            const color = statusColors[t.status] || 'rgba(255,255,255,0.05)';
            html += `<div class="flex-1 h-3 rounded-sm border border-white/5" style="background:${color};" title="${t.timestamp || 'No data'}"></div>`;
        });
        
        html += `</div>`;
        
        // Prepend to alerts container if not already there
        const trendId = 'devops-reliability-bar';
        let bar = $(trendId);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = trendId;
            container.parentNode.insertBefore(bar, container);
        }
        bar.innerHTML = html;
    }

    function renderUsageChart(usage) {
        const budgetEl = $('metrics-budget');
        if (!budgetEl || !usage.length) return;

        // Update the main budget stat with the latest day's usage
        const latest = usage[0]; // limit 30 desc, so index 0 is latest
        const limit = 700;
        const used = latest.credits_used || 0;
        const left = Math.max(limit - used, 0);

        budgetEl.innerHTML = `${left} <span class="text-[10px] opacity-40">/ ${limit} left</span>`;
    }

    function renderConversionRates(breakdown) {
        const top10 = breakdown.slice(0, 10);
        conversionRatesBody.innerHTML = '';

        top10.forEach(c => {
            const flag = getFlagEmoji(c.country || '');
            const row = document.createElement('div');
            row.className = 'bar-row';
            row.innerHTML = `
                <div class="bar-label">${flag} ${c.country || '??'}</div>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${Math.max(c.conversion_rate, 2)}%; background: linear-gradient(90deg, var(--success), #059669)"></div>
                </div>
                <div class="bar-value">${c.conversion_rate}%</div>
            `;
            conversionRatesBody.appendChild(row);
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // RENDER: Social Media Dashboard (Full Panel)
    // ══════════════════════════════════════════════════════════════════════
    const SOCIAL_META = {
        Facebook:  { icon: '📘', color: '#1877f2', grad: 'linear-gradient(135deg,#1877f2,#4facfe)' },
        Messenger: { icon: '💬', color: '#0084ff', grad: 'linear-gradient(135deg,#0084ff,#00c6ff)' },
        Instagram: { icon: '📸', color: '#e1306c', grad: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
        Twitter:   { icon: '🐦', color: '#1da1f2', grad: 'linear-gradient(135deg,#1da1f2,#0d7ab5)' },
        LinkedIn:  { icon: '💼', color: '#0077b5', grad: 'linear-gradient(135deg,#0077b5,#00a0dc)' },
        Unknown:   { icon: '📱', color: '#64748b', grad: 'linear-gradient(135deg,#374151,#64748b)' },
    };

    function renderSocialDashboard(socialData, healingLogs = []) {
        const platforms = socialData.platforms || [];
        const totalVisits = socialData.total_visits || 0;
        const totalFailed = platforms.reduce((a, p) => a + (p.failed_count || 0), 0);

        // — Status bar pill
        const socialStatusText = $('social-status-text');
        if (socialStatusText) {
            socialStatusText.textContent = `${totalVisits} visits`;
        }

        // — Header badge
        const totalBadge = $('social-total-badge');
        const errorBadge = $('social-error-badge');
        if (totalBadge) totalBadge.textContent = `${totalVisits} total visits (7d)`;
        if (errorBadge) {
            if (totalFailed > 0) {
                errorBadge.textContent = `${totalFailed} failures`;
                errorBadge.style.display = 'inline';
            } else {
                errorBadge.style.display = 'none';
            }
        }

        // — Nav badge (alerts admin if there are failures)
        const navBadge = $('social-nav-badge');
        if (navBadge) navBadge.style.display = totalFailed > 0 ? 'inline' : 'none';

        // — Platform Cards
        const cardsEl = $('social-platform-cards');
        if (cardsEl) {
            if (!platforms.length) {
                cardsEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;grid-column:1/-1">No social traffic recorded yet</p>';
            } else {
                const maxCount = Math.max(...platforms.map(p => p.count));
                cardsEl.innerHTML = platforms.map(p => {
                    const meta = SOCIAL_META[p.platform] || SOCIAL_META.Unknown;
                    const failedPct = p.count > 0 ? Math.round((p.failed_count / p.count) * 100) : 0;
                    const successCount = p.count - (p.failed_count || 0);
                    const barPct = Math.max((p.count / maxCount) * 100, 4);
                    const errorClass = failedPct > 20 ? 'pill-danger' : failedPct > 5 ? 'pill-warning' : 'pill-success';
                    const errorLabel = failedPct > 20 ? '⚠️ High' : failedPct > 5 ? '⚠ Med' : '✅ OK';

                    return `<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:14px;padding:18px;position:relative;overflow:hidden;transition:border-color 0.2s">
                        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${meta.grad}"></div>
                        <div style="font-size:1.8rem;margin-bottom:8px">${meta.icon}</div>
                        <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px">${p.platform}</div>
                        <div style="font-size:1.5rem;font-weight:800;letter-spacing:-0.5px;color:var(--text-primary)">${p.count}</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:10px">${successCount} ok &nbsp;•&nbsp; <span style="color:${failedPct>5?'#ef4444':'var(--text-muted)'}">${p.failed_count||0} failed</span></div>
                        <div style="height:4px;background:rgba(255,255,255,0.05);border-radius:2px">
                            <div style="height:100%;width:${barPct}%;background:${meta.grad};border-radius:2px"></div>
                        </div>
                        <div style="margin-top:8px"><span class="pill ${errorClass}" style="font-size:0.65rem">${errorLabel} ${failedPct}% err</span></div>
                    </div>`;
                }).join('');
            }
        }

        // — Bar Chart
        const barChartEl = $('social-bar-chart');
        if (barChartEl && platforms.length) {
            const maxCount = Math.max(...platforms.map(p => p.count));
            barChartEl.innerHTML = platforms.map(p => {
                const meta = SOCIAL_META[p.platform] || SOCIAL_META.Unknown;
                const pct = Math.max((p.count / maxCount) * 100, 2);
                const failedPct = p.count > 0 ? ((p.failed_count || 0) / p.count) * 100 : 0;
                const failedPx = (failedPct / 100) * pct;
                return `<div class="bar-row">
                    <div class="bar-label">${meta.icon} ${p.platform}</div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width:${pct}%;background:${meta.grad}"></div>
                        ${p.failed_count > 0 ? `<div class="bar-fill" style="width:${Math.min(failedPx,pct)}%;background:rgba(239,68,68,0.7);position:absolute;right:${100-pct}%;top:0;height:100%"></div>` : ''}
                    </div>
                    <div class="bar-value" style="width:auto;display:flex;gap:8px">
                        ${p.count}
                        ${p.failed_count > 0 ? `<span style="color:#ef4444;font-size:0.75rem">(${p.failed_count} err)</span>` : ''}
                    </div>
                </div>`;
            }).join('');
        } else if (barChartEl) {
            barChartEl.innerHTML = '';
        }

        // — Failed Loads Panel
        const failuresPanel = $('social-failures-panel');
        const failureCount  = $('social-failure-count');
        const failureBody   = $('social-failure-body');

        if (failuresPanel) {
            if (totalFailed > 0) {
                failuresPanel.classList.remove('hidden');
                if (failureCount) failureCount.textContent = totalFailed;

                if (failureBody) {
                    const failingPlatforms = platforms.filter(p => (p.failed_count || 0) > 0);
                    failureBody.innerHTML = failingPlatforms.map(p => {
                        const meta = SOCIAL_META[p.platform] || SOCIAL_META.Unknown;
                        const rate = p.count > 0 ? Math.round((p.failed_count / p.count) * 100) : 0;
                        const severity = rate > 20 ? '#ef4444' : rate > 5 ? '#f59e0b' : '#94a3b8';
                        return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                            <span>${meta.icon} ${p.platform}</span>
                            <span style="color:${severity};font-weight:600">${p.failed_count} failures &nbsp;(${rate}% error rate)</span>
                        </div>`;
                    }).join('');
                }
            } else {
                failuresPanel.classList.add('hidden');
            }
        }

        // — Healing Status Badge
        const healingBadge = $('social-healing-badge');
        if (healingBadge) {
            const lastHealed = healingLogs.find(l => l.status === 'success');
            if (lastHealed) {
                healingBadge.style.display = 'inline';
                healingBadge.title = `Last healed: ${formatTime(new Date(lastHealed.timestamp))}`;
            } else {
                healingBadge.style.display = 'none';
            }
        }

        // — Healing History List
        const logsList = $('healing-logs-list');
        if (logsList) {
            if (!healingLogs.length) {
                logsList.innerHTML = '<div style="opacity:0.5;font-style:italic">No recent recovery events</div>';
            } else {
                logsList.innerHTML = healingLogs.slice(0, 5).map(l => {
                    const statusColor = l.status === 'success' ? 'var(--success)' : 'var(--danger)';
                    const time = formatTime(new Date(l.timestamp));
                    return `<div style="display:flex;justify-content:space-between;gap:10px">
                        <span><span style="color:${statusColor}">●</span> ${l.action} (${l.platform || 'Global'})</span>
                        <span style="opacity:0.6">${time}</span>
                    </div>`;
                }).join('');
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // CURRENCY TREND CHART (Canvas)
    // ══════════════════════════════════════════════════════════════════════
    const CHART_COLORS = [
        '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444',
        '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1'
    ];

    function renderCurrencyFilter(trends) {
        // Get all unique currencies from snapshot data
        const allCurrencies = new Set();
        if (trends.length) {
            trends.forEach(t => {
                (t.snapshot || []).forEach(s => {
                    const cur = s.pair?.replace('_PHP', '');
                    if (cur) allCurrencies.add(cur);
                });
            });
        }

        const currencies = allCurrencies.size ? Array.from(allCurrencies).sort() : ['USD', 'SGD', 'SAR', 'GBP', 'AUD', 'EUR', 'JPY'];

        currencyFilter.innerHTML = currencies.map(cur => {
            const active = selectedCurrencies.includes(cur) ? ' active' : '';
            return `<button class="currency-chip${active}" data-cur="${cur}">${cur}</button>`;
        }).join('');

        currencyFilter.querySelectorAll('.currency-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const cur = chip.dataset.cur;
                if (selectedCurrencies.includes(cur)) {
                    if (selectedCurrencies.length <= 1) return; // keep at least one
                    selectedCurrencies = selectedCurrencies.filter(c => c !== cur);
                    chip.classList.remove('active');
                } else {
                    selectedCurrencies.push(cur);
                    chip.classList.add('active');
                }
                if (cachedMetricsData?.currencyTrends?.length) {
                    renderTrendChart(cachedMetricsData.currencyTrends);
                }
            });
        });
    }

    function renderTrendChart(trends) {
        if (!trends.length) return;

        const container = trendCanvas.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = rect.width;
        const h = rect.height;

        trendCanvas.width = w * dpr;
        trendCanvas.height = h * dpr;
        trendCanvas.style.width = w + 'px';
        trendCanvas.style.height = h + 'px';

        const ctx = trendCanvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // Padding
        const pad = { top: 20, right: 20, bottom: 36, left: 60 };
        const chartW = w - pad.left - pad.right;
        const chartH = h - pad.top - pad.bottom;

        // Extract series data per selected currency
        const series = {};
        selectedCurrencies.forEach(cur => {
            series[cur] = trends.map(t => {
                const entry = (t.snapshot || []).find(s => s.pair === `${cur}_PHP`);
                return { date: t.date, value: entry?.rate || null };
            }).filter(d => d.value !== null);
        });

        // Find global min/max
        let allVals = [];
        Object.values(series).forEach(s => s.forEach(d => allVals.push(d.value)));
        if (!allVals.length) return;

        const minVal = Math.min(...allVals) * 0.98;
        const maxVal = Math.max(...allVals) * 1.02;
        const valRange = maxVal - minVal || 1;

        const dates = trends.map(t => t.date);
        const xStep = chartW / Math.max(dates.length - 1, 1);

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();

            // Y label
            const val = maxVal - (valRange / 4) * i;
            ctx.fillStyle = '#64748b';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val.toFixed(2), pad.left - 8, y + 3);
        }

        // X labels
        ctx.textAlign = 'center';
        ctx.fillStyle = '#64748b';
        ctx.font = '10px Inter, sans-serif';
        dates.forEach((d, i) => {
            const x = pad.left + i * xStep;
            const label = d.substring(5); // MM-DD
            ctx.fillText(label, x, h - 10);
        });

        // Draw lines
        let colorIdx = 0;
        const legendItems = [];

        Object.entries(series).forEach(([cur, pts]) => {
            if (pts.length < 2) { colorIdx++; return; }

            const color = CHART_COLORS[colorIdx % CHART_COLORS.length];
            legendItems.push({ cur, color });

            // Smooth line
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            pts.forEach((pt, i) => {
                const dateIdx = dates.indexOf(pt.date);
                if (dateIdx < 0) return;
                const x = pad.left + dateIdx * xStep;
                const y = pad.top + chartH - ((pt.value - minVal) / valRange) * chartH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // Gradient fill
            const lastPt = pts[pts.length - 1];
            const lastX = pad.left + dates.indexOf(lastPt.date) * xStep;
            const firstX = pad.left + dates.indexOf(pts[0].date) * xStep;

            ctx.lineTo(lastX, pad.top + chartH);
            ctx.lineTo(firstX, pad.top + chartH);
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
            grad.addColorStop(0, color + '20');
            grad.addColorStop(1, color + '02');
            ctx.fillStyle = grad;
            ctx.fill();

            // Dots
            pts.forEach(pt => {
                const dateIdx = dates.indexOf(pt.date);
                if (dateIdx < 0) return;
                const x = pad.left + dateIdx * xStep;
                const y = pad.top + chartH - ((pt.value - minVal) / valRange) * chartH;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            });

            colorIdx++;
        });

        // Legend
        if (legendItems.length > 1) {
            const legendY = pad.top;
            let legendX = pad.left;
            legendItems.forEach(item => {
                ctx.fillStyle = item.color;
                ctx.beginPath();
                ctx.arc(legendX, legendY - 6, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#94a3b8';
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(item.cur, legendX + 8, legendY - 3);
                legendX += ctx.measureText(item.cur).width + 24;
            });
        }

        // Tooltip on hover
        setupChartTooltip(dates, series, pad, xStep, chartH, minVal, valRange);
    }

    function setupChartTooltip(dates, series, pad, xStep, chartH, minVal, valRange) {
        const container = $('trend-chart-container');

        trendCanvas.onmousemove = (e) => {
            const rect = trendCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;

            // Find nearest date index
            const idx = Math.round((mx - pad.left) / xStep);
            if (idx < 0 || idx >= dates.length) {
                trendTooltip.classList.remove('visible');
                return;
            }

            const date = dates[idx];
            let tooltipLines = [];

            Object.entries(series).forEach(([cur, pts]) => {
                const pt = pts.find(p => p.date === date);
                if (pt) {
                    // Calc % change from previous
                    const prevPt = pts.find(p => p.date === dates[idx - 1]);
                    let changeStr = '';
                    if (prevPt) {
                        const pctChange = ((pt.value - prevPt.value) / prevPt.value * 100).toFixed(2);
                        const arrow = pctChange >= 0 ? '↑' : '↓';
                        changeStr = ` ${arrow} ${Math.abs(pctChange)}%`;
                    }
                    tooltipLines.push(`${cur}: ₱${pt.value.toFixed(4)}${changeStr}`);
                }
            });

            if (tooltipLines.length) {
                tooltipDate.textContent = date;
                tooltipValue.innerHTML = tooltipLines.join('<br>');
                tooltipChange.textContent = '';

                trendTooltip.style.left = Math.min(mx + 12, container.offsetWidth - 180) + 'px';
                trendTooltip.style.top = '20px';
                trendTooltip.classList.add('visible');
            }
        };

        trendCanvas.onmouseleave = () => {
            trendTooltip.classList.remove('visible');
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION BUTTONS
    // ══════════════════════════════════════════════════════════════════════
    if (cleanupBtn) cleanupBtn.addEventListener('click', async () => {
        if (!confirm('Run 7-day retention cleanup?\nAll data older than 7 days will be permanently deleted.')) return;
        cleanupBtn.disabled = true;
        cleanupBtn.textContent = '🗑 Purging…';

        try {
            const data = await fetchWithRetry('/api/admin/cleanup', {
                method: 'POST',
                headers: authHeaders()
            });

            if (data?.status === 'success') {
                showToast('success', `Cleanup complete — ${data.rows_deleted} rows deleted`);
                addLog('success', `Retention cleanup: ${data.rows_deleted} rows deleted in ${data.duration_ms}ms`);
                refreshAll();
            } else {
                showToast('error', 'Cleanup failed: ' + (data?.message || 'Unknown error'));
                addLog('error', 'Cleanup failed: ' + (data?.message || 'Unknown'));
            }
        } catch (e) {
            showToast('error', 'Cleanup failed: ' + e.message);
            addLog('error', 'Cleanup exception: ' + e.message);
        } finally {
            cleanupBtn.disabled = false;
            cleanupBtn.textContent = '🗑 Cleanup';
        }
    });

    if (syncBtn) syncBtn.addEventListener('click', async () => {
        if (!confirm('Force a fresh rate sync from Twelve Data API?')) return;
        syncBtn.disabled = true;
        syncBtn.textContent = '🔄 Syncing…';

        try {
            const data = await fetchWithRetry('/api/admin/sync', {
                method: 'POST',
                headers: authHeaders()
            });

            if (data?.status === 'success') {
                showToast('success', `Sync complete — ${data.count} currencies updated`);
                addLog('success', `Rate sync completed: ${data.count} currencies`);
                refreshAll();
            } else {
                showToast('error', 'Sync failed: ' + (data?.message || 'Unknown error'));
                addLog('error', 'Sync failed: ' + (data?.message || 'Unknown'));
            }
        } catch (e) {
            showToast('error', 'Sync failed: ' + e.message);
            addLog('error', 'Sync exception: ' + e.message);
        } finally {
            syncBtn.disabled = false;
            syncBtn.textContent = '🔄 Sync';
        }
    });

    if (snapshotBtn) snapshotBtn.addEventListener('click', async () => {
        if (!confirm('Capture a manual EOD snapshot for analytics?')) return;
        snapshotBtn.disabled = true;
        snapshotBtn.textContent = '📸 Saving…';

        try {
            const data = await fetchWithRetry('/api/admin/snapshot', {
                method: 'POST',
                headers: authHeaders()
            });

            if (data?.status === 'success') {
                showToast('success', `Snapshot saved for ${data.date}`);
                addLog('success', `EOD snapshot saved for ${data.date}`);
                refreshAll();
            } else {
                showToast('error', 'Snapshot failed: ' + (data?.message || 'Unknown error'));
                addLog('error', 'Snapshot failed: ' + (data?.message || 'Unknown'));
            }
        } catch (e) {
            showToast('error', 'Snapshot failed: ' + e.message);
            addLog('error', 'Snapshot exception: ' + e.message);
        } finally {
            snapshotBtn.disabled = false;
            snapshotBtn.textContent = '📸 Snapshot';
        }
    });

    // ══════════════════════════════════════════════════════════════════════
    // LOG SYSTEM
    // ══════════════════════════════════════════════════════════════════════
    function addLog(level, message) {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false });

        logEntries.unshift({ level, message, time });
        if (logEntries.length > 50) logEntries.pop();

        renderLogs();
    }

    function renderLogs() {
        if (!logPanel) return;
        logPanel.innerHTML = logEntries.map(entry => `
            <div class="log-entry">
                <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
                <span class="log-time">${entry.time}</span>
                <span class="log-msg">${entry.message}</span>
            </div>
        `).join('');
    }

    // ══════════════════════════════════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ══════════════════════════════════════════════════════════════════════
    function showToast(type, message) {
        const container = $('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icons = { success: '✓', error: '✕', info: 'ℹ' };
        toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // ══════════════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════════════
    function getFlagEmoji(countryCode) {
        if (!countryCode || countryCode.length !== 2) return '🏳';
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    }

    function formatTime(date) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    function formatNumber(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    }

    // Sidebar nav scroll
    window.scrollToSection = (id) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

})();