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

    if (!userId) {
        userId = generateUUID();
        localStorage.setItem('ofw_pesorate_id', userId);
    }

    // ── Bootstrap ────────────────────────────────────────────────────────────
    // ── Bootstrap (Phase 1: Early Visibility) ────────────────────────────────
    try {
        if (!userName) {
            firstVisitDiv.classList.remove('hidden');
            window.appLoaded = true; // Tell watchdog the UI is ready and waiting for input
        } else {
            dashboardDiv.classList.remove('hidden');
            showDashboard(userName);
        }

        // ── Phase 2: Fade out loader
        const loader = document.getElementById('app-boot-loading');
        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => loader.remove(), 1000);
        }
    } catch (e) {
        console.error('Bootstrap failure:', e);
        // Ensure at least one UI element shows
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
        
        // Sync Base Currency Selector with localStorage
        const preferred = localStorage.getItem('ofw_pesorate_base');
        if (preferred && baseCurrencySelect) {
            baseCurrencySelect.value = preferred;
        }

        await fetchRate(name, userId, false, preferred || currentCurrency);
    }


    baseCurrencySelect.addEventListener('change', (e) => {
        const newCurrency = e.target.value;
        currentCurrency = newCurrency;
        localStorage.setItem('ofw_pesorate_base', newCurrency);
        
        // Asynchronously save to D1
        fetch('/api/user/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
            body: JSON.stringify({ preferred_currency: newCurrency })
        }).catch(() => {});

        fetchRate(userName, userId, true, newCurrency);
    });


    async function fetchRate(name, id, isRefresh = false, currency = null) {
        if (isRefresh) {
            rateValueEl.parentElement.style.opacity = '0.6';
        }

        try {
            const url = new URL('/api/rate', window.location.origin);
            if (currency) url.searchParams.set('currency', currency);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout for production stability

            const savedCountry = localStorage.getItem('ofw_pesorate_country') || sessionStorage.getItem('ofw_pesorate_country') || '';
            const browserLocale = navigator.language || navigator.userLanguage || '';

            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'x-user-id': id,
                    'x-user-name': encodeURIComponent(name || ''),
                    'x-client-country': savedCountry,
                    'x-browser-locale': browserLocale
                }
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();

            // Production Stability: Handle Degraded state
            const statusPill = document.querySelector('.status-pill');
            const dot = document.querySelector('.dot');
            const lastUpdated = document.getElementById('last-updated');
            
            // Persist securely detected country uniformly across session/local storage
            if (data.country) {
                localStorage.setItem('ofw_pesorate_country', data.country);
                sessionStorage.setItem('ofw_pesorate_country', data.country);
            }
            
            if (data.status === 'DEGRADED') {
                if (dot) {
                    dot.style.background = '#ff9500'; // Orange for degraded
                    dot.style.boxShadow = '0 0 10px #ff9500';
                }
                if (lastUpdated) lastUpdated.textContent = 'Degraded Mode';
            } else {
                if (dot) {
                    dot.style.background = '#22c55e'; // Success green
                    dot.style.boxShadow = '0 0 10px rgba(34,197,94,0.4)';
                }
            }
            
            // Render UI with Fallbacks
            const from = data.from_currency || 'SGD';
            const to = data.to_currency || 'PHP';
            const rateRaw = data.rate;
            const rate = (rateRaw && !isNaN(rateRaw)) ? parseFloat(rateRaw).toFixed(2) : '--.--';

            greetingEl.textContent = `Hello, ${name} \u{1F44B}`;
            greetingSubEl.textContent = `Real-time exchange rates`;

            // Dual-Currency Rendering (Premium UX)
            if (data.is_ph) {
                secondaryReference.classList.remove('hidden');
                // Strict Rule: If base is USD, show (~₱[rate]). If other, show (~$[usd_equiv]).
                if (from === 'USD') {
                    secondaryRateEl.textContent = rate;
                    secondaryReference.innerHTML = `(~₱${rate})`;
                } else {
                    const usdEquiv = (data.rate / (data.usd_rate || 56.4)).toFixed(2);
                    secondaryRateEl.textContent = usdEquiv;
                    secondaryReference.innerHTML = `(~$${usdEquiv})`;
                }
            } else {
                secondaryReference.classList.add('hidden');
            }



            // Social Mode Fast-path UI adjustments
            const isSocialMode = data.social_mode || window.isSocialWebview;
            if (isSocialMode) {

                // Remove heavy backdrop blur in social mode for faster rendering
                if (dashboardDiv) {
                    dashboardDiv.style.backdropFilter = 'none';
                    dashboardDiv.style.webkitBackdropFilter = 'none';
                }
                // Disable CSS animations that may freeze WebKit-based in-app browsers
                const slideshowEl = document.querySelector('.slideshow-container');
                if (slideshowEl) slideshowEl.style.display = 'none';
            }

            // Handling Geo-Conditional Switcher
            if (data.currency_locked) {
                // Not in PH -> Lock UI
                if (phSelectorContainer) phSelectorContainer.classList.remove('active');
                if (baseCurrencyLabelEl) {
                    baseCurrencyLabelEl.style.display = 'inline';
                    baseCurrencyLabelEl.textContent = `1 ${data.from_currency}`;
                }
            } else {
                // In PH -> Show Switcher
                if (baseCurrencyLabelEl) baseCurrencyLabelEl.style.display = 'none';
                if (phSelectorContainer) phSelectorContainer.classList.add('active');
                if (baseCurrencySelect) baseCurrencySelect.value = data.from_currency;
            }

            if (targetCurrencyLabelEl) targetCurrencyLabelEl.textContent = data.to_currency;
            
            // Single Source of Math: Using rate exactly as provided by Worker
            const currentContent = rateValueEl.textContent.replace(/,/g, '');
            animateNumber(rateValueEl, parseFloat(currentContent) || 0, data.rate);
            
            targetSymbolEl.textContent = data.target_symbol || '\u20B1';
            lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}`;
            
            rateValueEl.parentElement.style.opacity = '1';

            // ✅ Signal success ONLY after content is rendered
            window.appLoaded = true;
            clearTimeout(window.appBootTimeout);

            // Fetch and draw the historical trend silently in the background
            fetchAndDrawTrend(data.from_currency);

        } catch (error) {
            console.error('Failed to fetch rate:', error);
            rateValueEl.textContent = 'Err';
            rateValueEl.parentElement.style.opacity = '1';

            // Report failed load for social traffic analytics
            try {
                if (isSocialWebview) {
                    navigator.sendBeacon('/api/social-event', JSON.stringify({ event: 'load_failed' }));
                }
            } catch (_) { /* silent */ }
            
            // Show fallback UI on ANY fetch failure (first load or retry)
            if (!window.appLoaded) {
                const fallback = document.getElementById('fallback-ui');
                const loader = document.getElementById('app-boot-loading');
                if (loader) loader.style.display = 'none';
                if (fallback) fallback.classList.remove('hidden');
            }
        }
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
            if (!res.ok) return;
            const data = await res.json();
            if (!data.trends || data.trends.length < 2) {
                ctx.clearRect(0,0, canvas.width, canvas.height);
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
