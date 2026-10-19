# GitHub 搜索记录清理器

一个本地运行的 Chrome / Edge 浏览器扩展，用来处理 GitHub 搜索框里挥之不去的 **“Recent searches / 最近搜索”**。

GitHub 没有提供清除搜索历史的公开按钮，也没有公开的删除接口。这个扩展从三个层面处理：

1. **隐藏页面区域**：在搜索下拉框中自动隐藏“最近搜索”整块内容，包括 GitHub 重新渲染后的内容；
2. **清理本地记录**：删除 `localStorage` / `sessionStorage` 中名称与搜索历史相关的键；
3. **清理相关 Cookie**：只删除名称中包含 `search` / `recent` 的 GitHub Cookie，**不会**删除登录会话 Cookie，因此不会让你退出登录。

扩展不发送任何网络请求，不上传数据，也没有远程代码。

---

## 安装（Chrome / Edge）

1. 解压 `dist/github-search-cleaner-chrome.zip` 到一个固定文件夹（例如 `D:\Tools\gh-search-cleaner`）。
2. 打开扩展管理页：
   - Chrome：地址栏输入 `chrome://extensions`
   - Edge：地址栏输入 `edge://extensions`
3. 打开右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择解压后包含 `manifest.json` 的那一层文件夹。
5. 打开或刷新 <https://github.com>，点击工具栏中的扩展图标即可看到状态。

> 也可以直接加载本仓库的 `extension/` 文件夹，不需要解压 zip。

Firefox 用户可以使用 `dist/github-search-cleaner-firefox.zip`：在 `about:debugging#/runtime/this-firefox` 中选择“临时载入附加组件”，选中 zip 内的 `manifest.json`。Firefox 的 MV3 支持程度随版本变化，建议使用 Firefox 115 或更高版本。

---

## 使用

点击扩展图标：

- **立即清理**：清理当前 GitHub 标签页的本地存储、相关 Cookie，并隐藏已经出现的“最近搜索”区域。
- **自动隐藏“最近搜索”**：默认开启。打开 GitHub 搜索下拉框时，扩展会自动隐藏该区域。
- **自动清理本地记录**：默认开启。每次打开 GitHub 页面时，自动删除名称与搜索历史相关的本地存储键。

清理完成后，页面右下角会出现一条短暂提示，显示清理了多少条本地记录、多少个页面区域和多少个 Cookie。

---

## 它到底删除了什么？

### 1. 页面中的“最近搜索”

使用 `MutationObserver` 监听 GitHub 的搜索建议面板，匹配以下标题（不区分大小写）：

- `Recent searches` / `Recent searches (5)` / `最近搜索` / `最近的搜索`
- `最近搜尋` / `最近の検索` / `최근 검색`
- `Recherches récentes` / `Letzte Suchanfragen` / `Búsquedas recientes`
- `Pesquisas recentes` / `Ricerche recenti` / `Последние запросы`

找到标题后，向上寻找该区域的容器（`role="group"`、`li`、`section` 等），把整个区域隐藏，而不是只隐藏标题。为了避免误伤，扩展会跳过包含多个分类标题的整个搜索建议面板。

隐藏使用 CSS 类，不会破坏 GitHub 的 React 状态；GitHub 重新渲染时，扩展会再次隐藏。

### 2. 本地存储

删除 `localStorage` 和 `sessionStorage` 中满足以下条件的键：

- 键名包含 `search`，或包含 `recent` + `search` / `query` / `history` 的组合；
- 同时排除包含 `token`、`auth`、`csrf`、`login`、`password`、`secret`、`setting`、`preference`、`feature`、`flag`、`color`、`theme`、`scope` 等字样的键。

例如会删除：

```text
recent-searches
recentSearches
search_history
searchHistory
search-queries
```

会保留：

```text
github-search-scope
research-notes
recently-viewed
github-token
search-settings
theme
```

### 3. Cookie

只删除域为 `github.com` 且名称包含 `search` 或 `recent` 的 Cookie，并排除名称中包含 `session`、`auth`、`token`、`login`、`logged`、`user`、`_octo`、`device`、`consent`、`preference`、`color`、`theme` 的 Cookie。

因此 `_gh_sess`、`user_session`、`logged_in` 等登录相关 Cookie 不会被删除。

---

## 重要限制

GitHub 的“最近搜索”可能由多个来源共同提供，其中一部分可能保存在 GitHub 服务器端。**浏览器扩展无法直接删除服务器端的数据**。本扩展会：

- 隐藏页面中的“最近搜索”区域；
- 删除浏览器本地保存的副本；
- 删除名称可识别的搜索相关 Cookie。

如果清理后在其他浏览器、隐身窗口或重新登录后仍然出现同样的记录，说明服务器端还保存着副本。这种情况下，只能通过 GitHub 官方支持渠道请求删除，或更换账号。

另外：

- 扩展只匹配 `https://github.com/*`，不支持 GitHub Enterprise Server（如 `github.mycompany.com`）。
- GitHub 改版可能改变搜索下拉框的 DOM 结构。如果某次改版后不再生效，可以更新 `extension/content.js` 中的 `LABELS` 和选择器。
- 扩展不会修改 GitHub 的搜索行为，也不会拦截或读取你的搜索内容。

---

## 隐私与权限

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存两个开关和“上次清理”结果，仅保存在浏览器本地。 |
| `cookies` | 仅在点击“立即清理”时读取 `github.com` 的 Cookie 名称，删除名称匹配 `search` / `recent` 的项。 |
| `https://github.com/*` | 在 GitHub 页面注入内容脚本。 |

扩展没有 `webRequest`、没有网络请求、没有分析统计、没有远程脚本。所有逻辑都在本地执行。

---

## 文件结构

```text
gh-search-cleaner/
├─ extension/                 # 可直接“加载已解压的扩展程序”
│  ├─ manifest.json
│  ├─ content.js              # 页面内：隐藏区域 + 清理存储
│  ├─ popup.html
│  ├─ popup.css
│  ├─ popup.js                # 弹窗：设置 + 清理 Cookie + 状态
│  └─ icons/
├─ dist/
│  ├─ github-search-cleaner-chrome.zip
│  ├─ github-search-cleaner-firefox.zip
│  └─ SHA256SUMS.txt
├─ test/
│  ├─ mock.html               # 模拟 GitHub 搜索下拉框
│  ├─ linkedom.bundle.mjs     # 测试用 DOM 实现
│  ├─ run-test.mjs            # 隐藏/存储清理测试
│  ├─ popup-test.mjs          # 弹窗/Cookie 测试
│  └─ settings-test.mjs       # 开关联动测试
├─ _tools/
│  ├─ build.ps1               # 打包 Chrome / Firefox zip
│  ├─ check.mjs               # 静态检查清单引用的文件
│  └─ make_icons.py           # 重新生成图标
└─ README.md
```

---

## 开发与测试

测试使用 Node.js 和 [linkedom](https://github.com/WebReflection/linkedom) 在本地模拟 DOM，不需要启动浏览器：

```bash
node test/run-test.mjs
node test/popup-test.mjs
node test/settings-test.mjs
```

三个测试都应输出 `failures: []` 并以退出码 0 结束。

修改 `extension/` 后，重新打包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File _tools\build.ps1
```

脚本会生成 `dist/github-search-cleaner-chrome.zip` 和 `dist/github-search-cleaner-firefox.zip`，并写入 `SHA256SUMS.txt`。Firefox 包会在 Chrome 包的基础上增加 `browser_specific_settings.gecko.id`。

---

## 常见问题

**安装后下拉框里还有“最近搜索”？**
先刷新 GitHub 页面。扩展是在页面加载时注入的，安装/更新后已打开的旧标签页需要刷新一次。

**点击“立即清理”后提示“没有发现可清理的记录”？**
说明当前浏览器本地没有匹配的键或 Cookie。页面中的区域仍会被隐藏。如果记录在其他地方仍然出现，可能是服务器端保存的副本。

**会不会把我 GitHub 退出登录？**
不会。Cookie 清理明确排除了 `_gh_sess`、`user_session`、`logged_in` 等登录 Cookie。

**为什么需要读取 Cookie 的权限？**
只是为了找出名称中含 `search` / `recent` 的搜索历史 Cookie；扩展不会读取或上传 Cookie 的值。

**支持 Firefox 吗？**
提供了 `github-search-cleaner-firefox.zip`。Firefox 的 MV3 实现与 Chrome 有差异，建议在 Firefox 115+ 中临时载入测试；如果遇到问题，可以只使用 Chrome/Edge 版本。

---

## 免责声明

这是一个非官方工具，与 GitHub 无关。GitHub 的界面和存储方式可能随时变化，扩展不保证在所有版本、所有账号状态下都能删除服务器端记录。使用前请自行评估风险。
