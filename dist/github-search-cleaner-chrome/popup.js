'use strict';

const DEFAULTS = { autoHide: true, autoClearStorage: true };
const COOKIE_ALLOW_RE = /(search|recent)/i;
const COOKIE_DENY_RE =
  /(session|auth|token|csrf|login|logged|user|_octo|device|consent|preference|color|theme|tz)/i;

const $ = (id) => document.getElementById(id);
let activeTabId = null;
let clearBusy = false;

function setStatus(kind, title, description) {
  const dot = $('statusDot');
  dot.className = 'status-dot' + (kind ? ` ${kind}` : '');
  $('statusTitle').textContent = title;
  $('statusDesc').textContent = description;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay) return time;
  return `${date.getMonth() + 1}-${date.getDate()} ${time}`;
}

function sendToTab(message, callback) {
  if (activeTabId == null) {
    callback(null);
    return;
  }
  try {
    chrome.tabs.sendMessage(activeTabId, message, (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      callback(response || null);
    });
  } catch {
    callback(null);
  }
}

function renderReport(report) {
  if (!report || !report.ts) return;
  let text = `上次清理：${formatTime(report.ts)}`;
  const details = [];
  if (report.keys && report.keys.length) details.push(`本地 ${report.keys.length} 项`);
  if (report.sections) details.push(`页面 ${report.sections} 处`);
  if (details.length) text += `（${details.join('，')}）`;
  $('lastRun').textContent = text;
}

function loadLastReport() {
  chrome.storage.local.get('lastReport', (stored) => {
    renderReport(stored && stored.lastReport);
  });
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    const settings = { ...DEFAULTS, ...(stored || {}) };
    $('autoHide').checked = !!settings.autoHide;
    $('autoClearStorage').checked = !!settings.autoClearStorage;
  });
}

function saveSettings() {
  chrome.storage.sync.set({
    autoHide: $('autoHide').checked,
    autoClearStorage: $('autoClearStorage').checked,
  });
}

function renderConnected(status) {
  $('clearBtn').disabled = false;
  const sections = status && status.sections ? status.sections : 0;
  const keys = status && status.keys ? status.keys.length : 0;

  if (sections || keys) {
    const parts = [];
    if (sections) parts.push(`已隐藏 ${sections} 处`);
    if (keys) parts.push(`已清理本地记录 ${keys} 项`);
    setStatus('ok', '已在这个页面生效', parts.join(' · '));
  } else {
    setStatus('ok', '已在这个页面生效', '暂未发现记录；打开搜索下拉框时会自动隐藏');
  }
}

function pingTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) {
      setStatus('idle', '没有可用的标签页', '请打开 GitHub 页面后再试');
      return;
    }

    activeTabId = tab.id;
    sendToTab({ type: 'GHSC_PING' }, (pong) => {
      if (pong && pong.ok) {
        sendToTab({ type: 'GHSC_STATUS' }, (status) => renderConnected(status));
        return;
      }

      const url = tab.url || '';
      const isGitHub = /^https:\/\/([^/]+\.)?github\.com(\/|$)/i.test(url);
      $('clearBtn').disabled = true;

      if (isGitHub) {
        setStatus('warn', '需要刷新页面', '安装或更新扩展后，请刷新 GitHub 页面再试');
      } else {
        setStatus('idle', '请先打开 GitHub', '在 github.com 页面点击扩展图标即可清理');
      }
    });
  });
}

function clearSearchCookies() {
  return new Promise((resolve) => {
    if (!chrome.cookies || !chrome.cookies.getAll) {
      resolve([]);
      return;
    }

    chrome.cookies.getAll({ domain: 'github.com' }, (cookies) => {
      if (chrome.runtime.lastError || !Array.isArray(cookies)) {
        resolve([]);
        return;
      }

      const targets = cookies.filter(
        (cookie) => COOKIE_ALLOW_RE.test(cookie.name) && !COOKIE_DENY_RE.test(cookie.name)
      );
      if (!targets.length) {
        resolve([]);
        return;
      }

      const removed = [];
      let remaining = targets.length;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve([...new Set(removed)]);
      };

      for (const cookie of targets) {
        const host = String(cookie.domain || 'github.com').replace(/^\./, '');
        const url = `https://${host}${cookie.path || '/'}`;
        chrome.cookies.remove({ url, name: cookie.name }, (details) => {
          if (!chrome.runtime.lastError && details) removed.push(cookie.name);
          remaining -= 1;
          if (remaining === 0) finish();
        });
      }

      // 某些浏览器在回调里不返回结果时，避免弹窗一直卡在“清理中”。
      setTimeout(finish, 4000);
    });
  });
}

function handleClear() {
  if (clearBusy || activeTabId == null) return;
  clearBusy = true;

  const button = $('clearBtn');
  button.disabled = true;
  button.textContent = '清理中…';
  setStatus('busy', '正在清理…', '正在清除本地记录和相关 Cookie');

  clearSearchCookies().then((cookies) => {
    sendToTab({ type: 'GHSC_CLEAR' }, (response) => {
      clearBusy = false;
      button.disabled = false;
      button.textContent = '立即清理';

      if (!response || !response.ok) {
        setStatus('warn', '无法连接页面', '请刷新 GitHub 页面后重试');
        return;
      }

      const keys = response.keys ? response.keys.length : 0;
      const sections = response.sections ? response.sections : 0;
      const parts = [];
      if (keys) parts.push(`已清理本地记录 ${keys} 项`);
      if (sections) parts.push(`已隐藏页面区域 ${sections} 处`);
      if (cookies.length) parts.push(`已清理 Cookie ${cookies.length} 个`);
      if (!parts.length) parts.push('没有发现可清理的记录');

      setStatus('ok', '清理完成', parts.join(' · '));
      $('lastRun').textContent = '上次清理：刚刚';
      if (cookies.length) {
        $('hint').textContent = `已清除 Cookie：${cookies.join('、')}。不会退出登录。`;
      }
    });
  }).catch(() => {
    clearBusy = false;
    button.disabled = false;
    button.textContent = '立即清理';
    setStatus('warn', '清理失败', '请刷新 GitHub 页面后重试');
  });
}

$('autoHide').addEventListener('change', saveSettings);
$('autoClearStorage').addEventListener('change', saveSettings);
$('clearBtn').addEventListener('click', handleClear);

loadSettings();
loadLastReport();
pingTab();
