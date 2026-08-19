// Chart.js 統計グラフ層 (ES Module)
// Chart は CDN で読み込まれるグローバル

let statsChartInstance = null;
let currentChartType = 'acs';
let lastProcessedMatchHistory = [];

export function setChartData(processedMatchHistory) {
    lastProcessedMatchHistory = processedMatchHistory;
}

export function updateStatsChart() {
    if (!lastProcessedMatchHistory || lastProcessedMatchHistory.length === 0) {
        // データがない場合はグラフをクリアまたは非表示にする (任意)
        if (statsChartInstance) {
            statsChartInstance.destroy();
            statsChartInstance = null;
        }
        document.getElementById('chartTitle').textContent = 'グラフデータがありません';
        return;
    }

    let chartData = [];
    let yAxisLabel = '';
    let chartTitleText = '';
    let datasetLabel = '';

    switch (currentChartType) {
        case 'acs':
            chartData = lastProcessedMatchHistory.map(match => match.acs);
            yAxisLabel = 'ACS';
            datasetLabel = 'ACS';
            chartTitleText = 'ACS (Average Combat Score) 推移';
            break;
        case 'kd':
            chartData = lastProcessedMatchHistory.map(match => parseFloat(match.kd) || 0);
            yAxisLabel = 'K/D Ratio';
            datasetLabel = 'K/D';
            chartTitleText = 'K/D 比率 推移';
            break;
        case 'ddDelta':
            chartData = lastProcessedMatchHistory.map(match => {
                if (match.roundsPlayed > 0 && typeof match.damageDealt === 'number' && typeof match.damageReceived === 'number') {
                    return Math.round((match.damageDealt - match.damageReceived) / match.roundsPlayed);
                }
                return 0; // データ不備またはラウンド数0の場合は0
            });
            yAxisLabel = 'DDΔ / Round';
            datasetLabel = 'DDΔ';
            chartTitleText = 'ラウンド毎ダメージ差 (DDΔ) 推移';
            break;
        case 'hs':
            chartData = lastProcessedMatchHistory.map(match => parseFloat(match.hs) || 0);
            yAxisLabel = 'HS %';
            datasetLabel = 'HS%';
            chartTitleText = 'ヘッドショット率 (%) 推移';
            break;
        default:
            console.error('Unknown chart type:', currentChartType);
            return;
    }

    document.getElementById('chartTitle').textContent = chartTitleText;

    const ctx = document.getElementById('statsChart').getContext('2d');

    if (statsChartInstance) {
        statsChartInstance.destroy();
    }

    const labels = lastProcessedMatchHistory.length > 0 ? lastProcessedMatchHistory.map((_, i) => `Match ${lastProcessedMatchHistory.length - i}`).reverse() : [];

    statsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: datasetLabel,
                data: chartData,
                borderColor: 'rgb(239, 68, 68)',       // Tailwind red-500
                backgroundColor: 'rgba(239, 68, 68, 0.2)', // Tailwind red-500 with alpha
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#fff',
                pointBorderColor: 'rgb(239, 68, 68)',
                pointHoverRadius: 7,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // 親要素(.relative.h-64.sm:h-80)の高さに追従させる
            scales: {
                y: {
                    beginAtZero: false, // HS%やDDΔは0始まりでない方が見やすい場合がある
                    title: { display: true, text: yAxisLabel, color: '#9ca3af' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#9ca3af' }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#9ca3af' }
                }
            },
            plugins: {
                legend: { display: true, labels: { color: '#9ca3af' } } // 凡例は表示し、文字色を設定
            }
        }
    });
}

export function initChartTypeButtons() {
    const chartTypeButtons = document.querySelectorAll('.chart-type-button');
    chartTypeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const type = button.dataset.type;
            if (type === currentChartType && statsChartInstance) return; // 同じタイプで既にグラフ表示中なら何もしない

            currentChartType = type;
            updateStatsChart();

            // ボタンのスタイル更新
            chartTypeButtons.forEach(btn => {
                btn.classList.remove('bg-red-500');
                btn.classList.add('bg-gray-600', 'hover:bg-gray-500');
            });
            button.classList.add('bg-red-500');
            button.classList.remove('bg-gray-600', 'hover:bg-gray-500');
        });
    });
}
