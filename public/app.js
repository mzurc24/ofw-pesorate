document.addEventListener('DOMContentLoaded', () => {
    const firstVisitDiv = document.getElementById('first-visit');
    const dashboardDiv = document.getElementById('dashboard');
    const nameInput = document.getElementById('name-input');
    const saveNameBtn = document.getElementById('save-name-btn');
    
    const greetingEl = document.getElementById('greeting');
    const currencyPairEl = document.getElementById('currency-pair');
    const rateValueEl = document.getElementById('rate-value');
    const lastUpdatedEl = document.getElementById('last-updated');
    const refreshBtn = document.getElementById('refresh-btn');

    let userName = localStorage.getItem('ofw_pesorate_name');
    let userId = localStorage.getItem('ofw_pesorate_id');

    if (!userId) {
        userId = crypto.randomUUID();
        localStorage.setItem('ofw_pesorate_id', userId);
    }

    if (!userName) {
        firstVisitDiv.classList.remove('hidden');
    } else {
        showDashboard(userName);
    }

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
            const res = await fetch('/api/rate', {
                headers: {
                    'x-user-id': id,
                    'x-user-name': encodeURIComponent(name)
                }
            });
            
            if (!res.ok) throw new Error('API Error');
            
            const data = await res.json();
            
            if (data.country) {
                const flag = getFlagEmoji(data.country);
                greetingEl.textContent = `Hello ${name} ${flag}`;
            }

            currencyPairEl.innerHTML = `${data.from_currency} &rarr; ${data.to_currency}`;
            rateValueEl.textContent = Number(data.rate).toFixed(2);
            lastUpdatedEl.textContent = `Updated: ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            
            rateValueEl.style.opacity = '1';

        } catch (error) {
            console.error('Failed to fetch rate:', error);
            rateValueEl.textContent = 'Error';
            lastUpdatedEl.textContent = 'Failed to load';
            rateValueEl.style.opacity = '1';
        }
    }
});
