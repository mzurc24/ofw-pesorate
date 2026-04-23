(() => {
    'use strict';

    // Detect if running inside a social media in-app browser (FB, Instagram, etc.)
    const isSocialWebviewDetection = /FBAN|FBAV|Instagram|WhatsApp|Messenger/i.test(navigator.userAgent);
    window.isSocialWebview = isSocialWebviewDetection;


    // ── Progressive Web App (PWA) Initialization ─────────────────────────────

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.error('PWA Registration failed:', err);
            });
        });
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has('heal') || url.searchParams.has('h')) {
        url.searchParams.delete('heal');
        url.searchParams.delete('h');
        window.history.replaceState({}, document.title, url.toString());
    }

    // NOTE: window.appLoaded is set to true ONLY after content renders.
    // The fallback watchdog in index.html checks this before showing fallback UI.
    window.appLoaded = false;

    // ── Global Security & Fallbacks ──────────────────────────────────────────
    const generateUUID = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Secure-enough fallback for non-sensitive identifiers
        return ([1e7]+-1e3+-4e3+-8e3+-11e6).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    };

    // ── DOM Refs ─────────────────────────────────────────────────────────────
    const firstVisitDiv         = document.getElementById('first-visit');
    const dashboardDiv          = document.getElementById('dashboard');
    const nameInput             = document.getElementById('name-input');
    const saveNameBtn           = document.getElementById('save-name-btn');
    
    const greetingEl            = document.getElementById('greeting');
    const greetingSubEl         = document.getElementById('greeting-sub');
    const baseCurrencyLabelEl   = document.getElementById('base-currency-label');
    const targetCurrencyLabelEl = document.getElementById('target-currency-label');
    const rateValueEl           = document.getElementById('rate-value');
    const targetSymbolEl        = document.getElementById('target-symbol');
    const lastUpdatedEl         = document.getElementById('last-updated');
    const secondaryReference    = document.getElementById('secondary-reference');
    const secondaryRateEl       = document.getElementById('secondary-rate');
    const baseCurrencySelect    = document.getElementById('base-currency-select');

    
    // UI Elements
    const phSelectorContainer   = document.getElementById('currency-selector-container');


    // ── Local State ──────────────────────────────────────────────────────────
    let userName         = localStorage.getItem('ofw_pesorate_name');
    let userId           = localStorage.getItem('ofw_pesorate_id');
    let currentCurrency  = localStorage.getItem('ofw_pesorate_base') || null;
    let lastFetchTime    = 0;
    let rateCache        = null;

    if (!userId) {
        userId = generateUUID();
        localStorage.setItem('ofw_pesorate_id', userId);
    }

    /**
     * ── RateTicker Engine (v2.0) ─────────────────────────────────────────────
     * Simulates "Live" rate fluctuations using server-provided deltas.
     * Implements SMA smoothing and interpolation between updates.
     */
    class RateTicker {
        constructor() {
            this.baseRate = 0;
            this.displayRate = 0;
            this.delta = 0;
            this.smaBuffer = [];
            this.timer = null;
            this.initialized = false;
        }

        update(serverRate, prevRate) {
            // ALWAYS jump to the correct rate — prevents wrong display when switching currencies
            this.baseRate = serverRate;
            this.displayRate = serverRate;
            this.smaBuffer = [serverRate]; // Reset smoothing buffer too
            this.delta = (serverRate - prevRate) / 60; // Spread delta over 60 seconds
            this.initialized = true;
            this.render(); // Immediately show correct rate, no waiting for next tick
            this.start();
        }

        start() {
            if (this.timer) clearInterval(this.timer);
            this.timer = setInterval(() => this.tick(), 1000);
        }

        tick() {
            // A. Linear Interpolation + Random Market Jitter (±0.00015)
            const jitter = (Math.random() - 0.5) * 0.0003;
            let nextVal = this.displayRate + this.delta + jitter;

            // B. SMA Smoothing (5-step window)
            this.smaBuffer.push(nextVal);
            if (this.smaBuffer.length > 5) this.smaBuffer.shift();
            const smoothed = this.smaBuffer.reduce((a, b) => a + b, 0) / this.smaBuffer.length;

            this.displayRate = smoothed;
            this.render();
        }

        render() {
            if (!rateValueEl) return;
            // High-precision display for the "Live" feel
            rateValueEl.textContent = this.displayRate.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4
            });

            // Always do a live lookup — renderUI rebuilds secondary-rate via innerHTML each time
            const liveSecondaryEl = document.getElementById('secondary-rate');
            if (liveSecondaryEl && secondaryReference && !secondaryReference.classList.contains('hidden')) {
                const usdRate = parseFloat(rateCache?.usd_rate || 60);
                const isUSD = rateCache?.from_currency === 'USD';
                if (isUSD) {
                    liveSecondaryEl.textContent = this.displayRate.toFixed(2);
                } else {
                    liveSecondaryEl.textContent = (this.displayRate / usdRate).toFixed(2);
                }
            }
        }
    }

    const ticker = new RateTicker();


    // ── Bootstrap ────────────────────────────────────────────────────────────
    // ── Bootstrap (Phase 1: Early Visibility) ────────────────────────────────
    try {
        if (!userName) {
            firstVisitDiv.classList.remove('hidden');
            window.appLoaded = true;
        } else {
            dashboardDiv.classList.remove('hidden');
            showDashboard(userName);
        }

        const loader = document.getElementById('app-boot-loading');
        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => loader.remove(), 1000);
        }
    } catch (e) {
        console.error('Bootstrap failure:', e);
        if (firstVisitDiv) firstVisitDiv.classList.remove('hidden');
    }

    saveNameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim().slice(0, 15);
        if (name) {
            userName = name;
            localStorage.setItem('ofw_pesorate_name', userName);
            firstVisitDiv.classList.add('hidden');
            showDashboard(userName);
        }
    });

    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveNameBtn.click();
    });

    async function showDashboard(name) {
        if (dashboardDiv) dashboardDiv.classList.remove('hidden');
        if (greetingEl) greetingEl.textContent = `Hello, ${name} 👋`;

        // MASTER REFERENCE: Detect PH vs non-PH FIRST, then apply currency logic
        // PH users: saved preference OR default USD
        // Non-PH users: server will auto-detect and lock
        const savedCountry = localStorage.getItem('ofw_pesorate_country') || '';
        const isPH = savedCountry === 'PH';

        let startCurrency = null;
        if (isPH) {
            // PH default = USD (per Master Reference)
            const preferred = localStorage.getItem('ofw_pesorate_base');
            startCurrency = (preferred && preferred !== 'PHP') ? preferred : 'USD';
            if (baseCurrencySelect) baseCurrencySelect.value = startCurrency;
        }
        // Non-PH: send no currency param — server locks to detected country

        await fetchRate(name, userId, false, startCurrency);
    }


    baseCurrencySelect.addEventListener('change', (e) => {
        const newCurrency = e.target.value;
        currentCurrency = newCurrency;
        localStorage.setItem('ofw_pesorate_base', newCurrency);
        
        fetch('/api/user/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
            body: JSON.stringify({ preferred_currency: newCurrency })
        }).catch(() => {});

        // Currency change forces a fresh fetch
        fetchRate(userName, userId, true, newCurrency);
    });





    async function fetchRate(name, userId, isRefresh = false, currency = null) {
        if (!dashboardDiv) return;
        
        const now = Date.now();
        // Smart Cache: Only fetch if currency changed OR > 60s since last fetch
        if (!isRefresh && !currency && rateCache && (now - lastFetchTime < 60000)) {
            renderUI(rateCache);
            return;
        }

        try {
            const browserLocale = navigator.language || 'en-US';
            const savedCountry = localStorage.getItem('ofw_pesorate_country') || '';
            const url = `/api/rate?user_id=${userId}${currency ? `&currency=${currency}` : ''}`;
            
            const res = await fetch(url, {
                headers: {
                    'x-user-name': encodeURIComponent(name || ''),
                    'x-client-country': savedCountry,
                    'x-browser-locale': browserLocale
                }
            });
            
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();

            if (data.status === 'HEALTHY' || data.status === 'DEGRADED') {
                rateCache = data;
                lastFetchTime = Date.now();

                // Sync currentCurrency to what the API confirmed
                // Critical for PH users: keeps Refresh and re-fetch consistent
                if (data.from_currency) {
                    currentCurrency = data.from_currency;
                    if (data.is_ph && data.from_currency !== 'PHP') {
                        localStorage.setItem('ofw_pesorate_base', data.from_currency);
                    }
                }

                renderUI(data);
                ticker.update(data.rate, data.previous_rate || data.rate);
                fetchAndDrawTrend(data.from_currency);
            }
        } catch (error) {
            console.error('Failed to fetch rate:', error);
            if (rateCache) renderUI(rateCache);
            else rateValueEl.textContent = 'Err';
        }
    }

    function renderUI(data) {
        if (!data) return;

        // Persist detected country
        if (data.country) {
            localStorage.setItem('ofw_pesorate_country', data.country);
        }

        const dot = document.querySelector('.dot');
        if (data.status === 'DEGRADED') {
            if (dot) {
                dot.style.background = '#ff9500';
                dot.style.boxShadow = '0 0 10px #ff9500';
            }
            if (lastUpdatedEl) lastUpdatedEl.textContent = 'Degraded Mode';
        } else {
            if (dot) {
                dot.style.background = '#22c55e';
                dot.style.boxShadow = '0 0 10px rgba(34,197,94,0.4)';
            }
        }

        greetingSubEl.textContent = `Real-time exchange rates`;

        // =============================================
        // MASTER REFERENCE: GEO-FENCED DISPLAY LOGIC
        // =============================================
        if (data.is_ph) {
            // PH USER: Show dropdown, show secondary USD reference
            if (phSelectorContainer) phSelectorContainer.style.display = 'flex';
            if (baseCurrencyLabelEl) baseCurrencyLabelEl.style.display = 'none';
            // Sync dropdown to current currency (not PHP)
            if (baseCurrencySelect && data.from_currency && data.from_currency !== 'PHP') {
                baseCurrencySelect.value = data.from_currency;
            }
            // Secondary: show USD equivalent (e.g. 1 SAR = ~$0.27)
            secondaryReference.classList.remove('hidden');
            const usdEquiv = (data.rate / (data.usd_rate || 60.5)).toFixed(2);
            const prefix = data.from_currency === 'USD' ? '~₱' : '~$';
            const secVal = data.from_currency === 'USD' ? data.rate.toFixed(2) : usdEquiv;
            secondaryReference.innerHTML = `(${prefix}<span id="secondary-rate">${secVal}</span>)`;
        } else {
            // NON-PH USER: Hide dropdown, show locked currency label
            if (phSelectorContainer) phSelectorContainer.style.display = 'none';
            if (baseCurrencyLabelEl) {
                baseCurrencyLabelEl.style.display = 'inline';
                baseCurrencyLabelEl.textContent = `${data.symbol || ''} 1 ${data.from_currency}`;
            }
            // No secondary reference for non-PH users
            secondaryReference.classList.add('hidden');
        }

        if (targetCurrencyLabelEl) targetCurrencyLabelEl.textContent = data.to_currency;
        targetSymbolEl.textContent = data.target_symbol || '₱';
        
        const syncTime = data._meta?.updated ? new Date(data._meta.updated) : new Date();
        lastUpdatedEl.textContent = `Updated ${syncTime.toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}`;
        
        if (data._meta?.is_stale) {
            lastUpdatedEl.style.color = '#ff9500';
            lastUpdatedEl.textContent += ' [STALE]';
        } else {
            lastUpdatedEl.style.color = '';
        }

        window.appLoaded = true;
        clearTimeout(window.appBootTimeout);
    }

    function animateNumber(el, start, end) {
        const duration = 1200;
        const startTime = performance.now();
        
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Quartic ease-out for a true Apple feel
            const ease = 1 - Math.pow(1 - progress, 4);
            
            // Format to standard localized currency (###.00)
            const currentVal = start + (end - start) * ease;
            const currentStr = new Intl.NumberFormat('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(currentVal);
            el.textContent = currentStr;
            
            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                el.textContent = new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(end);
            }
        }
        requestAnimationFrame(update);
    }

    // ── Native High-Performance Sparkline Charting ───────────────────────────
    async function fetchAndDrawTrend(baseCurrency) {
        const canvas = document.getElementById('trend-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        try {
            const res = await fetch('/api/trends');
            const data = await res.json();

            // If no data yet, draw a "Building..." placeholder
            if (!data.trends || data.trends.length < 2) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.font = '11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('📈 Building 7-day trend...', canvas.width / 2, canvas.height / 2);
                return;
            }

            // Extract the rates for this specific currency pair over time
            const points = data.trends.map(t => parseFloat(t.rates[baseCurrency] || 0)).filter(p => p > 0);
            if (points.length < 2) return;

            const min = Math.min(...points);
            const max = Math.max(...points);
            const padding = (max - min) * 0.1 || 0.0001; // 10% padding
            const lowerBound = min - padding;
            const upperBound = max + padding;

            const width = canvas.width;
            const height = canvas.height;
            const stepX = width / (points.length - 1);

            ctx.clearRect(0, 0, width, height);
            ctx.beginPath();
            
            // Create a premium, soft glow layout
            points.forEach((val, i) => {
                const x = i * stepX;
                const normalizedY = (val - lowerBound) / (upperBound - lowerBound);
                // Invert Y so higher value is towards top of canvas
                const y = height - (normalizedY * height);

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });

            // Trend indicator: Is the most recent day higher than the oldest day?
            const isGoingUp = points[points.length - 1] > points[0]; 
            const lineColor = isGoingUp ? '#34c759' : '#0071e3'; 
            
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Gradient Fill beneath the line simulating native iOS stocks UI
            const fillPath = new Path2D();
            points.forEach((val, i) => {
                const x = i * stepX;
                const normalizedY = (val - lowerBound) / (upperBound - lowerBound);
                const y = height - (normalizedY * height);
                if (i === 0) fillPath.moveTo(x, y);
                else fillPath.lineTo(x, y);
            });
            fillPath.lineTo(width, height);
            fillPath.lineTo(0, height);
            fillPath.closePath();

            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, lineColor + '44'); // 26% opacity
            gradient.addColorStop(1, lineColor + '00'); // 0% opacity
            ctx.fillStyle = gradient;
            ctx.fill(fillPath);

        } catch(e) { console.error('Silent fail for trend charts', e); }
    }
})();
