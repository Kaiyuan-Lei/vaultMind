# VaultMind · Web3 Portfolio Intelligence

---

## 各服務職責

|服務|在哪裡運行|做什麼|
|---|---|---|
|**OpenClaw daemon**|Railway（npm 自動安裝）|定時抓取鏈上數據、幣價、情緒指標，輸出 JSON|
|**server.js**|Railway|啟動 OpenClaw、提供數據 API、代理 Claude、推送 Telegram|
|**w3am.html**|瀏覽器|持倉輸入、圖表、AI 問答介面|
|**Anthropic Claude**|Anthropic 雲端|AI 推理（由 Railway `/api/chat` 代理）|
|**Telegram**|Telegram 雲端|接收 AI 分析完成後的摘要|

**筆記本不需要保持開機。** 所有服務（包括 OpenClaw daemon）都運行在 Railway 上。

---

## 架構

```
┌──────────────────────────────────────────────────────┐
│                    Railway                            │
│                                                      │
│   OpenClaw daemon（npm install 自動安裝）              │
│   ├─ portfolio-data.yaml   每 5 分鐘                  │
│   ├─ onchain-alerts.yaml   每 2 分鐘   ──▶ data/*.json │
│   └─ sentiment-scan.yaml   每 15 分鐘                 │
│                                  │                   │
│   server.js                      │ 讀取              │
│   ├─ GET  /api/all      ◀─────────┘                  │
│   ├─ POST /api/chat     ──▶ Anthropic Claude          │
│   └─ GET  /             ──▶ w3am.html (靜態)          │
│                │                                     │
└────────────────│─────────────────────────────────────┘
                 │ HTTPS
     ┌───────────▼────────────┐
     │   瀏覽器 w3am.html      │
     │   即時數據頁  ◀ /api/all │
     │   AI 問答   ──▶ /api/chat│
     └───────────┬────────────┘
                 │ AI 完成後
     ┌───────────▼────────────┐
     │       Telegram          │
     └────────────────────────┘
```

---

## 部署步驟

### 1. 確認 OpenClaw 是 npm 包

```bash
npm info openclaw   # 應顯示版本號
```

### 2. 準備環境變量

```bash
cp .env.example .env
# 填入所有 Key（本地開發用，Railway 上另外設定）
```

### 3. 部署到 Railway

```bash
# 安裝 CLI
npm install -g @railway/cli

# 登入並建立項目
railway login
railway init        # 選 "Empty Project"，命名 vaultmind

# 推送代碼
railway up
```

### 4. 在 Railway Dashboard 設定環境變量

Railway Dashboard → 你的項目 → **Variables** → 逐一填入：

|Key|值|
|---|---|
|`ANTHROPIC_API_KEY`|`sk-ant-api03-...`|
|`ETHERSCAN_API_KEY`|你的 Etherscan Key|
|`COINGECKO_API_KEY`|你的 CoinGecko Key|
|`TELEGRAM_BOT_TOKEN`|你的 Bot Token（可選）|
|`TELEGRAM_CHAT_ID`|你的 Chat ID（可選）|

### 5. 開啟公開 URL

Railway Dashboard → Settings → **Networking** → Generate Domain

取得 URL，格式：`https://vaultmind-xxx.railway.app`

### 6. 連接前端

在 `w3am.html` 頂部 **Railway URL** 欄位填入 URL：

- 「即時數據」頁每 2 分鐘自動拉取 OpenClaw 最新數據
- AI 問答路由到 `/api/chat`，分析完成後自動推送 Telegram

---

## Telegram 設置

**取得 Bot Token：** Telegram 搜索 `@BotFather` → 發送 `/newbot` → 按指示建立 → 複製 Token

**取得 Chat ID：** Telegram 搜索 `@userinfobot` → 發送任意訊息 → 複製 `id` 字段

設定後，每次在「即時數據」頁點擊任何 AI 分析按鈕，分析完成後自動推送摘要到 Telegram。

---

## 本地開發

```bash
npm install
npm run dev       # node --watch server.js，改動自動重啟
# 訪問 http://localhost:3000/w3am.html
```

本地開發時 OpenClaw 也會啟動，請確保 `data/` 目錄存在（或先讓 OpenClaw 生成一次）。

---

## 目錄結構

```
vaultmind/
├── w3am.html              # 前端介面
├── server.js              # Railway 服務（Express + OpenClaw 監管）
├── package.json           # 依賴：express + openclaw
├── .env                   # 本地 Keys（不提交 Git）
├── .env.example           # Key 模板
│
├── openclaw/
│   ├── config.yaml        # OpenClaw 主配置
│   └── flows/
│       ├── portfolio-data.yaml
│       ├── onchain-alerts.yaml
│       └── sentiment-scan.yaml
│
└── data/                  # OpenClaw 輸出（不提交 Git）
    ├── portfolio.json
    ├── signals.json
    └── sentiment.json
```

---

## API 端點

|端點|方法|說明|
|---|---|---|
|`/health`|GET|服務狀態 + OpenClaw daemon 狀態|
|`/api/all`|GET|全部數據（portfolio + signals + sentiment）|
|`/api/portfolio`|GET|持倉數據|
|`/api/signals`|GET|鏈上警報 + 協議 TVL|
|`/api/sentiment`|GET|情緒指標|
|`/api/chat`|POST|代理 Claude API（流式），完成後推 Telegram|

---

## 前端頁面

|頁面|數據來源|核心功能|
|---|---|---|
|輸入持倉數據|手動輸入|持倉表格、績效指標、DeFi 策略|
|組合總覽|手動輸入|AUM / Sharpe / Max DD、配置條、NAV 圖|
|持倉分析|手動輸入|圓餅圖、PnL 柱、相關性熱力圖|
|風控分析|手動輸入|風險儀表盤、壓力測試情景|
|策略分析|手動輸入|DeFi 策略卡片、月度收益趨勢|
|**即時數據**|**Railway /api/all**|**OpenClaw 鏈上警報、情緒信號、TVL、Telegram 推送**|
|AI 問答|手動 + 即時數據|25 情境 Chips、自由輸入、多輪對話|

---

## 安全

- `.env` 已加入 `.gitignore`，不提交
- API Key 在前端以 `password` 欄位輸入，不存 localStorage
- `data/*.json` 排除版控（OpenClaw 動態生成）

---

_Built with [OpenClaw](https://openclaw.dev/) · [Anthropic Claude](https://anthropic.com/) · [Railway](https://railway.app/) · Chart.js_