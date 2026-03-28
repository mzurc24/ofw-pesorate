(() => {
    'use strict';

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
    const refreshBtn            = document.getElementById('refresh-btn');
    
    // PH Mode Switcher
    const phSelectorContainer   = document.getElementById('ph-selector-container');
    const baseCurrencySelect    = document.getElementById('base-currency-select');

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
        await fetchRate(name, userId, false, currentCurrency);
    }

    refreshBtn.addEventListener('click', () => {
        fetchRate(userName, userId, true, currentCurrency);
    });

    baseCurrencySelect.addEventListener('change', (e) => {
        currentCurrency = e.target.value;
        localStorage.setItem('ofw_pesorate_base', currentCurrency);
        fetchRate(userName, userId, true, currentCurrency);
    });

    async function fetchRate(name, id, isRefresh = false, currency = null) {
        if (isRefresh) {
            rateValueEl.parentElement.style.opacity = '0.6';
        }

        try {
            const url = new URL('/api/rate', window.location.origin);
            if (currency) url.searchParams.set('currency', currency);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'x-user-id': id,
                    'x-user-name': encodeURIComponent(name || '')
                }
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();
            
            // Render UI
            greetingEl.textContent = `Hello, ${name} 👋`;
            greetingSubEl.textContent = `Real-time exchange rates`;

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
            
            targetSymbolEl.textContent = data.target_symbol || '₱';
            lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}`;
            
            rateValueEl.parentElement.style.opacity = '1';

        } catch (error) {
            console.error('Failed to fetch rate:', error);
            rateValueEl.textContent = 'Err';
            rateValueEl.parentElement.style.opacity = '1';
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
})();
