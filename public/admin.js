document.addEventListener('DOMContentLoaded', () => {
    const loginPanel = document.getElementById('login-panel');
    const dashboardPanel = document.getElementById('dashboard-panel');
    const tokenInput = document.getElementById('token-input');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');
    const refreshBtn = document.getElementById('refresh-btn');
    
    let adminToken = '';
    let chartInstance = null;

    // Check URL for token
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('token')) {
        adminToken = urlParams.get('token');
        loadDashboard();
    }

    loginBtn.addEventListener('click', () => {
        adminToken = tokenInput.value.trim();
        if (adminToken) {
            loadDashboard();
        }
    });

    tokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    refreshBtn.addEventListener('click', loadDashboard);

    async function loadDashboard() {
        loginBtn.textContent = 'Loading...';
        loginError.classList.add('hidden');
        
        try {
            const res = await fetch('/api/admin/metrics', {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            if (!res.ok) throw new Error('Unauthorized');

            const data = await res.json();
            
            // 1. Show dashboard
            loginPanel.classList.add('hidden');
            dashboardPanel.classList.remove('hidden');

            // 2. Populate basic stats
            document.getElementById('stat-users').textContent = data.metrics.newUsers7d;
            document.getElementById('stat-conversions').textContent = data.metrics.conversions7d;

            // 3. Render Table
            const tbody = document.getElementById('pairs-table');
            tbody.innerHTML = '';
            data.popularPairs.forEach(pair => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${pair.from_currency} &rarr; ${pair.to_currency}</td>
                    <td>${pair.count}</td>
                `;
                tbody.appendChild(tr);
            });

            // 4. Render Chart
            renderChart(data.daily);

        } catch (error) {
            console.error(error);
            loginError.classList.remove('hidden');
        } finally {
            loginBtn.textContent = 'Access Dashboard';
        }
    }

    function renderChart(dailyData) {
        const ctx = document.getElementById('dailyChart').getContext('2d');
        
        const labels = dailyData.map(d => d.date);
        const data = dailyData.map(d => d.conversions);

        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Conversions',
                    data: data,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
});
