import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const tokenFile = getArg('token-file');
const repoName = getArg('repo', 'github-search-cleaner');
const visibility = getArg('visibility', 'private');
const root = path.resolve(getArg('root', path.dirname(path.dirname(fileURLToPath(import.meta.url)))));
const skipRelease = args.includes('--skip-release');

if (!tokenFile) {
  console.error('Missing --token-file');
  process.exit(2);
}

const token = fs.readFileSync(tokenFile, 'utf8').trim();
if (!/^gh[pousr]_[A-Za-z0-9_]{20,}$/.test(token)) {
  console.error('Token file does not look like a GitHub token');
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ghsc-publisher',
};

async function api(route, options = {}) {
  const response = await fetch(`https://api.github.com${route}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300);
    const error = new Error(`${options.method || 'GET'} ${route} -> ${response.status}: ${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'build', '.github']);
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function collectFiles(directory, base = directory) {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'profile' && path.basename(directory) === 'test') continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      entries.push(...collectFiles(path.join(directory, entry.name), base));
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name)) continue;
      entries.push({
        absolute: path.join(directory, entry.name),
        relative: path.relative(base, path.join(directory, entry.name)).split(path.sep).join('/'),
      });
    }
  }
  return entries;
}

const files = collectFiles(root);
files.push({
  absolute: null,
  relative: '.gitignore',
  content: Buffer.from('build/\ntest/profile/\ndist/*/\n*.log\n', 'utf8'),
});

console.log(JSON.stringify({ step: 'files', count: files.length, root }, null, 2));

const user = await api('/user');
console.log(JSON.stringify({ step: 'auth', login: user.login }, null, 2));

const repoDescription = 'GitHub 搜索记录清理器 — 隐藏并清理 GitHub 搜索框中的“最近搜索”';
let repo;
try {
  repo = await api(`/repos/${user.login}/${repoName}`);
  console.log(JSON.stringify({ step: 'repo-exists', url: repo.html_url, size: repo.size }, null, 2));
  if (repo.owner.login !== user.login) throw new Error('Repository belongs to a different owner');
  if (!String(repo.description || '').startsWith('GitHub 搜索记录清理器')) {
    throw new Error(`同名仓库 ${repo.html_url} 已存在且不是本工具创建的，已停止，避免覆盖。`);
  }
} catch (error) {
  if (error.status !== 404) throw error;
  repo = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: repoName,
      description: repoDescription,
      private: visibility !== 'public',
      auto_init: true,
      has_issues: true,
      has_wiki: false,
    }),
  });
  console.log(JSON.stringify({ step: 'repo-created', url: repo.html_url, private: repo.private }, null, 2));
}

const owner = repo.owner.login;
const branch = repo.default_branch || 'main';

let parentSha = null;
for (let attempt = 0; attempt < 8; attempt += 1) {
  try {
    const ref = await api(`/repos/${owner}/${repoName}/git/ref/heads/${branch}`);
    parentSha = ref.object.sha;
    break;
  } catch (error) {
    if (error.status !== 404 && error.status !== 409) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
console.log(JSON.stringify({ step: 'base', branch, parentSha }, null, 2));

const blobs = [];
for (const file of files) {
  const buffer = file.absolute ? fs.readFileSync(file.absolute) : file.content;
  const blob = await api(`/repos/${owner}/${repoName}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buffer.toString('base64'), encoding: 'base64' }),
  });
  blobs.push({ path: file.relative, mode: '100644', type: 'blob', sha: blob.sha });
}
console.log(JSON.stringify({ step: 'blobs', count: blobs.length }, null, 2));

const tree = await api(`/repos/${owner}/${repoName}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ tree: blobs }),
});

const commitBody = {
  message: 'chore: sync GitHub 搜索记录清理器 v1.0.0',
  tree: tree.sha,
};
if (parentSha) commitBody.parents = [parentSha];

const commit = await api(`/repos/${owner}/${repoName}/git/commits`, {
  method: 'POST',
  body: JSON.stringify(commitBody),
});

if (parentSha) {
  await api(`/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
} else {
  await api(`/repos/${owner}/${repoName}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });
}
console.log(JSON.stringify({ step: 'commit', sha: commit.sha, url: `${repo.html_url}/commit/${commit.sha}` }, null, 2));

let release = null;
const assets = [];
if (!skipRelease) {
  try {
    release = await api(`/repos/${owner}/${repoName}/releases/tags/v1.0.0`);
  } catch (error) {
    if (error.status !== 404) throw error;
    release = await api(`/repos/${owner}/${repoName}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: 'v1.0.0',
        target_commitish: branch,
        name: 'v1.0.0',
        body: '首个版本：支持 Chrome / Edge / Firefox，自动隐藏“最近搜索”，清理本地记录和相关 Cookie。',
        draft: false,
        prerelease: false,
      }),
    });
  }

  for (const name of ['github-search-cleaner-chrome.zip', 'github-search-cleaner-firefox.zip']) {
    const assetPath = path.join(root, 'dist', name);
    if (!fs.existsSync(assetPath)) continue;
    const body = fs.readFileSync(assetPath);
    try {
      const asset = await fetch(
        `https://uploads.github.com/repos/${owner}/${repoName}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/zip',
          },
          body,
        }
      );
      const text = await asset.text();
      if (!asset.ok) throw new Error(`${asset.status}: ${text.slice(0, 200)}`);
      assets.push({ name, url: JSON.parse(text).browser_download_url });
    } catch (error) {
      assets.push({ name, error: error.message });
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  login: user.login,
  repo: repo.html_url,
  branch,
  commit: commit.sha,
  release: release ? release.html_url : null,
  assets,
}, null, 2));
