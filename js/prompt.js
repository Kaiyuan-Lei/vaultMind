// js/prompt.js
// 六個模組的 User Prompt 模板
// SYSTEM_PROMPT 的唯一來源已移至 claude-api.js，此處只 re-export

// Bug 1 fix: 不重複定義，從唯一來源匯入
export { buildSystemPrompt, SYSTEM_PROMPT } from './claude-api.js';

/**
 * 六個分析模組的預設 User Prompt。
 * 鍵名必須與 index.html 中 data-page 屬性值完全一致。
 * @type {Record<'overview'|'portfolio'|'risk'|'strategy'|'onchain'|'sentiment'|'default', string>}
 */
export const PROMPT_TEMPLATES = {
  // ✅ 與 index.html data-page 完全對齊
  overview:
    `分析當前組合整體健康狀況、識別最大風險集中點、給出 3 條具體再平衡建議，每條包含操作比例和預期改善效果`,

  portfolio:
    `分析資產相關性矩陣，識別高度正相關持倉（相關係數 > 0.7），給出具體的分散化方案和目標配置比例`,

  // Bug 2 fix: riskDashboard → risk，與 index.html 的 data-page="risk" 一致
  risk:
    `執行 BTC -30%、ETH -40%、DeFi Hack 三種壓力測試情景，評估組合在各情景下的損益，並給出對沖建議`,

  strategy:
    `評估目前 5 個策略的風險調整後收益（Sharpe Ratio、Max DD），找出應退出或加倉的策略並說明理由`,

  onchain:
    `解讀最新 Whale 行為和資金流異常信號，分析對持倉的影響，給出增持/減持/觀望的具體建議`,

  sentiment:
    `基於 Fear & Greed 指數與鏈上指標，判斷當前市場週期位置，給出未來 2 週的倉位管理建議`,

  // Warn 6 fix: 加入 fallback，防止未知 page key 傳入 undefined
  default:
    `請根據當前組合數據分析現況，給出最重要的 3 條操作建議`,
};