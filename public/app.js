document.addEventListener('DOMContentLoaded', () => {
    const firstVisitDiv = document.getElementById('first-visit');
    const dashboardDiv = document.getElementById('dashboard');
    const nameInput = document.getElementById('name-input');
    const saveNameBtn = document.getElementById('save-name-btn');
    
    const greetingEl = document.getElementById('greeting');
    const currencyPairEl = document.getElementById('currency-pair');
    const currencySelect = document.getElementById('currency-select');
    const rateValueEl = document.getElementById('rate-value');
    const targetSymbolEl = document.getElementById('target-symbol');
    const lastUpdatedEl = document.getElementById('last-updated');
    const refreshBtn = document.getElementById('refresh-btn');

    let userName = localStorage.getItem('ofw_pesorate_name');
    let userId = localStorage.getItem('ofw_pesorate_id');
    // selectedCurrency starts null — backend decides on first load
    // We only apply a saved preference AFTER confirming user is in PH
    let selectedCurrency = null;
    let userCountry = null; // Set after first API response

    if (!userId) {
        userId = crypto.randomUUID();
        localStorage.setItem('ofw_pesorate_id', userId);
    }

    if (!userName) {
        firstVisitDiv.classList.remove('hidden');
    } else {
        showDashboard(userName);
    }

    // Don't pre-set the selector — wait for backend response

    currencySelect.addEventListener('change', () => {
        // Only PH users can switch — double-check before applying
        if (userCountry !== 'PH') return;
        selectedCurrency = currencySelect.value;
        localStorage.setItem('ofw_pesorate_currency', selectedCurrency);
        fetchRate(userName, userId, true);
    });

    saveNameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
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

    refreshBtn.addEventListener('click', () => {
        fetchRate(userName, userId, true);
    });

    function getFlagEmoji(countryCode) {
        if (!countryCode) return '';
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    }

    async function showDashboard(name) {
        dashboardDiv.classList.remove('hidden');
        greetingEl.textContent = `Hello ${name}`;
        await fetchRate(name, userId, false);
    }

    async function fetchRate(name, id, isRefresh = false) {
        if (isRefresh) {
            rateValueEl.textContent = 'Updating...';
            rateValueEl.style.opacity = '0.7';
        }

        try {
            const url = new URL('/api/rate', window.location.origin);

            // ── Currency param rules ───────────────────────────────────────
            // ONLY send ?currency if the user is confirmed PH and has chosen one.
            // On first load (userCountry not yet known), send nothing and let backend decide.
            if (userCountry === 'PH' && selectedCurrency) {
                url.searchParams.set('currency', selectedCurrency);
            }
            // Non-PH users: never override — backend geo is the source of truth

            const res = await fetch(url, {
                headers: {
                    'x-user-id': id,
                    'x-user-name': encodeURIComponent(name || '')
                }
            });

            if (!res.ok) throw new Error('API Error');

            const data = await res.json();

            // ── Update known country from backend ─────────────────────────
            userCountry = data.country;
            const isLocked = data.currency_locked !== false; // true unless explicitly false

            // ── Show/Hide switcher strictly by backend rule ───────────────
            if (!isLocked) {
                // PH user — apply saved preference, show switcher
                currencySelect.parentElement.classList.remove('hidden');
                currencySelect.disabled = false;

                // Load PH user's saved preference now that we know they are PH
                if (!selectedCurrency) {
                    const saved = localStorage.getItem('ofw_pesorate_currency');
                    if (saved && saved !== 'USD') {
                        selectedCurrency = saved;
                    } else {
                        selectedCurrency = data.from_currency;
                    }
                    currencySelect.value = selectedCurrency;
                    // Re-fetch with the actual currency preference
                    if (selectedCurrency !== data.from_currency) {
                        return fetchRate(name, id, false);
                    }
                }
            } else {
                // Non-PH — clear any stale localStorage currency and lock UI
                localStorage.removeItem('ofw_pesorate_currency');
                selectedCurrency = null;
                currencySelect.parentElement.classList.add('hidden');
                currencySelect.disabled = true;
            }

            // ── Render ────────────────────────────────────────────────────
            const flag = getFlagEmoji(data.country);
            greetingEl.textContent = `Hello ${name} ${flag}`;

            currencyPairEl.innerHTML = `1 ${data.from_currency} &rarr; 1 ${data.to_currency}`;
            rateValueEl.textContent = Number(data.rate).toFixed(2);
            targetSymbolEl.textContent = data.symbol || '';

            lastUpdatedEl.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            rateValueEl.style.opacity = '1';

        } catch (error) {
            console.error('Failed to fetch rate:', error);
            rateValueEl.textContent = 'Error';
            lastUpdatedEl.textContent = 'Failed to load';
            rateValueEl.style.opacity = '1';
        }
    }
});
