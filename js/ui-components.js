// js/ui-components.js

/**
 * 繪製半圓風險儀表盤。
 * Bug 1 fix: 簽名改為 (riskScore, canvasId)，canvasId 帶預設值，
 *            與 index.html 的 drawRiskGauge(42) 單參數呼叫對齊。
 * @param {number} riskScore  - 風險分數 0~100
 * @param {string} [canvasId='riskGauge'] - Canvas 元素 id
 */
export function drawRiskGauge(riskScore, canvasId = 'riskGauge') {
  // Bug 6 fix: clamp + 型別守衛
  riskScore = Math.max(0, Math.min(100, Number(riskScore) || 0));

  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`[drawRiskGauge] 找不到 canvas#${canvasId}`);
    return;
  }

  const ctx     = canvas.getContext('2d');
  const W       = canvas.width;
  const H       = canvas.height;
  const centerX = W / 2;
  const centerY = H - 20;

  // Bug 2 fix: 動態計算半徑，保留 10px 邊距
  const radius  = Math.min(centerX, centerY) - 10;

  ctx.clearRect(0, 0, W, H);

  // Bug 3 fix: 背景弧從 π（左）到 2π（右），沿上半圓，順時針 false
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI, false);
  ctx.lineWidth   = 16;
  ctx.lineCap     = 'round';                    // Warn 5 fix
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  // Bug 3 fix: 動態弧終點 = π + (score/100)*π
  const endAngle = Math.PI + (riskScore / 100) * Math.PI;
  const color    = riskScore < 35 ? '#00d4a0'
                 : riskScore < 65 ? '#f4a623'
                 :                  '#ff4d4f';

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, endAngle, false);
  ctx.lineWidth   = 16;
  ctx.lineCap     = 'round';                    // Warn 5 fix
  ctx.strokeStyle = color;
  ctx.stroke();

  // Warn 7 fix: 從 canvas 繼承文字顏色，適配深/亮色主題
  const textColor = getComputedStyle(canvas).color || '#e2e8f0';

  // Bug 4 fix: 實際字型名稱，不用 CSS 變量
  ctx.fillStyle   = textColor;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';

  ctx.font        = `bold ${Math.round(radius * 0.38)}px "DM Mono", monospace`;
  ctx.fillText(riskScore, centerX, centerY - Math.round(radius * 0.35));

  ctx.font        = `${Math.round(radius * 0.18)}px system-ui, sans-serif`;
  ctx.fillStyle   = getComputedStyle(canvas).getPropertyValue('color') || '#94a3b8';
  ctx.globalAlpha = 0.6;
  ctx.fillText('風險分數', centerX, centerY - 8);
  ctx.globalAlpha = 1;
}

/**
 * Design 8 fix: 帶 easeOut 動畫的儀表盤入口。
 * 頁面切換時呼叫此函數替代 drawRiskGauge，有從 0 增長到目標值的動畫。
 * @param {number} targetScore - 最終風險分數 0~100
 * @param {string} [canvasId='riskGauge']
 * @param {number}