// js/tab-manager.js

const VALID_PAGES = new Set([
  'overview', 'portfolio', 'risk', 'strategy', 'onchain', 'sentiment'
]);

/**
 * 初始化側邊欄 Tab 導航。
 * @param {((pageId: string) => void) | null} onPageChange
 *   頁面切換後的回調（用於注入圖表初始化等副作用）。
 *   若不傳，則只負責 DOM active 狀態切換。
 */
export function initTabNavigation(onPageChange = null) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    console.warn('[tab-manager] 找不到 .sidebar 元素');
    return;
  }

  // Bug 4 fix：事件委派，父元素只綁一次，天然防重複
  sidebar.addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    const pageId = item.dataset.page;  // Warn 5 fix
    if (!pageId) return;
    showPage(pageId, onPageChange);
  });

  // Bug 3 fix：鍵盤支援 Enter / Space
  sidebar.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.nav-item');
    if (!item) return;
    const pageId = item.dataset.page;
    if (!pageId) return;
    e.preventDefault();
    showPage(pageId, onPageChange);
  });

  // Warn 8 fix：對首次載入的 active 頁面觸發一次回調
  const activeItem = document.querySelector('.nav-item.active');
  if (activeItem?.dataset.page) {
    onPageChange?.(activeItem.dataset.page);
  }
}

/**
 * 切換到指定頁面並更新導航高亮。
 * @param {string} id  - 頁面 id（不含 'page-' 前綴）
 * @param {((pageId: string) => void) | null} onPageChange
 */
export function showPage(id, onPageChange = null) {
  // Warn 6 fix：驗證 id 合法性
  if (!VALID_PAGES.has(id)) {
    console.error(`[tab-manager] showPage: 未知頁面 id "${id}"`);
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${id}`);
  if (page) {
    page.classList.add('active');
    // Bug 2 fix：querySelector 結果做 null 檢查
    const navItem = document.querySelector(`.nav-item[data-page="${id}"]`);
    if (navItem) navItem.classList.add('active');
  }

  // Bug 1 / Design 7 fix：不再呼叫圖表函數，改由注入的 callback 處理
  onPageChange?.(id);
}