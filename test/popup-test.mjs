import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from './linkedom.bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'extension', 'popup.html'), 'utf8');
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

Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true });
Object.defineProperty(window, 'sessionStorage', { value: new MemoryStorage(), configurable: true });

globalThis.window = window;
globalThis.document = document;
globalThis.Element = window.Element;
globalThis.Node = window.Node;

const removedCookies = [];
const messages = [];
const storedSettings = {};

globalThis.chrome = {
  runtime: { lastError: undefined },
  tabs: {
    query(_query, callback) {
      callback([{ id: 7, url: 'https://github.com/' }]);
    },
    sendMessage(_tabId, message, callback) {
      messages.push(message.type);
      if (message.type === 'GHSC_PING') callback({ ok: true });
      else if (message.type === 'GHSC_STATUS') callback({ ok: true, sections: 2, keys: ['localStorage:x'] });
      else if (message.type === 'GHSC_CLEAR') {
        callback({ ok: true, keys: ['localStorage:recent-searches'], sections: 2 });
      } else callback(null);
    },
  },
  storage: {
    sync: {
      get(defaults, callback) {
        callback({ ...defaults, autoHide: true, autoClearStorage: false });
      },
      set(value) {
        Object.assign(storedSettings, value);
      },
    },
    local: {
      get(_key, callback) {
        callback({ lastReport: { ts: Date.now() - 3600_000, keys: ['old'], sections: 1 } });
      },
      set() {},
    },
  },
  cookies: {
    getAll(_filter, callback) {
      callback([
        { name: 'recent_searches', domain: '.github.com', path: '/' },
        { name: '_gh_sess', domain: '.github.com', path: '/' },
        { name: 'preferred_color_mode', domain: '.github.com', path: '/' },
      ]);
    },
    remove(details, callback) {
      removedCookies.push(details.name);
      callback({ name: details.name });
    },
  },
};

const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'popup.js'), 'utf8');
(0, eval)(code);

await new Promise((resolve) => setTimeout(resolve, 80));

const failures = [];
const check = (condition, label) => {
  if (!condition) failures.push(label);
};

check(document.getElementById('autoHide').checked === true, 'autoHide 设置未载入');
check(document.getElementById('autoClearStorage').checked === false, 'autoClearStorage 设置未载入');
check(document.getElementById('statusTitle').textContent.includes('已在这个页面生效'), '未显示已连接状态');
check(document.getElementById('clearBtn').disabled === false, '清理按钮未启用');
check(document.getElementById('lastRun').textContent.includes('上次清理'), '未显示上次清理时间');

document.getElementById('clearBtn').dispatchEvent(new window.Event('click'));
await new Promise((resolve) => setTimeout(resolve, 120));

check(messages.includes('GHSC_CLEAR'), '未向页面发送清理消息');
check(removedCookies.length === 1 && removedCookies[0] === 'recent_searches', 'Cookie 清理范围不正确');
check(document.getElementById('statusTitle').textContent === '清理完成', '未显示清理完成');
check(document.getElementById('statusDesc').textContent.includes('本地记录 1 项'), '未显示本地记录数量');
check(document.getElementById('statusDesc').textContent.includes('页面区域 2 处'), '未显示页面区域数量');
check(document.getElementById('statusDesc').textContent.includes('Cookie 1 个'), '未显示 Cookie 数量');
check(document.getElementById('hint').textContent.includes('recent_searches'), '未提示清除的 Cookie 名称');

console.log(JSON.stringify({ messages, removedCookies, status: document.getElementById('statusTitle').textContent, desc: document.getElementById('statusDesc').textContent, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
