(() => {
    'use strict';

    // ── Fixed country list ──────────────────────────────────────────────────
    const COUNTRY_CURRENCY = {
        SA:'SAR', AE:'AED', QA:'QAR', KW:'KWD', OM:'OMR', BH:'BHD',
        GB:'GBP', IT:'EUR', ES:'EUR', DE:'EUR', FR:'EUR', NL:'EUR',
        CH:'CHF', NO:'NOK', SE:'SEK',
        SG:'SGD', HK:'HKD', MY:'MYR', TW:'TWD', JP:'JPY',
        KR:'KRW', CN:'CNY', TH:'THB',
        US:'USD', CA:'CAD', MX:'MXN', AU:'AUD', NZ:'NZD',
        PH:'PHP'
    };

    const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_CURRENCY);

    // Only show quick-reference for these pairs (OFW focus)
    const QUICK_COUNTRIES = ['AE', 'SA', 'GB', 'SG', 'AU', 'US', 'JP', 'DE', 'CA', 'HK'];

    // ── DOM ────────────────────────────────────────────────────────────────
    const overlay      = document.getElementById('first-visit-overlay');
    const nameInput    = document.getElementById('name-input');
    const saveName     = document.getElementById('save-name-btn');
    const greetingEl   = document.getElementById('greeting');
    const greetingSubEl= document.getElementById('greeting-sub');
    const fromSel      = document.getElementById('from-select');
    const toSel        = document.getElementById('to-select');
    const amountInput  = document.getElementById('amount-input');
    const resultInput  = document.getElementById('result-input');
    const fromBadge    = document.getElementById('from-badge');
    const toBadge      = document.getElementById('to-badge');
    const rateDisplay  = document.getElementById('rate-display');
    const rateCurrLabel= document.getElementById('rate-currency-label');
    const rateDetail   = document.getElementById('rate-detail');
    const lastUpdated  = document.getElementById('last-updated');
    const stratBadge   = document.getElementById('strategy-badge');
    const refreshBtn   = document.getElementById('refresh-btn');
    const swapBtn      = document.getElementById('swap-btn');
    const lockNotice   = document.getElementById('lock-notice');
    const quickBody    = document.getElementById('quick-rates-body');

    // ── State ─────────────────────────────────────────────────────────────
    let userName    = localStorage.getItem('ofw_user_name');
    let userId      = localStorage.getItem('ofw_user_id') || crypto.randomUUID();
    let geoCountry  = null;
    let currentRate = null;
    let cachedRates = null; // EUR-based rates for quick calc
    let debounceTimer = null;

    localStorage.setItem('ofw_user_id', userId);

    // ── Bootstrap ──────────────────────────────────────────────────────────
    if (!userName) {
        overlay.style.display = 'flex';
        nameInput.focus();
    } else {
        overlay.style.display = 'none';
        greetingEl.textContent = `Hello, ${userName} 👋`;
        init();
    }

    saveName.addEventListener('click', () => {
        const name = nameInput.value.trim().slice(0, 30);
        if (!name) return;
        userName = name;
        localStorage.setItem('ofw_user_name', name);
        overlay.style.display = 'none';
        greetingEl.textContent = `Hello, ${name} 👋`;
        init();
    });
    nameInput.addEventListener('keypress', e => { if (e.key === 'Enter') saveName.click(); });

    function init() {
        convert();
    }

    // ── Core convert call ─────────────────────────────────────────────────
    async function convert(forceRefresh = false) {
        setLoading(true);

        const fromCountry = fromSel.value;
        const toCountry   = toSel.value;
        const amount      = parseFloat(amountInput.value) || 1;

        if (fromCountry === toCountry) {
            // Same country — shortcut
            resultInput.value = amount.toFixed(2);
            rateDisplay.textContent   = '1.0000';
            rateCurrLabel.textContent = `${COUNTRY_CURRENCY[toCountry]} / ${COUNTRY_CURRENCY[fromCountry]}`;
            rateDetail.innerHTML      = `<strong>1 ${COUNTRY_CURRENCY[fromCountry]}</strong> = <strong>1.0000 ${COUNTRY_CURRENCY[toCountry]}</strong>`;
            lastUpdated.textContent   = 'Same currency';
            setLoading(false);
            return;
        }

        try {
            const url = new URL('/api/convert', location.origin);
            url.searchParams.set('from_country', fromCountry);
            url.searchParams.set('to_country',   toCountry);
            url.searchParams.set('amount',        amount);
            if (forceRefresh) url.searchParams.set('_t', Date.now());

            const res = await fetch(url, {
                headers: {
                    'x-user-id':   userId,
                    'x-user-name': encodeURIComponent(userName || ''),
                }
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.status !== 'success') throw new Error('API error');

            // ── Geo setup on first load ──────────────────────────────────
            if (!geoCountry) {
                geoCountry = data.geo_country;
                applyGeoDefaults(data);
                // If geo changed our selectors, re-fetch with new values
                if (fromSel.value !== fromCountry || toSel.value !== toCountry) {
                    setLoading(false);
                    convert();
                    return;
                }
            }

            // ── Cache rates for quick panel ──────────────────────────────
            if (data._rates) cachedRates = data._rates;

            // ── Update state ──────────────────────────────────────────────
            currentRate = data.rate;

            // ── Render result ─────────────────────────────────────────────
            updateBadges();
            resultInput.value = Number(data.converted_amount).toFixed(2);

            const fromCur = data.source_currency;
            const toCur   = data.target_currency;
            rateDisplay.textContent   = Number(data.rate).toFixed(4);
            rateCurrLabel.textContent = `${toCur} / ${fromCur}`;
            rateDetail.innerHTML      = `<strong>1 ${fromCur}</strong> = <strong>${Number(data.rate).toFixed(4)} ${toCur}</strong>`;

            stratBadge.textContent  = data._meta?.strategy || 'live';
            lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;

            // ── Geo greeting ─────────────────────────────────────────────
            if (data.geo_country) {
                const flag = countryFlag(data.geo_country);
                greetingSubEl.textContent = `${flag} ${data.geo_country} detected — live rates active`;
            }

            // ── Currency lock enforcement ─────────────────────────────────
            applyLock(data.currency_locked);

            // ── Quick reference rates ─────────────────────────────────────
            if (data._rates) renderQuickRates(data._rates, data.target_currency);

        } catch (err) {
            console.error('Convert failed:', err);
            // Try local fallback if we have cached rates
            if (cachedRates) localFallback();
            else {
                rateDetail.textContent = '⚠ Rate unavailable. Tap Refresh to retry.';
            }
        } finally {
            setLoading(false);
        }
    }

    // ── Compute locally from cached rates ──────────────────────────────────
    function localFallback() {
        if (!cachedRates) return;
        const fromCur = COUNTRY_CURRENCY[fromSel.value];
        const toCur   = COUNTRY_CURRENCY[toSel.value];
        const eurFrom = cachedRates[fromCur] || 1;
        const eurTo   = cachedRates[toCur]   || 1;
        const rate    = eurTo / eurFrom;
        const amount  = parseFloat(amountInput.value) || 1;
        resultInput.value       = (amount * rate).toFixed(2);
        rateDisplay.textContent = rate.toFixed(4);
        rateDetail.innerHTML    = `<strong>1 ${fromCur}</strong> = <strong>${rate.toFixed(4)} ${toCur}</strong> <em style="color:var(--text-3)">(cached)</em>`;
        updateBadges();
    }

    // ── Debounced recalculate when amount changes ─────────────────────────
    function recalculate() {
        if (currentRate === null) return;
        const amount = parseFloat(amountInput.value) || 0;

        if (cachedRates) {
            localFallback();
        } else {
            resultInput.value = (amount * currentRate).toFixed(2);
        }
    }

    // ── Geo defaults: set selectors to match detected country ────────────
    function applyGeoDefaults(data) {
        const geo = data.geo_country;
        if (!geo || !COUNTRY_CURRENCY[geo]) return;

        if (geo === 'PH') {
            // PH user: FROM=PH, TO=AE (common OFW destination)
            if (fromSel.querySelector(`option[value="PH"]`)) fromSel.value = 'PH';
            if (toSel.querySelector(`option[value="AE"]`))   toSel.value   = 'AE';
        } else {
            // Overseas OFW: FROM=their country, TO=PH
            const hasFrom = fromSel.querySelector(`option[value="${geo}"]`);
            if (hasFrom) fromSel.value = geo;
            if (toSel.querySelector(`option[value="PH"]`)) toSel.value = 'PH';
        }
        updateBadges();
    }

    // ── Lock / unlock the FROM selector ────────────────────────────────────
    function applyLock(isLocked) {
        if (isLocked) {
            lockNotice.classList.remove('hidden');
            fromSel.disabled = true;
        } else {
            lockNotice.classList.add('hidden');
            fromSel.disabled = false;
        }
    }

    // ── Render the quick-rates reference panel ─────────────────────────────
    function renderQuickRates(rates, targetCurrency) {
        const toCur   = COUNTRY_CURRENCY[toSel.value] || targetCurrency || 'PHP';
        const eurToTo = rates[toCur] || 1;

        quickBody.innerHTML = QUICK_COUNTRIES
            .filter(cc => cc !== toSel.value) // skip if already selected
            .slice(0, 8)
            .map(cc => {
                const cur    = COUNTRY_CURRENCY[cc];
                const eurCur = rates[cur] || 1;
                const rate   = (eurToTo / eurCur).toFixed(3);
                const flag   = countryFlag(cc);
                return `<div class="quick-rate-row" data-country="${cc}" tabindex="0">
                    <span class="quick-rate-left">${flag} <span style="color:var(--text-2);margin-left:4px">${cur}</span></span>
                    <span class="quick-rate-val">→ ${rate} ${toCur}</span>
                </div>`;
            }).join('');

        quickBody.querySelectorAll('.quick-rate-row').forEach(row => {
            const activate = () => {
                const cc = row.dataset.country;
                if (!fromSel.disabled) fromSel.value = cc;
                updateBadges();
                convert();
            };
            row.addEventListener('click', activate);
            row.addEventListener('keypress', e => { if (e.key === 'Enter') activate(); });
        });
    }

    // ── Update currency abbreviation badges ───────────────────────────────
    function updateBadges() {
        fromBadge.textContent = COUNTRY_CURRENCY[fromSel.value] || fromSel.value;
        toBadge.textContent   = COUNTRY_CURRENCY[toSel.value]   || toSel.value;
    }

    // ── Events ───────────────────────────────────────────────────────────
    fromSel.addEventListener('change', () => { updateBadges(); convert(); });
    toSel.addEventListener('change',   () => { updateBadges(); convert(); });

    amountInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        // Instant local calc if we have rates
        if (cachedRates || currentRate !== null) recalculate();
        // Also refresh from server after short delay
        debounceTimer = setTimeout(() => convert(), 600);
    });

    refreshBtn.addEventListener('click', () => convert(true));

    swapBtn.addEventListener('click', () => {
        const oldFrom = fromSel.value;
        const oldTo   = toSel.value;
        // Non-PH users: FROM is geo-locked, only allow swapping TO list
        if (!fromSel.disabled) fromSel.value = oldTo;
        const targetOpt = toSel.querySelector(`option[value="${oldFrom}"]`);
        if (targetOpt) toSel.value = oldFrom;
        updateBadges();
        convert();
    });

    // ── Helpers ──────────────────────────────────────────────────────────
    function setLoading(on) {
        refreshBtn.textContent = on ? '↻ ...' : '↻ Refresh';
        refreshBtn.disabled    = on;
        rateDisplay.style.opacity = on ? '0.4' : '1';
    }

    function countryFlag(code) {
        if (!code || code.length !== 2) return '';
        return String.fromCodePoint(
            ...code.toUpperCase().split('').map(c => 0x1F1E6 - 65 + c.charCodeAt(0))
        );
    }
})();
