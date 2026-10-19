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

let onChanged = null;
globalThis.chrome = {
  storage: {
    sync: {
      get(defaults, callback) {
        setTimeout(() => callback({ ...defaults, autoHide: false, autoClearStorage: false }), 0);
      },
    },
    local: { set() {} },
    onChanged: {
      addListener(fn) {
        onChanged = fn;
      },
    },
  },
  runtime: { onMessage: { addListener() {} } },
};

local.setItem('recent-searches', '["alpha"]');
local.setItem('github-token', 'keep');

const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
(0, eval)(code);
await new Promise((resolve) => setTimeout(resolve, 500));

const failures = [];
const check = (condition, label) => {
  if (!condition) failures.push(label);
};
const hidden = (id) => document.getElementById(id).classList.contains('ghsc-hidden');

check(!hidden('recent-section'), 'autoHide=false 时仍然隐藏了区域');
check(local.getItem('recent-searches') !== null, 'autoClearStorage=false 时仍然清理了存储');

onChanged({ autoHide: { newValue: true }, autoClearStorage: { newValue: true } }, 'sync');
await new Promise((resolve) => setTimeout(resolve, 400));

check(hidden('recent-section'), '打开 autoHide 后没有隐藏区域');
check(local.getItem('recent-searches') === null, '打开 autoClearStorage 后没有清理存储');
check(local.getItem('github-token') === 'keep', '误删了 github-token');

onChanged({ autoHide: { newValue: false }, autoClearStorage: { newValue: false } }, 'sync');
await new Promise((resolve) => setTimeout(resolve, 100));

check(!hidden('recent-section'), '关闭 autoHide 后没有恢复区域');

console.log(JSON.stringify({ failures }, null, 2));
process.exit(failures.length ? 1 : 0);
