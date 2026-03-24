// js/claude-api.js — 修復所有 9 個問題

/**
 * 呼叫 Anthropic Claude API，以流式方式接收回應
 * @param {string} apiKey
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {(chunk: string) => void} onChunk
 * @param {number} [maxTokens=1000]
 * @param {AbortSignal|null} [signal=null]
 */
export async function callClaudeAPI(
  apiKey,
  systemPrompt,
  userPrompt,
  onChunk,
  maxTokens = 1000,   // Design fix: 可配置
  signal = null       // Warn fix: AbortController 支援
) {
  // Warn fix: onChunk 型別驗證
  if (typeof onChunk !== 'function') {
    throw new TypeError('onChunk 必須是函數，收到：' + typeof onChunk);
  }
  if (!apiKey) {
    throw new Error('缺少 ANTHROPIC_API_KEY');
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,           // Warn fix: 支援中止
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',  // Warn fix: 更新模型
      max_tokens: maxTokens,              // Design fix: 可配置
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    // 嘗試解析 JSON 錯誤，回退到純文字
    const errBody = await resp.json().catch(() => resp.text());
    const errMsg = typeof errBody === 'object'
      ? errBody.error?.message ?? JSON.stringify(errBody)
      : errBody;
    throw new Error(`Claude API 錯誤 ${resp.status}: ${errMsg}`);
  }

  // Bug fix: 開啟 stream 模式，防止多位元組字符跨 chunk 時解碼錯誤
  const decoder = new TextDecoder('utf-8');
  const reader = resp.body.getReader();

  try {                                   // Bug fix: 確保 reader 鎖在例外時釋放
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true }); // Bug fix: stream mode
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        if (line === 'data: [DONE]') continue;              // Bug fix: 跳過終止符

        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'content_block_delta' && data.delta?.text) {
            onChunk(data.delta.text);
          }
        } catch (e) {
          console.warn('解析 SSE 資料失敗:', e.message, '|', line.slice(0, 80));
        }
      }
    }
  } finally {
    reader.releaseLock();                 // Bug fix: 無論成功或失敗都釋放鎖
  }
}

// Design fix: 改為工廠函數，動態注入真實組合數據
export function buildSystemPrompt(portfolio = {}) {
  const {
    aum        = '$4.21M',
    sharpe     = '1.84',
    maxDD      = '-8.2%',
    annReturn  = '+34.7%',
    allocations = [
      { name: 'ETH', pct: 28.3 }, { name: 'RWA Bond', pct: 26.4 },
      { name: 'BTC', pct: 20.7 }, { name: 'USDC LP',  pct: 12.8 },
      { name: 'ARB', pct: 5.4  },
    ],
    strategies = ['ETH Basis Trade', 'AAVE v3 Loop', 'RWA Bond Yield'],
  } = portfolio;

  return `你是一位專業的 Web3 資產管理分析師，精通以下領域：
- DeFi 策略（借貸套利、流動性挖礦、Delta 中性對沖）
- 鏈上數據分析（Whale 行為、資金流向、TVL 趨勢）
- 風險管理（VaR、Sharpe Ratio、相關性分析）
- 香港 SFC 加密監管框架（VASP 牌照、穩定幣條例）

回答要求：
1. 使用繁體中文
2. 回答控制在 250 字以內
3. 給出具體可操作的建議（含數字和比例）
4. 使用 Markdown 格式（粗體標題、列表）

當前組合數據：
- AUM: ${aum}  Sharpe: ${sharpe}  Max DD: ${maxDD}  年化: ${annReturn}
- 配置: ${allocations.map(a => `${a.name} ${a.pct}%`).join(', ')}
- 活躍策略: ${strategies.join(', ')}`.trim(); // Warn fix: .trim() 移除前後換行
}

// 向後相容：保留靜態匯出供不需要動態數據的場景使用
export const SYSTEM_PROMPT = buildSystemPrompt();