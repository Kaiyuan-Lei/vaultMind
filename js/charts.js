// js/charts.js
// ─────────────────────────────────────────────────────────────
// Bug 1 fix: 移除 ES module import — Chart.js 已由 index.html
//            以 UMD <script> 載入為 window.Chart 全域變量，
//            此文件直接使用，不需再次 import。
// ─────────────────────────────────────────────────────────────

// ── 設計系統色票（與 index.html 保持一致） ──
// Bug 6 fix: 統一使用設計系統色，不用品牌原色
const COLORS = {
  ETH:       '#4da6ff',  // C.blue
  BTC:       '#f4a623',  // C.amber
  'RWA Bond':'#9b7eff',  // C.purple
  'USDC LP': '#00d4a0',  // C.green
  'Stable LP':'#00b88a',
  ARB:       '#ff4d4f',  // C.red
  USDT:      '#00d4a0',
  default:   '#94a3b8',
};

// Bug 8 fix（來自 index.html 分析）: Chart.js 顏色一律用 hex，不用 CSS var
const CHART = {
  text:   '#e2e8f0',
  muted:  '#94a3b8',
  grid:   '#1e293b',
  mono:   '"DM Mono", monospace',
};

// ── Chart 實例管理 ──
// Bug 3 fix: 統一追蹤實例，切換 tab 前先銷毀，防止 "Canvas already in use"
const _instances = {};

function destroyChart(id) {
  if (_instances[id]) {
    _instances[id].destroy();
    delete _instances[id];
  }
}

function createChart(id, config) {
  destroyChart(id);
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[charts.js] canvas #${id} not found`);
    return null;
  }
  const chart = new Chart(el.getContext('2d'), config);
  _instances[id] = chart;
  return chart;
}

// ── 公共工具 ──
function getAssetColor(name) {
  return COLORS[name] || COLORS.default;
}

// ─────────────────────────────────────────────────────────────
// updateOverviewPage(data)
//
// 預期 portfolio.json 結構：
// {
//   total_value_usd: 4210000,
//   sharpe: 1.84,
//   max_drawdown: "-8.2%",
//   risk_score: 42,
//   annual_return: "+34.7%",
//   assets: [
//     { name: "ETH", value: 1190000, percentage: 28.3 },
//     ...
//   ],
//   nav_history: [
//     { date: "Sep", value: 100 },
//     ...
//   ],
//   btc_benchmark: [
//     { date: "Sep", value: 100 },
//     ...
//   ]
// }
// ─────────────────────────────────────────────────────────────
export function updateOverviewPage(data) {
  // ── 1. Metric Cards ──
  const aum = document.getElementById('aum-value');
  if (aum && data.total_value_usd != null) {
    const m = (data.total_value_usd / 1e6).toFixed(2);
    aum.textContent = `$${m}M`;
  }

  const sharpe = document.getElementById('sharpe-value');
  if (sharpe && data.sharpe != null) {
    sharpe.textContent = data.sharpe.toFixed(2);
  }

  const mdd = document.getElementById('mdd-value');
  if (mdd && data.max_drawdown != null) {
    mdd.textContent = data.max_drawdown;
  }

  // risk-score: index.html 此欄現在顯示 annual_return
  // 若 portfolio.json 有 annual_return 則更新，否則保留靜態值
  const annualEl = document.getElementById('annual-return');
  if (annualEl && data.annual_return != null) {
    annualEl.textContent = data.annual_return;
  }

  // ── 2. 資產配置條 ──
  // Bug 2 fix: DOM 結構與 CSS class 對齊 index.html
  const barsContainer = document.getElementById('allocation-bars');
  if (barsContainer && Array.isArray(data.assets) && data.assets.length > 0) {
    barsContainer.innerHTML = (data.assets).map(asset => {
      const color = getAssetColor(asset.name || '');
      const pct   = asset.percentage?.toFixed(1) ?? '0';
      const val   = asset.value != null
        ? (asset.value >= 1e6
            ? `$${(asset.value / 1e6).toFixed(2)}M`
            : `$${asset.value.toLocaleString()}`)
        : '--';

      return `
        <div class="alloc-row">
          <div class="alloc-dot" style="background:${color}"></div>
          <div class="alloc-name">${asset.name || '未知'}</div>
          <div class="alloc-bar-wrap">
            <div class="alloc-bar"
                 style="width:0%;background:${color};transition:width .5s ease"
                 data-target="${pct}">
            </div>
          </div>
          <div class="alloc-pct">${pct}%</div>
          <div class="alloc-val">${val}</div>
        </div>`;
    }).join('');

    // 動畫：下一幀才設寬度，觸發 CSS transition
    requestAnimationFrame(() => {
      barsContainer.querySelectorAll('.alloc-bar[data-target]').forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
    });
  }

  // ── 3. NAV 折線圖 ──
  // Bug 3 fix: 使用 createChart() 統一管理實例生命周期
  // Bug 4 fix: 顏色全部改用 hex
  const navLabels = data.nav_history?.map(h => h.date) ?? [];
  const navData   = data.nav_history?.map(h => h.value) ?? [];
  const btcData   = data.btc_benchmark?.map(h => h.value) ?? [];

  if (navLabels.length > 0) {
    createChart('navLineChart', {
      type: 'line',
      data: {
        labels: navLabels,
        datasets: [
          {
            label: '組合 NAV',
            data: navData,
            borderColor: '#00d4a0',
            backgroundColor: 'rgba(0,212,160,0.08)',
            tension: 0.4,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: '#00d4a0',
          },
          {
            label: 'BTC 基準',
            data: btcData,
            borderColor: 'rgba(244,166,35,0.5)',
            backgroundColor: 'transparent',
            borderDash: [6, 4],
            tension: 0.4,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              // Bug 4 fix: hex 取代 CSS var
              color: CHART.muted,
              font: { family: CHART.mono, size: 11 },
              boxWidth: 10,
            },
          },
        },
        scales: {
          x: {
            grid:  { color: CHART.grid },
            border:{ color: CHART.grid },
            ticks: { color: CHART.muted, font: { family: CHART.mono, size: 10 } },
          },
          y: {
            grid:  { color: CHART.grid },
            border:{ color: CHART.grid },
            ticks: {
              color: CHART.muted,
              font:  { family: CHART.mono, size: 10 },
              callback: v => v + '%',
            },
          },
        },
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────
// updatePortfolioPage(data)   — 持倉分析頁（預留擴展）
// ─────────────────────────────────────────────────────────────
export function updatePortfolioPage(data) {
  // 圓餅圖
  const labels = data.assets?.map(a => a.name) ?? [];
  const values = data.assets?.map(a => a.percentage) ?? [];
  const bgColors = labels.map(getAssetColor);

  createChart('overviewPie', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: CHART.muted, font: { family: CHART.mono, size: 11 }, boxWidth: 8, padding: 10 },
        },
      },
    },
  });

  // 30日表現柱圖
  const perfLabels = data.assets?.map(a => a.name) ?? [];
  const perfVals   = data.assets?.map(a => a.perf_30d ?? 0) ?? [];

  createChart('portfolioBar', {
    type: 'bar',
    data: {
      labels: perfLabels,
      datasets: [{
        data: perfVals,
        backgroundColor: perfVals.map(v => v >= 0 ? 'rgba(0,212,160,0.65)' : 'rgba(255,77,79,0.65)'),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: CHART.grid }, ticks: { color: CHART.muted, font: { family: CHART.mono, size: 11 } } },
        y: { grid: { color: CHART.grid }, ticks: { color: CHART.muted, font: { family: CHART.mono, size: 10 }, callback: v => v + '%' } },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 導出 destroyChart 供 index.html 或其他模組使用（如需要）
// ─────────────────────────────────────────────────────────────
export { destroyChart, createChart, getAssetColor, COLORS, CHART };