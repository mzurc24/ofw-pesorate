(() => {
    'use strict';

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

    // Charts / Analytics
    const countryChartBody     = $('country-chart-body');
    const conversionRatesBody  = $('conversion-rates-body');
    const currencyFilter       = $('currency-filter');
    const trendCanvas          = $('trend-chart');
    const trendTooltip         = $('trend-tooltip');
    const tooltipDate          = $('tooltip-date');
    const tooltipValue         = $('tooltip-value');
    const tooltipChange        = $('tooltip-change');

    // Log
    const logPanel   = $('log-panel');
    const logCount   = $('log-count');

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
        authOverlay.classList.add('hidden');
        initDashboard();
    }

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

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('ofw_admin_token');
        if (refreshInterval) clearInterval(refreshInterval);
        location.reload();
    });

    async function verifyToken(token) {
        try {
            const res = await fetch('/api/admin/system', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok;
        } catch (e) { return false; }
    }

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

        addLog('error', `Failed after ${retries} retries: ${url}`);
        return null;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function authHeaders() {
        return { 'Authorization': `Bearer ${adminToken}` };
    }

    // ══════════════════════════════════════════════════════════════════════
    // DASHBOARD INIT & REFRESH
    // ══════════════════════════════════════════════════════════════════════
    function initDashboard() {
        addLog('info', 'Dashboard initialized');
        refreshAll();
        refreshInterval = setInterval(refreshAll, 30000);
    }

    async function refreshAll() {
        try {
            const [systemData, metricsData] = await Promise.all([
                fetchWithRetry('/api/admin/system', { headers: authHeaders() }),
                fetchWithRetry('/api/admin/metrics', { headers: authHeaders() })
            ]);

            if (systemData) {
                cachedSystemData = systemData;
                renderSystemData(systemData);
            }

            if (metricsData) {
                cachedMetricsData = metricsData;
                renderMetrics(metricsData);
            }

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
        setStatusDot(apiStatusDot, apiStatusText, health.api || 'unknown');
        setStatusDot(dbStatusDot, dbStatusText, health.db || 'unknown');

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

    function setStatusDot(dot, text, status) {
        dot.className = 'status-dot ' + status;
        const labels = { healthy: '🟢 Healthy', degraded: '🟡 Degraded', down: '🔴 Down', error: '🔴 Error', unknown: '⚪ Unknown' };
        text.textContent = labels[status] || status;
    }

    function renderRateTable(data) {
        if (!data.countries || !data.rates) return;
        rateTableBody.innerHTML = '';

        data.countries.forEach(country => {
            const pair = `${country.currency}_PHP`;
            const rate = data.rates[pair];
            const rateStr = rate != null ? `₱ ${rate.toFixed(4)}` : 'N/A';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="flag">${getFlagEmoji(country.code)}</span> ${country.name}</td>
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
    function renderMetrics(data) {
        // Conversion rates by country
        if (data.countryBreakdown?.length) {
            renderConversionRates(data.countryBreakdown);
        } else {
            conversionRatesBody.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px">No conversion data yet</p>';
        }

        // Currency trends (7-day chart)
        if (data.currencyTrends?.length) {
            renderCurrencyFilter(data.currencyTrends);
            renderTrendChart(data.currencyTrends);
        } else {
            renderCurrencyFilter([]);
            const ctx = trendCanvas.getContext('2d');
            const rect = trendCanvas.parentElement.getBoundingClientRect();
            trendCanvas.width = rect.width * 2;
            trendCanvas.height = rect.height * 2;
            ctx.scale(2, 2);
            ctx.fillStyle = '#64748b';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No snapshot data yet — run a snapshot first', rect.width / 2, rect.height / 2);
        }
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
    cleanupBtn.addEventListener('click', async () => {
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

    syncBtn.addEventListener('click', async () => {
        if (!confirm('Force a fresh rate sync from Fixer API?')) return;
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

    snapshotBtn.addEventListener('click', async () => {
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
        logPanel.innerHTML = logEntries.map(entry => `
            <div class="log-entry">
                <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
                <span class="log-time">${entry.time}</span>
                <span class="log-msg">${entry.message}</span>
            </div>
        `).join('');

        logCount.textContent = `${logEntries.length} events`;
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
