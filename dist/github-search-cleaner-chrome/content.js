/* GitHub 搜索记录清理器 — content script
 * 运行在 github.com 页面中：
 *  1. 隐藏搜索下拉框里的 “Recent searches / 最近搜索” 区域；
 *  2. 清理 localStorage / sessionStorage 中与搜索历史相关的键；
 *  3. 响应弹窗的“立即清理”请求，并显示结果提示。
 * 不发送任何网络请求。
 */
(() => {
  'use strict';

  if (window.__GHSC_LOADED__) return;
  window.__GHSC_LOADED__ = true;

  const HIDE_CLASS = 'ghsc-hidden';
  const DEFAULTS = { autoHide: true, autoClearStorage: true };
  const VERSION = '1.0.0';

  // 搜索下拉框里“最近搜索”的标题（覆盖 GitHub 常见界面语言）。
  const LABELS = [
    /^recent searches?(?:\s*\(\d+\))?$/i,
    /^最近搜索(记录)?(?:\s*[（(]\d+[）)])?$/,
    /^最近的搜索$/,
    /^最近搜尋(紀錄)?$/,
    /^最近の検索$/,
    /^최근 검색$/,
    /^recherches récentes$/i,
    /^letzte suchanfragen$/i,
    /^búsquedas recientes$/i,
    /^pesquisas recentes$/i,
    /^recentes pesquisas$/i,
    /^ricerche recenti$/i,
    /^последние запросы$/i,
  ];

  // 需要清理的本地存储键：包含 search / recent 即可，但排除登录、偏好等敏感键。
  const EXCLUDE_KEY_RE =
    /(token|auth|csrf|login|password|secret|setting|preference|feature|flag|consent|enabled|disabled|color|theme|locale|timezone|scope)/i;

  // 避免把 research、recently-viewed 之类的键误判为搜索历史。
  const isSearchKey = (key) =>
    /(?:^|[-_.:])search(?:[-_.:]|$)/i.test(key) ||
    /search[A-Z]/.test(key) ||
    /recent[-_.:]?(?:search|quer|histor)/i.test(key);

  let settings = { ...DEFAULTS };
  let hiddenElements = 0;
  let hiddenSections = 0;
  let clearedKeys = [];
  let observer = null;
  let scanScheduled = false;
  let toastTimer = null;

  const normalize = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[：:]$/, '')
      .trim();

  const isRecentLabel = (value) => {
    const text = normalize(value);
    return text.length > 0 && text.length <= 40 && LABELS.some((re) => re.test(text));
  };

  function injectStyle() {
    if (document.getElementById('ghsc-style')) return;
    const style = document.createElement('style');
    style.id = 'ghsc-style';
    style.textContent = `
      .${HIDE_CLASS} { display: none !important; visibility: hidden !important; }
      [data-testid="recent-searches"],
      [data-testid*="recent-search"] { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function inSearchUI(element) {
    return !!element.closest(
      '[aria-label*="search" i], [role="listbox"], [role="combobox"], [data-testid*="search"], [class*="search-suggest"], [id*="search-suggest"], .js-site-search, .header-search, header'
    );
  }

  // 防止把整个搜索建议面板（包含多个分类）误判为“最近搜索”区域。
  function isPanelLike(element) {
    if (!element || element === document.body || element === document.documentElement) return true;
    if (element.querySelectorAll('a').length > 40) return true;
    return element.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').length >= 2;
  }

  function hide(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element === document.body || element === document.documentElement) return false;
    if (element.classList.contains(HIDE_CLASS)) return false;
    element.classList.add(HIDE_CLASS);
    element.setAttribute('data-ghsc-removed', '1');
    hiddenElements += 1;
    return true;
  }

  // 有些 GitHub 版本把标题与列表放在相邻的兄弟节点里。
  function hideFollowingList(element) {
    let sibling = element.nextElementSibling;
    let guard = 0;
    while (sibling && guard < 4) {
      guard += 1;
      const isContainer =
        /^(UL|OL|LI|DIV|SECTION)$/.test(sibling.tagName) ||
        sibling.getAttribute('role') === 'list' ||
        sibling.getAttribute('role') === 'group';
      const hasSearchLink = !!sibling.querySelector('a[href*="/search"], [role="option"]');
      if (!isContainer || !hasSearchLink) break;

      // 兄弟节点里出现标题，说明这是下一个分类，停止，避免误删。
      if (sibling.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')) break;

      const next = sibling.nextElementSibling;
      hide(sibling);
      sibling = next;
    }
  }

  function handleLabel(label) {
    if (!(label instanceof Element) || !label.isConnected) return;
    const labelText = (label.getAttribute && label.getAttribute('aria-label')) || label.textContent || '';
    if (!isRecentLabel(labelText)) return;
    if (!inSearchUI(label)) return;
    if (label.closest(`.${HIDE_CLASS}`)) return;

    const group = label.closest('[role="group"], li, section, [data-testid*="recent"]');
    const parent = label.parentElement;
    const searchLinks = 'a[href*="/search"], [role="option"]';
    let target = null;

    if (group && !isPanelLike(group)) {
      target = group;
    } else if (
      (label.hasAttribute('aria-label') || label.matches('[data-testid*="recent"]')) &&
      label.querySelector(searchLinks) &&
      !isPanelLike(label)
    ) {
      // 标题容器本身就是整个区域（例如 aria-label="Recent searches" 的 div）。
      target = label;
    } else if (parent) {
      const next = parent.nextElementSibling;
      const wrapper = parent.parentElement;
      if (
        next &&
        /^(UL|OL)$/.test(next.tagName) &&
        next.querySelector(searchLinks) &&
        wrapper &&
        !isPanelLike(wrapper)
      ) {
        // 结构为：<div class="section"><div><span>最近搜索</span></div><ul>…</ul></div>
        target = wrapper;
      } else if (!isPanelLike(parent) && normalize(parent.textContent).length <= 160) {
        target = parent;
      } else {
        target = label;
      }
    } else {
      target = label;
    }

    if (!target || isPanelLike(target)) return;
    if (hide(target)) {
      hiddenSections += 1;
      hideFollowingList(target);
    }
  }

  function scan() {
    if (!settings.autoHide) return;

    const roots = document.querySelectorAll(
      '[role="listbox"], [role="combobox"], [data-testid*="search"], [class*="search-suggest"], [id*="search-suggest"], .js-site-search, header'
    );
    const seen = new Set();

    for (const root of roots) {
      if (seen.has(root) || !root.isConnected) continue;
      seen.add(root);

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || node.nodeValue.length > 40) return NodeFilter.FILTER_REJECT;
          return isRecentLabel(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });

      const labels = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement) labels.push(node.parentElement);
      }
      for (const label of labels) handleLabel(label);

      // 有些版本用 aria-label 而不是可见文本标记该区域。
      root.querySelectorAll('[aria-label]').forEach((element) => {
        if (isRecentLabel(element.getAttribute('aria-label'))) handleLabel(element);
      });
    }
  }

  function scheduleScan() {
    if (scanScheduled || !settings.autoHide) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  function clearStorage() {
    const removed = [];

    for (const storeName of ['localStorage', 'sessionStorage']) {
      let store;
      try {
        store = window[storeName];
      } catch {
        continue;
      }
      if (!store) continue;

      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (!key || !isSearchKey(key) || EXCLUDE_KEY_RE.test(key)) continue;
        store.removeItem(key);
        removed.push(`${storeName}:${key}`);
      }
    }

    if (removed.length) {
      clearedKeys = [...new Set([...clearedKeys, ...removed])];
    }
    return removed;
  }

  function restore() {
    document.querySelectorAll(`.${HIDE_CLASS}`).forEach((element) => {
      element.classList.remove(HIDE_CLASS);
      element.removeAttribute('data-ghsc-removed');
    });
    hiddenElements = 0;
    hiddenSections = 0;
  }

  function saveReport(report) {
    try {
      chrome.storage.local.set({ lastReport: report });
    } catch {
      /* 扩展被重新加载时可能不可用，忽略。 */
    }
  }

  function showToast(report) {
    let host = document.getElementById('ghsc-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ghsc-toast-host';
      host.style.cssText =
        'position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none;';
      host.attachShadow({ mode: 'open' }).innerHTML = `
        <style>
          :host { all: initial; }
          .toast {
            min-width: 260px;
            max-width: 360px;
            box-sizing: border-box;
            padding: 12px 16px;
            border-radius: 10px;
            background: #1f2328;
            color: #fff;
            font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity .18s ease, transform .18s ease;
          }
          .toast.show { opacity: 1; transform: translateY(0); }
          .title { font-weight: 600; margin-bottom: 3px; }
          .desc { color: #c9d1d9; font-size: 12px; }
          @media (prefers-color-scheme: dark) {
            .toast { background: #f0f3f6; color: #1f2328; }
            .desc { color: #57606a; }
          }
        </style>
        <div class="toast" role="status" aria-live="polite">
          <div class="title"></div>
          <div class="desc"></div>
        </div>
      `;
      (document.body || document.documentElement).appendChild(host);
    }

    const toast = host.shadowRoot.querySelector('.toast');
    const detail = [];
    if (report.keys && report.keys.length) detail.push(`本地记录 ${report.keys.length} 项`);
    if (report.sections) detail.push(`页面区域 ${report.sections} 处`);

    host.shadowRoot.querySelector('.title').textContent = '已清理 GitHub 搜索记录';
    host.shadowRoot.querySelector('.desc').textContent = detail.length
      ? detail.join(' · ')
      : '未发现本地记录，已隐藏“最近搜索”区域';

    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function doClear() {
    const keys = clearStorage();
    scan();

    const report = {
      ts: Date.now(),
      keys,
      sections: hiddenSections,
      totalSections: hiddenSections,
      url: location.href,
    };

    saveReport(report);
    showToast(report);
    return report;
  }

  function applySettings(next) {
    const previous = settings;
    settings = { ...DEFAULTS, ...(next || {}) };

    if (!settings.autoHide) {
      restore();
    } else if (!previous.autoHide) {
      scheduleScan();
    }

    if (settings.autoClearStorage) {
      clearStorage();
    }
    if (settings.autoHide) {
      scheduleScan();
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'sync') return;
    const next = { ...settings };
    if (changes.autoHide) next.autoHide = !!changes.autoHide.newValue;
    if (changes.autoClearStorage) next.autoClearStorage = !!changes.autoClearStorage.newValue;
    applySettings(next);
  }

  function onMessage(message, _sender, sendResponse) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'GHSC_PING') {
      sendResponse({ ok: true, version: VERSION });
      return;
    }

    if (message.type === 'GHSC_STATUS') {
      sendResponse({
        ok: true,
        version: VERSION,
        sections: hiddenSections,
        keys: clearedKeys.slice(-30),
      });
      return;
    }

    if (message.type === 'GHSC_CLEAR') {
      sendResponse({ ok: true, ...doClear() });
    }
  }

  function init() {
    injectStyle();

    try {
      chrome.storage.sync.get(DEFAULTS, (stored) => {
        applySettings(stored || DEFAULTS);
      });
    } catch {
      applySettings(DEFAULTS);
    }

    try {
      chrome.storage.onChanged.addListener(onStorageChanged);
    } catch {
      /* 非扩展环境（测试页）忽略。 */
    }

    try {
      chrome.runtime.onMessage.addListener(onMessage);
    } catch {
      /* 非扩展环境（测试页）忽略。 */
    }

    observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('focusin', scheduleScan, true);
    document.addEventListener('click', scheduleScan, true);
    document.addEventListener(
      'keydown',
      (event) => {
        const key = event.key || '';
        if (key === '/' || key.toLowerCase() === 's') scheduleScan();
      },
      true
    );
    document.addEventListener('turbo:load', scheduleScan);
    document.addEventListener('pjax:end', scheduleScan);
    window.addEventListener('popstate', scheduleScan);

    // 页面是渐进渲染的，多补几次扫描。
    setTimeout(scheduleScan, 400);
    setTimeout(scheduleScan, 1200);
    setTimeout(() => {
      if (settings.autoClearStorage) clearStorage();
      scheduleScan();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
