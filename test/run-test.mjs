import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from './linkedom.bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'mock.html'), 'utf8');
const { window } = parseHTML(html);
const document = window.document;

class MemoryStorage {
  #data = new Map();
  get length() {
    return this.#data.size;
  }
  key(index) {
    return [...this.#data.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#data.has(String(key)) ? this.#data.get(String(key)) : null;
  }
  setItem(key, value) {
    this.#data.set(String(key), String(value));
  }
  removeItem(key) {
    this.#data.delete(String(key));
  }
  clear() {
    this.#data.clear();
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
Object.defineProperty(window, 'localStorage', { value: local, configurable: true });
Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true });

globalThis.window = window;
globalThis.document = document;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.MutationObserver = window.MutationObserver;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.location = { href: 'https://github.com/' };

let messageListener = null;
globalThis.chrome = {
  storage: {
    sync: {
      get(defaults, callback) {
        setTimeout(() => callback({ ...defaults, autoHide: true, autoClearStorage: true }), 0);
      },
    },
    local: {
      set(value) {
        globalThis.__report = value;
      },
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    onMessage: {
      addListener(fn) {
        messageListener = fn;
      },
    },
  },
};

local.setItem('recent-searches', JSON.stringify(['alpha', 'beta']));
local.setItem('search_history', 'alpha,beta');
local.setItem('searchHistory', '["alpha"]');
local.setItem('recentSearches', '["beta"]');
local.setItem('github-search-scope', 'repositories');
local.setItem('research-notes', 'keep');
local.setItem('recently-viewed', 'keep');
local.setItem('github-token', 'DO-NOT-REMOVE');
local.setItem('search-settings', '{"compact":true}');
local.setItem('theme', 'dark');
session.setItem('search-queries', '["alpha"]');
session.setItem('keep-me', 'ok');

const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
(0, eval)(code);

if (document.readyState === 'loading') {
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
}

await new Promise((resolve) => setTimeout(resolve, 700));

const has = (id) => document.getElementById(id).classList.contains('ghsc-hidden');
const before = {
  recentSectionHidden: has('recent-section'),
  recent2Hidden: has('recent-2'),
  recent3Hidden: has('recent-3'),
  recent4HeadingHidden: document.querySelector('#recent-4 h3').closest('li').classList.contains('ghsc-hidden'),
  recent4ItemsHidden: [...document.querySelectorAll('#recent-4 li')]
    .slice(1)
    .every((li) => li.classList.contains('ghsc-hidden')),
  after4Hidden: has('after-4'),
  repoSectionHidden: has('repo-section'),
  outsideHidden: has('outside'),
  localStorageKeys: [...Array(local.length)].map((_, i) => local.key(i)).sort(),
  sessionStorageKeys: [...Array(session.length)].map((_, i) => session.key(i)).sort(),
  marked: document.querySelectorAll('[data-ghsc-removed]').length,
  markedIds: [...document.querySelectorAll('[data-ghsc-removed]')].map(
    (element) => element.id || `${element.tagName}.${element.className}`
  ),
};

local.setItem('recent-searches', '["again"]');
local.setItem('search_history', 'again');
session.setItem('search-queries', '["again"]');

let response = null;
messageListener({ type: 'GHSC_CLEAR' }, null, (value) => {
  response = value;
});

await new Promise((resolve) => setTimeout(resolve, 50));

const after = {
  localStorageKeys: [...Array(local.length)].map((_, i) => local.key(i)).sort(),
  sessionStorageKeys: [...Array(session.length)].map((_, i) => session.key(i)).sort(),
};

const failures = [];
const check = (condition, label) => {
  if (!condition) failures.push(label);
};

check(before.recentSectionHidden, 'role=group 的 Recent searches 未被隐藏');
check(before.recent2Hidden, '“最近搜索”标题+相邻列表未被隐藏');
check(before.recent3Hidden, 'aria-label=Recent searches 未被隐藏');
check(before.recent4HeadingHidden, '<li> 结构中的 Recent searches 标题未被隐藏');
check(before.recent4ItemsHidden, '<li> 结构中的 Recent searches 条目未被隐藏');
check(!before.after4Hidden, '下一个分类 Users 被误隐藏');
check(!before.repoSectionHidden, 'Repositories 区域被误隐藏');
check(!before.outsideHidden, '搜索框外的文字被误隐藏');
check(!before.localStorageKeys.includes('recent-searches'), 'recent-searches 未被清除');
check(!before.localStorageKeys.includes('search_history'), 'search_history 未被清除');
check(!before.localStorageKeys.includes('searchHistory'), 'searchHistory 未被清除');
check(!before.localStorageKeys.includes('recentSearches'), 'recentSearches 未被清除');
check(before.localStorageKeys.includes('github-search-scope'), 'github-search-scope 被误删');
check(before.localStorageKeys.includes('research-notes'), 'research-notes 被误删');
check(before.localStorageKeys.includes('recently-viewed'), 'recently-viewed 被误删');
check(before.localStorageKeys.includes('github-token'), 'github-token 被误删');
check(before.localStorageKeys.includes('search-settings'), 'search-settings 被误删');
check(before.localStorageKeys.includes('theme'), 'theme 被误删');
check(!before.sessionStorageKeys.includes('search-queries'), 'session search-queries 未被清除');
check(before.sessionStorageKeys.includes('keep-me'), 'session keep-me 被误删');
check(response && response.ok, 'GHSC_CLEAR 没有返回 ok');
check(response && response.keys.length === 3, 'GHSC_CLEAR 报告的清理数量不正确');
check(!after.localStorageKeys.includes('recent-searches'), '二次清理未删除 recent-searches');
check(!after.sessionStorageKeys.includes('search-queries'), '二次清理未删除 search-queries');

console.log(JSON.stringify({ before, response, after, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
