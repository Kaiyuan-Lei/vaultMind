// server.js — VaultMind Railway Service
//
// 職責：
//   1. 定時抓取鏈上數據、幣價、情緒指標（直接調 Etherscan / CoinGecko API）
//   2. 提供 REST API 給前端讀取即時數據
//   3. 代理 Claude API，流式回傳給瀏覽器，完成後推送 Telegram
//   4. 靜態托管 index.html

import express   from 'express';
import { mkdir, writeFile, readFile } from 'fs/promises';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR       = path.join(__dirname, 'data');
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID     = process.env.TELEGRAM_CHAT_ID;
const ETHERSCAN_KEY  = process.env.ETHERSCAN_API_KEY;
const COINGECKO_KEY  = process.env.COINGECKO_API_KEY;

// ── 啟動驗證 ──────────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[boot] ANTHROPIC_API_KEY not set'); process.exit(1);
}

await mkdir(DATA_DIR, { recursive: true });

// ── 工具函數 ──────────────────────────────────────────────────────────────────
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function saveData(key, data) {
  await writeFile(path.join(DATA_DIR, key + '.json'), JSON.stringify(data, null, 2));
  console.log(`[data] ${key} updated`);
}

async function readData(filename) {
  try { return JSON.parse(await readFile(path.join(DATA_DIR, filename), 'utf8')); }
  catch { return null; }
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text.slice(0, 4000),
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) { console.warn('[tg]', e.message); }
}

function fmtTg(page, summary) {
  return `🤖 *VaultMind · ${page}*\n\n` +
    summary.replace(/#{1,3} /g, '*').replace(/\*\*(.+?)\*\*/g, '*$1*').slice(0, 3500);
}

// ════════════════════════════════════════════════════════════════
//  數據抓取 — 替代 OpenClaw flows
// ════════════════════════════════════════════════════════════════

// ── Flow 1: 幣價 + 持倉數據（每 5 分鐘）─────────────────────────────────────
async function fetchPortfolioData() {
  try {
    const ids = 'ethereum,bitcoin,arbitrum,usd-coin';
    const url = COINGECKO_KEY
      ? `https://pro-api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&x_cg_pro_api_key=${COINGECKO_KEY}`
      : `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    const prices = await fetchJson(url);

    const data = {
      timestamp: new Date().toISOString(),
      prices: {
        ETH:  { usd: prices.ethereum?.usd,  change24h: prices.ethereum?.usd_24h_change },
        BTC:  { usd: prices.bitcoin?.usd,   change24h: prices.bitcoin?.usd_24h_change },
        ARB:  { usd: prices.arbitrum?.usd,  change24h: prices.arbitrum?.usd_24h_change },
        USDC: { usd: prices['usd-coin']?.usd, change24h: 0 },
      },
      // 實際持倉由前端用戶輸入，這裡只提供即時幣價供參考
      source: 'coingecko',
    };

    await saveData('portfolio', data);
  } catch (e) {
    console.error('[flow:portfolio]', e.message);
  }
}

// ── Flow 2: 鏈上大額轉移警報（每 2 分鐘）────────────────────────────────────
async function fetchOnchainSignals() {
  try {
    const alerts = [];

    if (ETHERSCAN_KEY) {
      // 最近 USDT 大額轉移（>$500K）
      const txUrl = `https://api.etherscan.io/api?module=account&action=tokentx` +
        `&contractaddress=0xdAC17F958D2ee523a2206206994597C13D831ec7` +
        `&page=1&offset=20&sort=desc&apikey=${ETHERSCAN_KEY}`;
      const txData = await fetchJson(txUrl);

      if (txData.status === '1' && Array.isArray(txData.result)) {
        for (const tx of txData.result.slice(0, 10)) {
          const amount = Number(tx.value) / 1e6; // USDT 6 decimals
          if (amount < 500_000) continue;
          alerts.push({
            id: tx.hash.slice(0, 12),
            time: new Date(Number(tx.timeStamp) * 1000).toLocaleTimeString('zh-HK', { hour12: false }),
            asset: 'USDT',
            amount_usd: amount,
            direction: tx.to === tx.from ? '自轉' : '大額轉移',
            risk: amount > 2_000_000 ? 'high' : 'medium',
            detail: `從 ${tx.from.slice(0, 6)}…${tx.from.slice(-4)} 轉出`,
            tx_hash: tx.hash.slice(0, 16) + '…',
          });
        }
      }

      // ETH 大額轉移
      const ethUrl = `https://api.etherscan.io/api?module=account&action=txlist` +
        `&address=0x00000000219ab540356cBB839Cbe05303d7705Fa` + // ETH2 deposit contract
        `&page=1&offset=5&sort=desc&apikey=${ETHERSCAN_KEY}`;
      const ethData = await fetchJson(ethUrl);

      if (ethData.status === '1' && Array.isArray(ethData.result)) {
        for (const tx of ethData.result.slice(0, 3)) {
          const ethAmt = Number(tx.value) / 1e18;
          if (ethAmt < 32) continue; // 至少 1 個 validator
          alerts.push({
            id: tx.hash.slice(0, 12),
            time: new Date(Number(tx.timeStamp) * 1000).toLocaleTimeString('zh-HK', { hour12: false }),
            asset: 'ETH',
            amount_usd: ethAmt * 2800, // 估算
            direction: 'ETH2 質押',
            risk: 'low',
            detail: `質押 ${ethAmt.toFixed(1)} ETH`,
            tx_hash: tx.hash.slice(0, 16) + '…',
          });
        }
      }
    }

    // DeFi 協議 TVL（DeFiLlama，免費無需 Key）
    const protocols = ['aave-v3', 'uniswap-v3', 'makerdao', 'curve-dex', 'lido'];
    const tvlData = [];
    for (const slug of protocols) {
      try {
        const d = await fetchJson(`https://api.llama.fi/protocol/${slug}`);
        const tvl = d.currentChainTvls?.Ethereum || d.tvl?.at(-1)?.totalLiquidityUSD || 0;
        const prev = d.tvl?.at(-2)?.totalLiquidityUSD || tvl;
        tvlData.push({
          name: d.name || slug,
          tvl_usd: tvl,
          tvl_change_24h_pct: prev ? +((tvl - prev) / prev * 100).toFixed(2) : 0,
          color: { 'aave-v3': '#9b7eff', 'uniswap-v3': '#ff5c6a', makerdao: '#4da6ff', 'curve-dex': '#f4a623', lido: '#00d4a0' }[slug] || '#8896aa',
        });
      } catch { /* skip failed protocol */ }
    }

    const data = {
      timestamp: new Date().toISOString(),
      summary: {
        protocols_monitored: tvlData.length,
        chains: ['ETH', 'ARB', 'OP'],
        large_tx_alerts_24h: alerts.length,
        anomalous_tx_count: alerts.filter(a => a.risk === 'high').length,
        data_lag_seconds: 12,
      },
      alerts: alerts.slice(0, 8),
      protocols: tvlData,
      stable_flow_7d: [], // 需要付費數據源，保留結構供未來擴展
    };

    await saveData('signals', data);
  } catch (e) {
    console.error('[flow:signals]', e.message);
  }
}

// ── Flow 3: 市場情緒指標（每 15 分鐘）──────────────────────────────────────
async function fetchSentiment() {
  try {
    // Fear & Greed Index（免費）
    const fgData = await fetchJson('https://api.alternative.me/fng/?limit=2');
    const fg     = fgData.data?.[0];
    const fgPrev = fgData.data?.[1];

    // BTC 資金費率 via Binance（免費）
    const fundingData = await fetchJson(
      'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'
    );
    const fundingRate = fundingData?.lastFundingRate
      ? +(Number(fundingData.lastFundingRate) * 100).toFixed(4)
      : null;

    // BTC 期貨溢價（現貨 vs 期貨）
    let btcSpot = null, btcFutures = null, btcPremium = null;
    try {
      const spotData    = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const futuresData = await fetchJson('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT');
      btcSpot    = Number(spotData.price);
      btcFutures = Number(futuresData.price);
      btcPremium = btcSpot ? +((btcFutures - btcSpot) / btcSpot * 100).toFixed(3) : null;
    } catch {}

    // ETH/BTC 比值
    let ethBtcRatio = null;
    try {
      const ethBtc = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=ETHBTC');
      ethBtcRatio  = +Number(ethBtc.price).toFixed(5);
    } catch {}

    // 30 日 F&G 歷史
    let history30d = [];
    try {
      const histData = await fetchJson('https://api.alternative.me/fng/?limit=30');
      history30d = (histData.data || []).reverse().map(d => ({
        date: new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10),
        value: Number(d.value),
      }));
    } catch {}

    const data = {
      timestamp: new Date().toISOString(),
      fear_greed: {
        value:          fg ? Number(fg.value) : null,
        label:          fg?.value_classification || null,
        label_zh:       fgLabelZh(fg?.value_classification),
        previous_value: fgPrev ? Number(fgPrev.value) : null,
      },
      derivatives: {
        btc_futures_premium_pct:        btcPremium,
        btc_funding_rate_pct:           fundingRate,
        btc_funding_rate_8h_annualized_pct: fundingRate ? +(fundingRate * 3 * 365).toFixed(1) : null,
        eth_btc_ratio:                  ethBtcRatio,
        btc_open_interest_usd:          null, // 需付費數據
        btc_open_interest_7d_change_pct: null,
      },
      onchain: {
        whale_net_flow_usd:              null, // 需付費數據
        exchange_btc_reserve_change_pct: null,
        nvt_ratio:                       null,
        mvrv_z_score:                    null,
        stablecoin_supply_ratio_pct:     null,
      },
      history_30d: history30d,
    };

    await saveData('sentiment', data);
  } catch (e) {
    console.error('[flow:sentiment]', e.message);
  }
}

function fgLabelZh(label) {
  return { 'Extreme Fear': '極度恐懼', Fear: '恐懼', Neutral: '中性', Greed: '貪婪', 'Extreme Greed': '極度貪婪' }[label] || label;
}

// ── 排程（替代 OpenClaw cron）────────────────────────────────────────────────
function startScheduler() {
  // 立即執行一次
  fetchPortfolioData();
  fetchOnchainSignals();
  fetchSentiment();

  // 按排程重複執行
  setInterval(fetchPortfolioData,  5  * 60 * 1000); // 每 5 分鐘
  setInterval(fetchOnchainSignals, 2  * 60 * 1000); // 每 2 分鐘
  setInterval(fetchSentiment,      15 * 60 * 1000); // 每 15 分鐘

  console.log('[scheduler] started — portfolio:5m  signals:2m  sentiment:15m');
}

// ════════════════════════════════════════════════════════════════
//  Express API
// ════════════════════════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', (_, res) => res.json({
  ok: true,
  ts: new Date().toISOString(),
  scheduler: 'running',
  telegram: !!(TG_TOKEN && TG_CHAT_ID),
  etherscan: !!ETHERSCAN_KEY,
  coingecko: !!COINGECKO_KEY,
}));

app.get('/api/all', async (_, res) => {
  const [portfolio, signals, sentiment] = await Promise.all([
    readData('portfolio.json'),
    readData('signals.json'),
    readData('sentiment.json'),
  ]);
  res.json({ portfolio, signals, sentiment, ts: new Date().toISOString() });
});

app.get('/api/portfolio', async (_, res) => {
  const d = await readData('portfolio.json');
  d ? res.json(d) : res.status(404).json({ error: '數據抓取中，請稍候（約 5 分鐘）' });
});
app.get('/api/signals',   async (_, res) => {
  const d = await readData('signals.json');
  d ? res.json(d) : res.status(404).json({ error: '數據抓取中' });
});
app.get('/api/sentiment', async (_, res) => {
  const d = await readData('sentiment.json');
  d ? res.json(d) : res.status(404).json({ error: '數據抓取中' });
});

// ── Claude API 代理 + Telegram 推送 ──────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { page = 'analysis', systemPrompt, userPrompt, maxTokens = 800 } = req.body;
  if (!userPrompt) return res.status(400).json({ error: 'userPrompt required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  let full = '';
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        stream: true,
        system: systemPrompt || '你是 Web3 資產管理分析師，用繁體中文回答，給出具體可操作的建議。',
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!upstream.ok) {
      const e = await upstream.json().catch(() => ({}));
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.error?.message || 'API error' })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'content_block_delta' && d.delta?.text) {
            full += d.delta.text;
            res.write(`data: ${JSON.stringify(d)}\n\n`);
          }
        } catch {}
      }
    }
    reader.releaseLock();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
    if (full) tgSend(fmtTg(page, full));
  }
});

// ── 靜態托管 index.html ───────────────────────────────────────────────────────
app.use(express.static(__dirname));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── 啟動 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] VaultMind listening on :${PORT}`);
  startScheduler();
  tgSend('🚀 *VaultMind* — Railway 服務已啟動，數據抓取排程已啟動');
});

process.on('SIGTERM', () => { console.log('[server] SIGTERM'); process.exit(0); });
