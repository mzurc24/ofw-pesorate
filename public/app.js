(() => {
    'use strict';

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
        userId = crypto.randomUUID();
        localStorage.setItem('ofw_pesorate_id', userId);
    }

    // ── Bootstrap ────────────────────────────────────────────────────────────
    if (!userName) {
        firstVisitDiv.classList.remove('hidden');
    } else {
        showDashboard(userName);
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
        dashboardDiv.classList.remove('hidden');
        greetingEl.textContent = `Hello, ${name} 👋`;
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
            
            const res = await fetch(url, {
                headers: {
                    'x-user-id': id,
                    'x-user-name': encodeURIComponent(name || '')
                }
            });
            
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
            
            // Smooth Number Transition
            animateNumber(rateValueEl, parseFloat(rateValueEl.textContent) || 0, data.rate);
            
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
        
        // Exact cubic-bezier(0.22, 1, 0.36, 1) approximation
        function easeOutApple(t) {
            return 1 - Math.pow(1 - t, 3); // Cubic fallback for simplicity, or use formal bezier
        }
        
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // For a true Apple feel, we'll use a standard cubic-bezier approximation
            // x1=0.22, y1=1, x2=0.36, y2=1
            const ease = 1 - Math.pow(1 - progress, 4); // Quartic is a close feel-match for fast start, slow end
            
            const current = (start + (end - start) * ease).toFixed(2);
            el.textContent = current;
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }
        requestAnimationFrame(update);
    }
})();
