// server.js — VaultMind Railway Service (情況 A: OpenClaw 作為 npm 包運行)
//
// 職責：
//   1. 啟動並監管 OpenClaw daemon（Railway 上持續運行，定時抓取鏈上數據）
//   2. 提供 REST API 給前端讀取 OpenClaw 輸出的 JSON 數據
//   3. 代理 Claude API 請求，流式回傳給瀏覽器，完成後推送 Telegram
//   4. 靜態托管 w3am.html

import express    from 'express';
import { spawn }  from 'child_process';
import { readFile } from 'fs/promises';
import path       from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR     = path.join(__dirname, 'data');
const OPENCLAW_WS  = path.join(__dirname, 'openclaw');
const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// ── 啟動驗證 ──────────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[boot] ANTHROPIC_API_KEY not set');
  process.exit(1);
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
        text: text.slice(0, 4000), // Telegram 單條訊息上限
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.warn('[tg] send failed:', e.message);
  }
}

// AI 完成後的 Telegram 摘要格式
function fmtTg(page, summary) {
  return (
    `🤖 *VaultMind · ${page}*\n\n` +
    summary
      .replace(/#{1,3} /g, '*')
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .slice(0, 3500)
  );
}

// ── 讀取 JSON 工具 ────────────────────────────────────────────────────────────
async function readData(filename) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, filename), 'utf8'));
  } catch {
    return null;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── 數據 API ──────────────────────────────────────────────────────────────────

// GET /health — 服務狀態 + OpenClaw 狀態
app.get('/health', (_, res) => res.json({
  ok: true,
  ts: new Date().toISOString(),
  openclaw: clawStatus,
  telegram: !!(TG_TOKEN && TG_CHAT_ID),
}));

// GET /api/all — 前端「即時數據」頁使用，一次拉取全部數據
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
  d ? res.json(d) : res.status(404).json({ error: 'OpenClaw 尚未生成數據，請等待首次 flow 執行（約 2-5 分鐘）' });
});

app.get('/api/signals', async (_, res) => {
  const d = await readData('signals.json');
  d ? res.json(d) : res.status(404).json({ error: 'No data yet' });
});

app.get('/api/sentiment', async (_, res) => {
  const d = await readData('sentiment.json');
  d ? res.json(d) : res.status(404).json({ error: 'No data yet' });
});

// ── Claude API 代理 + Telegram 推送 ──────────────────────────────────────────
// 前端在填了 Railway URL 的情況下，AI 請求走這裡
// server 流式回傳給瀏覽器，同時在完成後自動推送 Telegram
app.post('/api/chat', async (req, res) => {
  const { page = 'analysis', systemPrompt, userPrompt, maxTokens = 800 } = req.body;
  if (!userPrompt) return res.status(400).json({ error: 'userPrompt required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁止 Railway/nginx 的代理緩衝

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
      const { done, value } = await reader.read();
      if (done) break;
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
    // AI 完成後推送 Telegram（非同步，不阻塞回應）
    if (full) tgSend(fmtTg(page, full));
  }
});

// ── 靜態托管 w3am.html ────────────────────────────────────────────────────────
app.use(express.static(__dirname));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── OpenClaw Daemon ───────────────────────────────────────────────────────────
let clawProc    = null;
let clawStatus  = 'starting';
let clawRetries = 0;
const MAX_RETRIES = 5;

function startOpenClaw() {
  // openclaw 由 npm install 安裝，通過 npx 調用
  clawProc = spawn(
    'npx', ['openclaw', 'daemon', 'start', '--foreground', '--workspace', OPENCLAW_WS],
    { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  clawStatus = 'running';
  clawRetries = 0;
  console.log(`[openclaw] daemon started (pid ${clawProc.pid})`);

  clawProc.stdout.on('data', d => {
    const line = d.toString().trim();
    if (line) console.log('[openclaw]', line);
  });

  clawProc.stderr.on('data', d => console.error('[openclaw:err]', d.toString().trim()));

  clawProc.on('error', err => {
    clawStatus = 'error';
    console.error('[openclaw] spawn error:', err.message);
    // 若 npx openclaw 不存在，代表 npm install 沒有安裝到，日誌提示
    if (err.code === 'ENOENT') {
      console.error('[openclaw] 找不到 openclaw 指令，請確認 package.json 中已加入 "openclaw" 依賴');
    }
  });

  clawProc.on('exit', code => {
    clawStatus = 'stopped';
    console.warn(`[openclaw] exited (code ${code})`);
    if (clawRetries < MAX_RETRIES) {
      const delay = Math.min(5_000 * ++clawRetries, 30_000);
      console.log(`[openclaw] restart in ${delay / 1000}s (attempt ${clawRetries}/${MAX_RETRIES})`);
      setTimeout(startOpenClaw, delay);
    } else {
      clawStatus = 'failed';
      console.error('[openclaw] max retries reached');
      tgSend('⚠️ *VaultMind* — OpenClaw daemon 多次重啟失敗，請檢查 Railway 日誌');
    }
  });
}

// ── 啟動 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] VaultMind listening on :${PORT}`);
  startOpenClaw();
  tgSend('🚀 *VaultMind* — Railway 服務已啟動，OpenClaw 正在初始化…');
});

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received');
  clawProc?.kill('SIGTERM');
  process.exit(0);
});