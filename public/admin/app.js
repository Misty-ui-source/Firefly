/* Alexander Console：原生 JS 单页，无构建步骤
 * 登录 GitHub OAuth(PKCE) → 浏览器直调 GitHub API 读写仓库 → 图片走 R2
 */
'use strict';
const CFG = window.ADMIN_CONFIG;
const GH_API = 'https://api.github.com';
const TOKEN_KEY = 'admin_github_token';
const USER_KEY = 'admin_github_user';

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const view = $('#view');
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.remove('hidden');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add('hidden'), 3200);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function b64encodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}
function b64decodeUnicode(b64) {
  return decodeURIComponent(Array.prototype.map.call(atob(b64), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}
const nowISO = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00+08:00`;
};

/* ---------- GitHub API ---------- */
function token() { return localStorage.getItem(TOKEN_KEY); }
async function gh(path, opts = {}) {
  const isGet = !opts.method || opts.method === 'GET';
  /* GitHub 的 GET 响应带 Cache-Control: private, max-age=60，浏览器会缓存；
   * 而写入用的 URL（无参数）与读取用的（带 ?ref=）不同，写操作不会让缓存失效——
   * 刚保存就读回会拿到旧内容（新建相册后立刻打开报「找不到相册」的元凶）。
   * 故 GET 一律绕缓存：cache:'no-store' + 时间戳参数双保险。 */
  const url = GH_API + path + (isGet ? (path.includes('?') ? '&' : '?') + '_t=' + Date.now() : '');
  const res = await fetch(url, {
    ...opts,
    cache: 'no-store',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error('登录已过期，请重新登录');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API 错误: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}
const repoPath = (p) => `/repos/${CFG.owner}/${CFG.repo}/contents/${p}?ref=${CFG.branch}`;
async function ghGetFile(path) {
  const data = await gh(repoPath(path));
  if (Array.isArray(data)) return data; // 目录
  return { ...data, text: b64decodeUnicode(data.content.replace(/\n/g, '')) };
}
async function ghPutFile(path, text, sha, message, isBase64) {
  return gh(`/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `更新 ${path} [管理台]`,
      content: isBase64 ? text : b64encodeUnicode(text),
      branch: CFG.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}
async function ghDelFile(path, sha, message) {
  return gh(`/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: message || `删除 ${path} [管理台]`, sha, branch: CFG.branch }),
  });
}

/* ---------- 控制台操作日志（总结报告的数据来源） ----------
 * 设计：
 * - 日志文件：src/data/console-oplog.json，JSON 数组，条目 {ts, type, action, target, detail}。
 * - 同 commit 原则：仓库类保存（配置/文章/友链等）走 saveWithLog，用 Git Data API
 *   把主文件 + 日志文件合成 1 个 commit，不多触发构建。
 * - R2 上传类操作本身不产生仓库 commit，硬绑日志会多一次构建，所以只记 pending
 *   队列，下次 saveWithLog 时一并带上；报告页读取时合并仓库日志 + pending，不丢数。
 * - 容错：Git Data API 失败时回落到原来的单文件 PUT，操作本身一定保存成功，
 *   日志条目留在 pending 里等下次同步，绝不因日志拖垮保存。
 * - 注意：saveWithLog 一次保存约 7 次 API 调用（ref/commit/blob/tree/commit/ref），
 *   是用户手动点保存的人类节奏，不是脚本批量调用；不要在循环里调它。
 */
const OPLOG_PATH = 'src/data/console-oplog.json';
const OPLOG_PENDING_KEY = 'admin_oplog_pending';
const OPLOG_MAX_ENTRIES = 2000;
function oplogLoadPending() {
  try { const v = JSON.parse(localStorage.getItem(OPLOG_PENDING_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function oplogSavePending(list) {
  try { localStorage.setItem(OPLOG_PENDING_KEY, JSON.stringify(list)); } catch (e) {}
}
/* 记一条操作：只写本地 pending，绝不抛错、绝不阻塞保存 */
function oplogRecord(type, action, target, detail) {
  const entry = { ts: new Date().toISOString(), type, action, target: target || '', detail: detail || '' };
  const pending = oplogLoadPending();
  pending.push(entry);
  oplogSavePending(pending);
  if (Array.isArray(window._oplogEntries)) window._oplogEntries.push(entry);
  return entry;
}
function oplogDedup(list) {
  const seen = new Set(), out = [];
  for (const e of list) {
    const k = [e.ts, e.type, e.action, e.target].join('|');
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  return out;
}
/* Git Data API：多文件合成 1 个 commit。files: [{path, content, encoding?} | {path, del: true}] */
async function ghCommitMulti(files, message) {
  const base = `/repos/${CFG.owner}/${CFG.repo}`;
  const ref = await gh(`${base}/git/ref/heads/${CFG.branch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh(`${base}/git/commits/${baseCommitSha}`);
  const treeEntries = [];
  const blobShas = {};
  for (const f of files) {
    if (f.del) {
      treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await gh(`${base}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: f.encoding || 'utf-8' }),
    });
    blobShas[f.path] = blob.sha;
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await gh(`${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
  });
  const commit = await gh(`${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] }),
  });
  /* 注意：GitHub 更新引用端点是复数 /git/refs/（读取单个引用才是单数 /git/ref/），
     写错会 404 Not Found——主题页保存报 Not Found、其余保存静默回落单文件 PUT、
     操作日志文件永远建不出来，都是这个坑（2026-10-26 修复） */
  await gh(`${base}/git/refs/heads/${CFG.branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });
  return { commitSha: commit.sha, blobShas };
}
async function oplogCurrentText() {
  if (typeof window._oplogText === 'string') return window._oplogText;
  try {
    const data = await ghGetFile(OPLOG_PATH);
    window._oplogText = data.text;
    try { window._oplogEntries = JSON.parse(data.text); } catch (e) { window._oplogEntries = []; }
    if (!Array.isArray(window._oplogEntries)) window._oplogEntries = [];
  } catch (e) {
    window._oplogText = '[]'; // 文件还不存在：从空日志开始，本次提交会创建它
    window._oplogEntries = [];
  }
  return window._oplogText;
}
/* ghPutFile 的直接替代：主文件 + 日志文件同 1 个 commit。返回 {content: {sha}} 保持调用方不变 */
async function saveWithLog(path, text, sha, message, op, opts = {}) {
  const entry = op ? { ts: new Date().toISOString(), type: op.type, action: op.action, target: op.target || '', detail: op.detail || '' } : null;
  try {
    const curText = await oplogCurrentText();
    let entries = [];
    try { entries = JSON.parse(curText); } catch (e) { entries = []; }
    if (!Array.isArray(entries)) entries = [];
    const merged = oplogDedup([...entries, ...oplogLoadPending(), ...(entry ? [entry] : [])]).slice(-OPLOG_MAX_ENTRIES);
    const oplogText = JSON.stringify(merged, null, 2) + '\n';
    const files = [{ path, content: text, encoding: opts.isBase64 ? 'base64' : 'utf-8' }];
    files.push({ path: OPLOG_PATH, content: oplogText, encoding: 'utf-8' });
    const r = await ghCommitMulti(files, message);
    window._oplogText = oplogText;
    window._oplogEntries = merged;
    oplogSavePending([]);
    return { content: { sha: r.blobShas[path] }, commitSha: r.commitSha };
  } catch (e) {
    /* 回落：主文件照常保存，日志条目留 pending 等下次同步 */
    console.warn('[saveWithLog] 多文件提交失败，回落单文件保存：', e && e.message);
    if (entry) {
      const pending = oplogLoadPending();
      const key = [entry.ts, entry.type, entry.action, entry.target].join('|');
      if (!pending.some((p) => [p.ts, p.type, p.action, p.target].join('|') === key)) pending.push(entry);
      oplogSavePending(pending);
    }
    /* 注意：这里不做「缺 sha 自动补 sha」——新建撞同名时补 sha 等于静默覆盖旧文件；
     * 撞名改名在编辑器保存层处理（自动加 (1)(2)…），这里只按调用方给的 sha 原样保存 */
    try {
      if (opts.isBase64) {
        return await gh(`/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, {
          method: 'PUT',
          body: JSON.stringify({ message, content: text, branch: CFG.branch, ...(sha ? { sha } : {}) }),
        });
      }
      return await ghPutFile(path, text, sha, message);
    } catch (e2) {
      throw new Error(`保存失败：多文件提交（${e.message}）；单文件回落（${e2.message}）`);
    }
  }
}
/* 单文件删除 + 日志同 commit（回落：先删文件，日志留 pending） */
async function delWithLog(path, sha, message, op) {
  const entry = op ? { ts: new Date().toISOString(), type: op.type, action: op.action, target: op.target || '', detail: op.detail || '' } : null;
  try {
    const curText = await oplogCurrentText();
    let entries = [];
    try { entries = JSON.parse(curText); } catch (e) { entries = []; }
    if (!Array.isArray(entries)) entries = [];
    const merged = oplogDedup([...entries, ...oplogLoadPending(), ...(entry ? [entry] : [])]).slice(-OPLOG_MAX_ENTRIES);
    await ghCommitMulti([{ path, del: true }, { path: OPLOG_PATH, content: JSON.stringify(merged, null, 2) + '\n', encoding: 'utf-8' }], message);
    window._oplogText = JSON.stringify(merged, null, 2) + '\n';
    window._oplogEntries = merged;
    oplogSavePending([]);
  } catch (e) {
    if (entry) oplogRecord(entry.type, entry.action, entry.target, entry.detail);
    await ghDelFile(path, sha, message);
  }
}

/* ---------- OAuth PKCE 登录 ---------- */
function randStr(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}
async function sha256base64url(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function startLogin() {
  const verifier = randStr(64), state = randStr(16);
  sessionStorage.setItem('oauth_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);
  const challenge = await sha256base64url(verifier);
  const url = 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
    client_id: CFG.githubClientId, scope: 'repo',
    redirect_uri: new URL('./', location.href).href,
    state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.href = url;
}
async function finishLogin() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), state = q.get('state');
  if (!code) return false;
  if (state !== sessionStorage.getItem('oauth_state')) { toast('state 校验失败', true); return false; }
  const verifier = sessionStorage.getItem('oauth_verifier');
  history.replaceState(null, '', location.pathname);
  const res = await fetch('/api/github-exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: window.ADMIN_CONFIG.githubClientId }),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error ? ': ' + j.error : ''; } catch (e) {}
    toast('换 token 失败: ' + res.status + detail, true); return false;
  }
  const { access_token } = await res.json();
  localStorage.setItem(TOKEN_KEY, access_token);
  const me = await gh('/user');
  localStorage.setItem(USER_KEY, me.login);
  return true;
}
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  location.reload();
}

/* ---------- Frontmatter ---------- */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  let curKey = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      curKey = kv[1];
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      fm[curKey] = v;
    } else {
      const li = line.match(/^\s*-\s*(.*)$/);
      if (li && curKey) {
        if (!Array.isArray(fm[curKey])) fm[curKey] = fm[curKey] ? [fm[curKey]] : [];
        fm[curKey].push(li[1].trim());
      }
    }
  }
  return { fm, body: m[2] };
}
function serializeFrontmatter(fm, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

/* ---------- 拖文件导入：纯逻辑（分类 / 标题提取，可独立测试） ---------- */
const DROP_TEXT_EXTS = ['md', 'markdown', 'txt'];
const DROP_IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'];
const DROP_TEXT_MAX = 2 * 1024 * 1024; // 文本文件上限 2MB
/* 把拖入的文件分成：文本（只取第一个）、图片（全部）、超限文本、不支持
 * 返回 { text, images, oversized, ignored }，元素都是原始 File 对象 */
function classifyDropFiles(files) {
  const out = { text: null, images: [], oversized: [], ignored: [] };
  for (const f of files || []) {
    const name = String(f.name || '');
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (DROP_TEXT_EXTS.includes(ext)) {
      if (f.size > DROP_TEXT_MAX) out.oversized.push(f);
      else if (!out.text) out.text = f;
      else out.ignored.push(f);
    } else if (DROP_IMG_EXTS.includes(ext) || String(f.type || '').startsWith('image/')) {
      out.images.push(f);
    } else {
      out.ignored.push(f);
    }
  }
  return out;
}
/* 无 frontmatter 时：取第一个一级标题或第一行作标题建议，其余作正文 */
function splitTitleFromBody(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { title: '', body: '' };
  const h = lines[i].match(/^#\s+(.+)$/);
  const title = (h ? h[1] : lines[i]).trim();
  const body = lines.slice(i + 1).join('\n').replace(/^\n+/, '');
  return { title, body };
}

/* YouTube / B站链接 → iframe 嵌入地址；识别不了返回 null */
function parseVideoUrl(u) {
  u = String(u || '').trim();
  let m = u.match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = u.match(/bilibili\.com\/video\/(BV[A-Za-z0-9]+)/);
  if (m) return `https://player.bilibili.com/player.html?bvid=${m[1]}`;
  return null;
}

/* ---------- 简易 Markdown 预览 ---------- */
function mdPreview(src) {
  let html = esc(src);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>').replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^(?!<[hu]|<li|<ul|<pre|<\/pre)(.+)$/gm, '<p>$1</p>').replace(/<p><\/p>/g, '');
  return html;
}

/* ---------- R2 上传 ----------
 * 图片统一在浏览器端处理后再上传：转 WebP（q0.8）+ 超尺寸等比缩放（长边 ≤2560）
 * + canvas 重编码自动剥掉 EXIF。GIF（动图）/ SVG / AVIF 跳过转换保原样；
 * 转换后反而更大（≥原图 98%）时也保留原图，别越压越肥。 */
function fileToWebp(file, quality = 0.8, maxDim = 2560) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (maxDim > 0 && Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('WebP 转换失败')); }, 'image/webp', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
async function uploadImages(files, dir, quality) {
  if (!dir) throw new Error('请先填写 R2 目录名');
  const fd = new FormData();
  fd.append('dir', dir);
  /* 原图直传开关（编辑器工具栏切换，全局生效）：开了就完全不压缩不转码 */
  let rawMode = false;
  try { rawMode = localStorage.getItem('admin-upload-raw') === '1'; } catch (e) {}
  let savedBytes = 0, origBytes = 0, converted = 0;
  for (const f of files) {
    let blob = f, name = f.name;
    const skipConvert = rawMode || !f.type.startsWith('image/') || f.type === 'image/gif' || f.type === 'image/svg+xml' || f.type === 'image/avif' || /\.webp$/i.test(f.name);
    if (!skipConvert) {
      try {
        const webp = quality ? await fileToWebp(f, quality) : await fileToWebp(f);
        if (webp.size < f.size * 0.98) {
          blob = webp;
          name = f.name.replace(/\.[^.]+$/, '') + '.webp';
          savedBytes += f.size - webp.size;
          converted++;
        }
      } catch (e) { /* 转换失败：原图照常上传 */ }
    }
    origBytes += f.size;
    fd.append('files', blob, name);
  }
  const res = await fetch('/api/r2-upload', {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `上传失败: ${res.status}`);
  }
  const out = await res.json(); // { urls: [...] }
  out.compressed = { converted, savedBytes, origBytes };
  return out;
}

/* 🎵 MP3 压缩：浏览器解码后用 lamejs（按需加载 ./lame.min.js）按目标码率重编码；标签会丢，但音乐表单在选文件时已把标签提取进表单，不受影响 */
let _lameLoading = null;
function ensureLame() {
  if (window.lamejs && window.lamejs.Mp3Encoder) return Promise.resolve();
  if (_lameLoading) return _lameLoading;
  _lameLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './lame.min.js';
    s.onload = () => (window.lamejs && window.lamejs.Mp3Encoder) ? resolve() : reject(new Error('lamejs 加载异常'));
    s.onerror = () => reject(new Error('lamejs 加载失败'));
    document.head.appendChild(s);
  });
  return _lameLoading;
}
async function compressMp3(file, kbps, onProgress) {
  await ensureLame();
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  const audio = await actx.decodeAudioData(buf);
  const channels = Math.min(2, audio.numberOfChannels);
  const enc = new window.lamejs.Mp3Encoder(channels, audio.sampleRate, kbps);
  const left = audio.getChannelData(0);
  const right = channels > 1 ? audio.getChannelData(1) : left;
  const to16 = (f32, off, len) => {
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) { const v = Math.max(-1, Math.min(1, f32[off + i])); out[i] = v < 0 ? v * 0x8000 : v * 0x7FFF; }
    return out;
  };
  const parts = [];
  const BLOCK = 1152 * 48;
  for (let off = 0; off < left.length; off += BLOCK) {
    const len = Math.min(BLOCK, left.length - off);
    for (let sub = 0; sub < len; sub += 1152) {
      const l = Math.min(1152, len - sub);
      const data = channels > 1 ? enc.encodeBuffer(to16(left, off + sub, l), to16(right, off + sub, l)) : enc.encodeBuffer(to16(left, off + sub, l));
      if (data.length) parts.push(new Int8Array(data));
    }
    if (onProgress) onProgress(Math.min(1, (off + BLOCK) / left.length));
    await new Promise((r) => setTimeout(r, 0));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Int8Array(tail));
  try { actx.close(); } catch (e) {}
  const blob = new Blob(parts, { type: 'audio/mpeg' });
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.mp3', { type: 'audio/mpeg' });
}

/* ---------- 路由与视图 ---------- */
const routes = {};
/* 控制台导航定义：key → 默认名称 */
function navDefs() {
  const defs = {
    dashboard: '🏠 首页', stats: '📊 写作', search: '🔍 搜索', medialib: '🗂 媒体库', tags: '🏷 标签', fonts: '🔤 字体',
    theme: '🎨 主题', images: '🖼 图片', music: '🎵 音乐', gallery: '📷 相册',
    announce: '📢 公告', friends: '🔗 友链', booknav: '🔖 书签', navmgr: '🧭 导航', videos: '🎬 视频', profile: '👤 简介', banner: '🖼️ 横幅',
    timeline: '🕘 时间线', thoughts: '💭 碎碎念', sitenav: '🌐 站点导航',
    blog: '🌐 博客', waline: '💬 评论', umami: '📈 数据统计',
  };
  for (const [k, c] of Object.entries(CFG.collections)) defs[k] = c.label;
  return defs;
}
function navLabel(key) {
  const custom = (CFG.navLayout && CFG.navLayout.labels) || {};
  return custom[key] || navDefs()[key] || key;
}
function navLayout() {
  const d = { primary: ['dashboard', 'stats', 'posts', 'dynamic', 'projects', 'spec'], secondary: ['images', 'music', 'gallery', 'announce', 'friends', 'booknav', 'navmgr', 'videos', 'profile', 'banner'] };
  const cfg = CFG.navLayout || {};
  const all = Object.keys(navDefs());
  const p = (cfg.primary || d.primary).filter((k) => all.includes(k));
  const s = (cfg.secondary || d.secondary).filter((k) => all.includes(k));
  // 漏掉的新增项自动补进次栏
  all.forEach((k) => { if (!p.includes(k) && !s.includes(k)) s.push(k); });
  return { primary: p, secondary: s };
}
function nav() {
  const n = $('#nav');
  n.innerHTML = '';
  n.classList.remove('hidden');
  const { primary, secondary } = navLayout();
  const cur = location.hash.replace('#/', '');
  const isActive = (key) => cur === key || (location.hash === '' && key === 'dashboard') || (key === 'gallery' && cur.startsWith('gallery-')) || (key === 'stats' && cur.startsWith('stats/'));
  const mkBtn = (key) => {
    const b = document.createElement('button');
    b.textContent = navLabel(key);
    /* 外部入口（博客/评论后台/数据统计）：新标签页打开，不切控制台路由 */
    const ext = CFG.navExternal && CFG.navExternal[key];
    if (ext) {
      b.title = '在新标签页打开';
      b.onclick = () => { n.classList.remove('open'); const dd = $('#nav-more'); if (dd) dd.classList.add('hidden'); window.open(ext, '_blank', 'noopener'); };
      return b;
    }
    if (isActive(key)) b.classList.add('active');
    b.onclick = () => { n.classList.remove('open'); const dd = $('#nav-more'); if (dd) dd.classList.add('hidden'); location.hash = '#/' + key; };
    return b;
  };
  primary.forEach((k) => n.appendChild(mkBtn(k)));
  /* 次要入口收进 ··· 菜单（桌面端下拉，移动端换行全显） */
  const moreWrap = document.createElement('span');
  moreWrap.className = 'nav-more-wrap';
  const moreBtn = document.createElement('button');
  moreBtn.textContent = '···';
  moreBtn.title = '更多';
  if (secondary.some((k) => isActive(k))) moreBtn.classList.add('active');
  const dd = document.createElement('div');
  dd.id = 'nav-more';
  dd.className = 'nav-more hidden';
  secondary.forEach((k) => dd.appendChild(mkBtn(k)));
  moreBtn.onclick = (e) => { e.stopPropagation(); dd.classList.toggle('hidden'); };
  document.addEventListener('click', () => dd.classList.add('hidden'), { once: false });
  moreWrap.appendChild(moreBtn);
  moreWrap.appendChild(dd);
  n.appendChild(moreWrap);
  /* 移动端：次要按钮直接换行展示 */
  const mNav = document.createElement('span');
  mNav.className = 'nav-more-inline';
  secondary.forEach((k) => mNav.appendChild(mkBtn(k)));
  n.appendChild(mNav);
  const mb = $('#btn-menu');
  if (mb && !mb._wired) { mb._wired = true; mb.onclick = () => n.classList.toggle('open'); }
}
function router() {
  const h = location.hash.replace('#/', '') || 'dashboard';
  const [page, ...rest] = h.split('/');
  const arg = rest.join('/');
  const wasLogin = document.body.classList.contains('is-login');
  if (page !== 'login' && window._loginTimer) { clearInterval(window._loginTimer); window._loginTimer = null; }
  document.body.classList.toggle('is-login', page === 'login');
  nav();
  /* 顶栏中间显示当前栏目名 */
  const pt = $('#page-title');
  if (pt) pt.textContent = page === 'login' ? '' : navLabel(page);
  applyInnerBg();
  const render = () => {
    if (routes[page]) routes[page](decodeURIComponent(arg || ''));
    else routes.dashboard();
    syncLvSegs();
    mountRail();
  };
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (page === 'login' || reduced) { render(); queueReportPopup(page); return; }
  if (wasLogin) { playCRT(); render(); queueReportPopup(page); return; } // 从登录页进入：CRT 开机动画
  /* 栏目切换：虫洞过渡（旧视图缩+模糊+淡出，新视图由大恢复） */
  const seq = ++router._seq;
  view.classList.add('view-out');
  setTimeout(() => {
    if (seq !== router._seq) return;
    view.classList.remove('view-out');
    render();
    view.classList.add('view-in');
    setTimeout(() => { if (seq === router._seq) view.classList.remove('view-in'); }, 240);
  }, 180);
  queueReportPopup(page);
}
/* 总结报告弹窗延后检查：等 CRT/虫洞动画跑完再弹，不抢动画；只在主页面（dashboard）触发 */
function queueReportPopup(page) {
  if (page !== 'dashboard' || !token()) return;
  setTimeout(() => { maybeShowReportPopup(); }, 900);
}
router._seq = 0;
/* CRT 开机动画：白横线从中间展开 → 纵向闪光 → 内容淡入，约 700ms */
function playCRT() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const o = document.createElement('div');
  o.className = 'crt-overlay';
  document.body.appendChild(o);
  requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add('go')));
  setTimeout(() => o.remove(), 780);
}
/* ---------- 日间 / 夜间主题 ---------- */
function syncThemeBtn() {
  const b = $('#btn-theme');
  if (b) b.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('admin-theme', next); } catch (e) {}
  syncThemeBtn();
}

/* ---------- 界面版本（经典 / 博客风）：同一套架构与功能，只换外观（皮肤走 style.css 的 [data-ui="blog"] 变量与覆盖） ---------- */
const UI_MODES = ['classic', 'blog', 'shirone', 'abyss'];
function uiMode() { const m = document.documentElement.dataset.ui; return UI_MODES.indexOf(m) >= 0 ? m : 'classic'; }
const UI_HUE_VAR = { classic: '--chue', blog: '--bhue', shirone: '--shue', abyss: '--ahue' };
const UI_HUE_DEFAULT = { classic: 0, blog: 174, shirone: 0, abyss: 199 };
const UI_MODE_NAME = { classic: '经典', blog: '博客风', shirone: 'Shirone', abyss: '深海' };
function uiHueOf(mode) {
  const v = parseInt(document.documentElement.style.getPropertyValue(UI_HUE_VAR[mode]), 10);
  return Number.isNaN(v) ? UI_HUE_DEFAULT[mode] : v;
}
const LAYOUTS = ['top', 'side', 'narrow', 'mix'];
function layoutMode() { const l = document.documentElement.dataset.layout; return LAYOUTS.indexOf(l) >= 0 ? l : 'top'; }
function setLayout(l) {
  document.documentElement.dataset.layout = LAYOUTS.indexOf(l) >= 0 ? l : 'top';
  try { localStorage.setItem('admin-layout', document.documentElement.dataset.layout); } catch (e) {}
  syncUiPanel();
}
/* ===== 列表样式（细条/博客卡片）：同一套列表 DOM，只换排版，作用于内容列表页 ===== */
let LIST_VIEW = (localStorage.getItem('admin-list-view') === 'cards') ? 'cards' : 'list';
function setListView(mode) {
  LIST_VIEW = (mode === 'cards') ? 'cards' : 'list';
  document.documentElement.dataset.listview = LIST_VIEW;
  try { localStorage.setItem('admin-list-view', LIST_VIEW); } catch (e) {}
  syncLvSegs();
}
function syncLvSegs() {
  document.querySelectorAll('[data-lv]').forEach((b) => b.classList.toggle('on', b.dataset.lv === LIST_VIEW));
  document.querySelectorAll('[data-lv-set]').forEach((b) => b.classList.toggle('on', b.dataset.lvSet === LIST_VIEW));
}
const LV_SEG = '<span class="seg" role="group" aria-label="列表样式"><button data-lv="list" type="button">☰ 列表</button><button data-lv="cards" type="button">▦ 卡片</button></span>';

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) {}
    ta.remove(); return ok;
  }
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  copyText(c.dataset.copy).then((ok) => toast(ok ? `已复制 ${c.dataset.copy}` : '复制失败，长按手动复制吧', !ok));
});
document.addEventListener('click', (e) => {
  const lvb = e.target.closest('[data-lv]');
  if (lvb) setListView(lvb.dataset.lv);
});

function syncUiPanel() {
  const mode = uiMode();
  const lay = layoutMode();
  document.querySelectorAll('[data-layout-set]').forEach((b) => b.classList.toggle('on', b.dataset.layoutSet === lay));
  document.querySelectorAll('[data-ui-set]').forEach((b) => b.classList.toggle('on', b.dataset.uiSet === mode));
  const slider = $('#ui-hue');
  if (slider) slider.value = String(uiHueOf(mode));
  const val = $('#ui-hue-val');
  if (val) val.textContent = UI_MODE_NAME[mode] + ' · ' + uiHueOf(mode) + '°';
  syncLvSegs();
}
function setUiMode(mode) {
  document.documentElement.dataset.ui = UI_MODES.indexOf(mode) >= 0 ? mode : 'classic';
  try { localStorage.setItem('admin-ui', document.documentElement.dataset.ui); } catch (e) {}
  syncUiPanel();
}
function setUiHue(h) {
  const mode = uiMode();
  const hue = Math.max(0, Math.min(360, Math.round(Number(h) || 0)));
  document.documentElement.style.setProperty(UI_HUE_VAR[mode], String(hue));
  if (mode === 'shirone') { /* Shirone 选彩色 = 给黑白加一点染色，饱和度固定 38% */
    document.documentElement.style.setProperty('--shue-s', '38%');
    try { localStorage.setItem('admin-ui-hue-shirone-s', '38%'); } catch (e) {}
  }
  try { localStorage.setItem('admin-ui-hue-' + mode, String(hue)); } catch (e) {}
  syncUiPanel();
}
function setUiMono() { /* Shirone 的「纯黑」位：饱和度归零，回到纯黑白 */
  if (uiMode() !== 'shirone') return;
  document.documentElement.style.setProperty('--shue-s', '0%');
  try { localStorage.setItem('admin-ui-hue-shirone-s', '0%'); } catch (e) {}
}
function toggleUiPanel(force) {
  const p = $('#ui-panel');
  if (!p) return;
  const show = typeof force === 'boolean' ? force : p.classList.contains('hidden');
  p.classList.toggle('hidden', !show);
  if (show) syncUiPanel();
}
/* ---------- 控制台内部背景：默认多张轮换（30s 淡入淡出） ---------- */
const INNER_BG_POOL = ['login-art.jpg', 'login-art-alt.jpg', 'login-art-sketch.png'];
const INNER_BG_CUSTOM = 'admin-inner-bg.jpg';
const BG_ROTATE_KEY = 'admin-inner-bg-rotate';
function bgRotateOn() {
  try { return localStorage.getItem(BG_ROTATE_KEY) !== '0'; } catch (e) { return true; }
}
const INNER_BG_CUSTOMS_KEY = 'admin-inner-bg-customs';
function innerBgPool() {
  const pool = INNER_BG_POOL.slice();
  if (BG_CUSTOM_EXISTS) pool.push(INNER_BG_CUSTOM);
  return pool.concat(bgCustomsList(INNER_BG_CUSTOMS_KEY, null));
}
/* 自定义背景图列表读取（本机 localStorage，JSON 数组 of R2 直链）；
 * 旧版单张时代 fixed 本身是直链时把它并入列表（只读迁移，不丢图） */
function bgCustomsList(listKey, fixedVal) {
  let list = [];
  try { const v = JSON.parse(localStorage.getItem(listKey) || '[]'); if (Array.isArray(v)) list = v.filter((u) => /^https?:\/\//.test(u)); } catch (e) {}
  if (fixedVal && /^https?:\/\//.test(fixedVal) && !list.includes(fixedVal)) list = [fixedVal, ...list];
  return list;
}
/* ---------- 手机端背景：登录页（外部）与内页（内部）各一套独立设置（键名前缀 login / inner） ----------
 * 仅 ≤743px 宽度生效（手机横竖屏）；平板/桌面完全不受影响，仍走上面的桌面图池。
 * 轮换开（默认）：三张内置竖图按桌面图池的方式 30s 淡入淡出轮换；关：固定选中的一张（默认粉红款）。
 * 选图存 localStorage：admin-inner-bg-mobile = 内置文件名 / 自定义图 R2 直链 / 'none'（清除→桌面图兜底）；
 * admin-inner-bg-mobile-rotate = 轮换开关；admin-inner-bg-mobile-fit = cover（铺满）/ contain（完整）。 */
const PHONE_BG_MQ = '(max-width: 743px)';
const MOBILE_BG_BUILTINS = ['bg-m-pink.webp', 'bg-m-2.webp', 'bg-m-3.webp'];
const MOBILE_BG_KEY = 'admin-inner-bg-mobile';
const MOBILE_BG_ROTATE_KEY = 'admin-inner-bg-mobile-rotate';
const MOBILE_BG_FIT_KEY = 'admin-inner-bg-mobile-fit';
function isPhoneWidth() {
  return !!(window.matchMedia && matchMedia(PHONE_BG_MQ).matches);
}
function mobileBgRotateOn() {
  try { return localStorage.getItem(MOBILE_BG_ROTATE_KEY) !== '0'; } catch (e) { return true; }
}
function mobileBgFixed() {
  try {
    const v = localStorage.getItem(MOBILE_BG_KEY);
    return v === null ? 'bg-m-pink.webp' : v;
  } catch (e) { return 'bg-m-pink.webp'; }
}
function mobileBgFit() {
  try { return localStorage.getItem(MOBILE_BG_FIT_KEY) === 'contain' ? 'contain' : 'cover'; } catch (e) { return 'cover'; }
}
/* 手机端当前生效的背景源：null = 已清除，用桌面图池兜底；
 * 轮换开 → 三张内置竖图；关 → 固定一张（内置文件名或自定义 R2 直链）。返回的是可直接用的引用（./文件 或完整 URL） */
function mobileBgSources() {
  const fixed = mobileBgFixed();
  if (fixed === 'none') return null;
  if (mobileBgRotateOn()) {
    const refs = MOBILE_BG_BUILTINS.map((f) => './' + f);
    return refs.concat(bgCustomsList(MOBILE_BG_KEY + '-customs', fixed));
  }
  return [/^https?:\/\//.test(fixed) ? fixed : './' + fixed];
}
/* 登录页手机图：独立的一套设置（admin-login-bg-mobile*），与内页互不影响；
 * 2026-10-24 起拆开，两边分别在图片页的「控制台背景」「控制台内部背景」卡里设置 */
const LOGIN_BG_KEY = 'admin-login-bg-mobile';
const LOGIN_BG_ROTATE_KEY = 'admin-login-bg-mobile-rotate';
const LOGIN_BG_FIT_KEY = 'admin-login-bg-mobile-fit';
function loginBgFixed() {
  try {
    const v = localStorage.getItem(LOGIN_BG_KEY);
    return v === null ? 'bg-m-pink.webp' : v;
  } catch (e) { return 'bg-m-pink.webp'; }
}
function loginBgRotateOn() {
  try { return localStorage.getItem(LOGIN_BG_ROTATE_KEY) !== '0'; } catch (e) { return true; }
}
function loginBgFit() {
  try { return localStorage.getItem(LOGIN_BG_FIT_KEY) === 'contain' ? 'contain' : 'cover'; } catch (e) { return 'cover'; }
}
/* 自定义背景是否存在：以后端仓库文件为准（跨设备有效，不依赖 localStorage） */
let BG_CUSTOM_EXISTS = false;
function checkCustomBgExists() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { BG_CUSTOM_EXISTS = true; applyInnerBg(true); resolve(true); };
    img.onerror = () => { BG_CUSTOM_EXISTS = false; resolve(false); };
    /* 直接拼 raw URL（repoRawUrl 在 media.js，init 时还未加载） */
    img.src = `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/public/admin/` + INNER_BG_CUSTOM;
  });
}
let _bgTimer = null, _bgKey = '';
function stopInnerBg() { if (_bgTimer) { clearInterval(_bgTimer); _bgTimer = null; } }
function applyInnerBg(force) {
  const a = document.getElementById('bg-a'), b = document.getElementById('bg-b');
  if (!a || !b) return;
  const isLogin = document.body.classList.contains('is-login');
  const on = bgRotateOn();
  const pool = innerBgPool();
  /* 手机宽度且总开关开着时用手机背景源；已清除（null）或非手机宽度仍走桌面图池 */
  const mSrc = (!isLogin && on && isPhoneWidth()) ? mobileBgSources() : null;
  const key = (isLogin ? 'L' : 'C') + (on ? 'R' : 'D') + '|' + pool.join(',')
    + (isLogin ? '' : (isPhoneWidth() ? '|P' + (mSrc ? mobileBgFit() + '|' + mSrc.join(',') : 'F') : '|W'));
  if (!force && key === _bgKey) return;
  _bgKey = key;
  stopInnerBg();
  const layers = [a, b];
  if (isLogin || !on) {
    layers[0].style.opacity = '0'; layers[1].style.opacity = '0';
    layers.forEach((l) => { l.style.backgroundSize = ''; l.style.backgroundPosition = ''; });
    document.body.classList.remove('has-bg');
    return;
  }
  document.body.classList.add('has-bg');
  let effPool = pool, refOf = (f) => (/^https?:\/\//.test(f) ? f : './' + f);
  if (mSrc) {
    /* 手机专用图：按显示方式（铺满/完整）呈现，位置居中；轮换机制与桌面图池共用下面的计时器 */
    effPool = mSrc; refOf = (f) => f;
    layers.forEach((l) => { l.style.backgroundSize = mobileBgFit(); l.style.backgroundPosition = 'center'; });
  } else {
    /* 桌面图池（含手机端清除后的兜底）：清掉手机行内样式，位置交给 CSS（≤743px 时有竖屏兜底规则） */
    layers.forEach((l) => { l.style.backgroundSize = ''; l.style.backgroundPosition = ''; });
  }
  const url = (f) => `url("${refOf(f)}")`;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let idx = 0, front = 0;
  layers[0].style.backgroundImage = url(effPool[0]);
  layers[0].style.opacity = '1'; layers[1].style.opacity = '0';
  if (effPool.length > 1) { const im = new Image(); im.src = refOf(effPool[1]); } // 预加载下一张
  if (effPool.length < 2 || reduced) return; // 单张或减弱动效：静止显示
  _bgTimer = setInterval(() => {
    idx = (idx + 1) % effPool.length;
    const back = 1 - front;
    layers[back].style.backgroundImage = url(effPool[idx]); // 已预加载，直接换不闪
    layers[back].style.opacity = '1';
    layers[front].style.opacity = '0';
    front = back;
    const nx = new Image(); nx.src = refOf(effPool[(idx + 1) % effPool.length]); // 预加载再下一张
  }, 30000);
}
/* 登录页背景：桌面/平板用 config.js 的 adminBg；手机宽度用登录页自己的手机背景设置（admin-login-bg-mobile*）
 * （轮换开 → 从三张内置竖图随机抽一张；关 → 固定选图；已清除或总开关关 → 桌面图 + CSS 竖屏位置兜底） */
function paintLoginStage() {
  const stage = document.querySelector('.login-stage');
  if (!stage) return;
  const bgFile = (CFG.adminBg || 'login-art.jpg').replace(/^\/+/, '');
  let src = /^https?:\/\//.test(bgFile) ? bgFile : './' + bgFile, size = '', pos = '';
  if (isPhoneWidth() && bgRotateOn() && loginBgFixed() !== 'none') {
    if (loginBgRotateOn()) {
      const pool = MOBILE_BG_BUILTINS.map((f) => './' + f).concat(bgCustomsList(LOGIN_BG_KEY + '-customs', loginBgFixed()));
      src = pool[Math.floor(Math.random() * pool.length)];
    }
    else { const f = loginBgFixed(); src = /^https?:\/\//.test(f) ? f : './' + f; }
    size = loginBgFit(); pos = 'center';
  }
  stage.style.backgroundImage = `url("${src}")`;
  stage.style.backgroundSize = size;
  stage.style.backgroundPosition = pos;
}
/* 窗口跨过手机断点（旋转/缩放）时重套背景：内页层 + 登录页舞台 */
if (window.matchMedia && !window._phoneMqWired) {
  window._phoneMqWired = true;
  const phoneMq = matchMedia(PHONE_BG_MQ);
  const onPhoneChange = () => { applyInnerBg(true); paintLoginStage(); };
  if (phoneMq.addEventListener) phoneMq.addEventListener('change', onPhoneChange);
  else if (phoneMq.addListener) phoneMq.addListener(onPhoneChange);
}

/* 登录页：装饰图原图完整鲜明呈现（不做淡化/半透明处理），hue 174 青绿品牌风 */
/* ---------- 农历 / 节气 / 节日（登录页时钟用） ---------- */
const LUNAR_INFO=[0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
0x06ca0,0x0b550,0x15355,0x04da0,0x0a5d0,0x14573,0x052d0,0x0a9a8,0x0e950,0x06aa0,
0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,
0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,
0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
0x05aa0,0x076a3,0x096d0,0x04bd7,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,
0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,
0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,
0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,
0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,0x0d520];
const M_CH=['正','二','三','四','五','六','七','八','九','十','冬','腊'];
const D_CH=['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
function leapMonth(y){return LUNAR_INFO[y-1900]&0xf;}
function leapDays(y){return leapMonth(y)?((LUNAR_INFO[y-1900]&0x10000)?30:29):0;}
function lunarYearDays(y){let s=348;for(let i=0x8000;i>0x8;i>>=1)s+=(LUNAR_INFO[y-1900]&i)?1:0;return s+leapDays(y);}
function monthDays(y,m){return (LUNAR_INFO[y-1900]&(0x10000>>m))?30:29;}
function solarToLunar(y,m,d){
  let off=Math.floor((Date.UTC(y,m-1,d)-Date.UTC(1900,0,31))/86400000);
  let year=1900,days=0;
  for(year=1900;year<2101&&off>0;year++){days=lunarYearDays(year);off-=days;}
  if(off<0){off+=days;year--;}
  const lp=leapMonth(year);let mon=1,isLeap=false;
  for(mon=1;mon<13&&off>0;mon++){
    if(lp>0&&mon===lp+1&&!isLeap){mon--;isLeap=true;days=leapDays(year);}
    else days=monthDays(year,mon);
    off-=days;
    if(isLeap&&mon===lp+1)isLeap=false;
  }
  if(off===0&&lp>0&&mon===lp+1){if(isLeap)isLeap=false;else{isLeap=true;mon--;}}
  if(off<0){off+=days;mon--;}
  return {month:mon,day:off+1,isLeap};
}
const TERM_INFO=[0,21208,42467,63836,85337,107014,128867,150921,173149,195551,218072,240693,263343,285989,308563,331033,353350,375494,397447,419210,440795,462224,483532,504758];
const TERM_NAMES=['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
function solarTerm(y,m,d){
  for(let k=0;k<2;k++){
    const n=(m-1)*2+k;
    const t=new Date(Date.UTC(1900,0,6,2,5)+(31556925974.7*(y-1900)+TERM_INFO[n]*60000));
    if(t.getUTCMonth()+1===m&&t.getUTCDate()===d)return TERM_NAMES[n];
  }
  return '';
}
const SOLAR_FEST={'1-1':'元旦','2-14':'情人节','3-8':'妇女节','5-1':'劳动节','6-1':'儿童节','9-10':'教师节','10-1':'国庆节','12-25':'圣诞节'};
const LUNAR_FEST={'1-1':'春节','1-15':'元宵节','5-5':'端午节','7-7':'七夕节','8-15':'中秋节','9-9':'重阳节','12-8':'腊八节'};
function lunarLine(y,mon,d){
  const l=solarToLunar(y,mon,d);
  const term=solarTerm(y,mon,d);
  const sf=SOLAR_FEST[mon+'-'+d]||'';
  let lf=(!l.isLeap)?(LUNAR_FEST[l.month+'-'+l.day]||''):'';
  if(!lf&&l.month===12&&!l.isLeap){
    const t=new Date(y,mon-1,d+1);
    const lt=solarToLunar(t.getFullYear(),t.getMonth()+1,t.getDate());
    if(lt.month===1&&lt.day===1)lf='除夕';
  }
  const fest=[sf,lf].filter(Boolean).join(' ');
  const parts=[];
  if(term)parts.push(term);
  parts.push('农历'+(l.isLeap?'闰':'')+M_CH[l.month-1]+'月'+D_CH[l.day-1]);
  if(fest)parts.push(fest);
  return parts.join(' · ');
}

routes.login = () => {
  document.body.classList.add('is-login');
  $('#nav').classList.add('hidden');
  view.innerHTML = `<div class="login-stage">
    <div class="login-layout">
      <div class="login-left">
        <div class="login-id">
          <img class="login-avatar" src="/avatar.png" alt="zhz" onerror="this.style.display='none'">
          <h1>Alexander <span class="brand">Console</span></h1>
        </div>
        <div class="glass-card login-desc-card"><span class="qmark">“</span><p class="hello-line">Hello!</p><p class="hello-sub">保持热爱，折腾不止。</p><span class="qmark qmark-r">”</span></div>
        <div class="contact-row">
          <a href="https://github.com/Misty-ui-source" target="_blank" rel="noopener" title="GitHub"><svg class="fill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
          <a href="mailto:xz011@qq.com" title="Email"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></a>
          <a href="https://lanerc.me/rss/" target="_blank" rel="noopener" title="RSS"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" fill="#fff" stroke="none"/></svg></a>
          <a href="https://t.me/zhzhk27" target="_blank" rel="noopener" title="Telegram"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg></a>
          <a href="https://discord.com/users/1550493367920627732" target="_blank" rel="noopener" title="Discord"><svg class="fill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg></a>
        </div>
      </div>
      <div class="login-right">
        <div class="login-top-row">
          <div class="glass-card quote-card">
            <div class="quote-text" id="quote-text"></div>
            <div class="quote-from" id="quote-from"></div>
          </div>
          <div class="glass-card clock-card">
            <div class="clock-date" id="clock-date">--</div>
            <div class="clock-time" id="clock-time">--:--:--</div>
            <div class="clock-lunar" id="clock-lunar"></div>
          </div>
        </div>
        <div class="login-label"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="2.5" class="lb-bar"/><rect x="3" y="14" width="18" height="6" rx="2.5" class="lb-bar"/><circle cx="7.5" cy="7" r="1.3" class="lb-dot"/><circle cx="7.5" cy="17" r="1.3" class="lb-dot"/></svg><span>网站列表</span></div>
        <div class="site-grid">
          <button class="glass-card site-card site-login" id="btn-login">
            <svg class="fill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            <span>登录</span>
          </button>
          <a class="glass-card site-card" href="https://lanerc.me/friends/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span>友链</span></a>
          <a class="glass-card site-card" href="https://lanerc.me/about/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>关于</span></a>
          <a class="glass-card site-card" href="https://lanerc.me/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg><span>博客</span></a>
          <a class="glass-card site-card" href="https://lanerc.me/dynamic/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg><span>动态</span></a>
          <a class="glass-card site-card" href="https://www.lanerc.me/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2" width="16" height="16" rx="3"/><path d="M4 10h16"/><path d="M9 14h.01M15 14h.01"/><path d="M8 18l-2 3M16 18l2 3"/></svg><span>开往</span></a>
        </div>
      </div>
    </div>
  </div>`;
  $('#btn-login').onclick = startLogin;
  // 氛围感：漂浮的音符粒子（孤独摇滚主题）
  const stage = view.querySelector('.login-stage');
  const notes = ['♪', '♫', '♩', '♬'];
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('span');
    s.className = 'note-particle';
    s.textContent = notes[i % notes.length];
    s.style.left = (Math.random() * 100) + '%';
    s.style.fontSize = (14 + Math.random() * 22) + 'px';
    s.style.animationDuration = (7 + Math.random() * 8) + 's';
    s.style.animationDelay = (-Math.random() * 12) + 's';
    stage.appendChild(s);
  }
  /* 控制台背景图：config.js 的 adminBg 可切换（图片管理 → 控制台背景）；手机宽度走手机背景设置（paintLoginStage 内判断） */
  paintLoginStage();
  /* 时钟 + 每日名言（nekro.top 式） */
  if (window._loginTimer) { clearInterval(window._loginTimer); window._loginTimer = null; }
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const tick = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const cd = $('#clock-date'), ct = $('#clock-time');
    if (!cd || !ct) return;
    cd.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week[d.getDay()]}`;
    ct.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const cl = $('#clock-lunar');
    if (cl) cl.textContent = lunarLine(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  tick();
  window._loginTimer = setInterval(tick, 1000);
  const quotes = [
    { text: 'Talk is cheap. Show me the code.', from: 'Linus Torvalds' },
    { text: '种一棵树最好的时间是十年前，其次是现在。', from: '谚语' },
    { text: '路漫漫其修远兮，吾将上下而求索。', from: '屈原《离骚》' },
    { text: 'Stay hungry, stay foolish.', from: 'Steve Jobs' },
    { text: '先让它跑起来，再让它跑得快。', from: '工程师信条' },
    { text: '简单是可靠的灵魂。', from: 'UNIX 哲学' },
    { text: '不要重复自己。', from: 'DRY 原则' },
    { text: '代码写出来是给人看的，顺便让机器执行。', from: '佚名' },
    { text: '山重水复疑无路，柳暗花明又一村。', from: '陆游' },
    { text: '纸上得来终觉浅，绝知此事要躬行。', from: '陆游' },
  ];
  const showQuote = (text, from) => {
    const qt = $('#quote-text'), qf = $('#quote-from');
    if (qt) qt.textContent = '\u201C' + text + '\u201D';
    if (qf) qf.textContent = '— ' + from;
  };
  const local = quotes[Math.floor(Math.random() * quotes.length)];
  showQuote(local.text, local.from);
  /* 一言接口优先，失败回落本地 */
  fetch('https://v1.hitokoto.cn/?c=a&c=b&c=c&c=d&c=e&c=f&c=g&c=h&c=i&c=j&c=k')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && d.hitokoto) showQuote(d.hitokoto, d.from_who || d.from || '一言'); })
    .catch(() => { /* 保持本地名言 */ });
};

/* 首页 */
/* 写作日期抓取（供 dashboard 统计卡与 stats 栏目复用） */
async function fetchPostDates() {
  const dates = [];
  try {
    const col = CFG.collections.posts;
    const list = await ghGetFile(col.path);
    const dirs = (Array.isArray(list) ? list : []).filter((x) => x.type === 'dir');
    const fill = async (e) => {
      try {
        const files = await ghGetFile(`${col.path}/${e.name}`);
        const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
        if (!md) return;
        const data = await ghGetFile(`${col.path}/${e.name}/${md.name}`);
        const { fm } = parseFrontmatter(data.text);
        const d = String(fm.published || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
      } catch (err) { /* 单篇失败跳过 */ }
    };
    for (let i = 0; i < dirs.length; i += 4) await Promise.all(dirs.slice(i, i + 4).map(fill));
  } catch (e) { /* 忽略 */ }
  return dates;
}
async function fetchDynDates() {
  try {
    const list = await ghGetFile(CFG.collections.dynamic.path);
    return (Array.isArray(list) ? list : [])
      .map((x) => x.name.slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch (e) { return []; }
}
/* 写作数据栏目：折线图 + 热力图 + 总结报告区块（报告已入写作页，旧 #/reports 路由重定向到这里） */
routes.stats = async (arg) => {
  view.innerHTML = '<div class="card"><h2>📊 写作数据</h2><p class="hint">正在读取仓库数据…</p></div>';
  const [postDates, dynDates] = await Promise.all([fetchPostDates(), fetchDynDates()]);
  if (!postDates.length && !dynDates.length) {
    view.innerHTML = '<div class="card"><h2>📊 写作数据</h2><p class="hint">没有读到写作数据。</p></div>';
  } else {
    view.innerHTML = '<div class="card"><h2>📊 写作数据</h2><p class="hint">文章与动态的发布统计，数据来自仓库实时读取。</p></div>';
    renderWriteCharts(postDates, dynDates);
  }
  /* 总结报告区块：与写作数据无关，始终渲染在页尾 */
  const wrap = document.createElement('div');
  wrap.id = 'report-section';
  view.appendChild(wrap);
  /* 深链形式 #/stats/report:<type>:<key>（弹窗「查看完整报告」与旧路由重定向共用） */
  let repType = 'month', repKey = '';
  if (arg && arg.startsWith('report')) {
    const parts = arg.split(':'); // report / type / key（含 '-'，不含 ':'）
    if (['month', 'quarter', 'annual'].includes(parts[1])) repType = parts[1];
    if (parts[2]) repKey = parts.slice(2).join(':');
  }
  await renderReportSection(wrap, repType, repKey);
  if (arg && arg.startsWith('report')) {
    const el = document.getElementById('report-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
/* 首页卡片小工具：数字滚动（尊重减动效偏好）+ 近 6 个月迷你柱 */
function countUp(el, to) {
  const n = Number(to);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!Number.isFinite(n) || n < 0 || reduce) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 650;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function sparkHtml(dates) {
  if (!dates || !dates.length) return '';
  const now = new Date();
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ label: p, n: dates.filter((x) => String(x || '').slice(0, 7) === p).length });
  }
  if (!buckets.some((b) => b.n > 0)) return '';
  const max = Math.max(...buckets.map((b) => b.n), 1);
  return buckets.map((b, i) =>
    `<span class="spark-bar${i === 5 ? ' cur' : ''}" style="height:${Math.max(12, Math.round(b.n / max * 100))}%" title="${b.label} · ${b.n} 条"></span>`).join('');
}
routes.dashboard = async () => {
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  const grid = document.createElement('div');
  grid.className = 'stat-grid';
  view.innerHTML = '<div class="card"><h2>👋 欢迎回来，<span id="d-user"></span></h2><p class="hint">选个集合开始干活。保存后会自动 commit 到 GitHub，构建发版走 Pages。</p></div>';
  $('#d-user').textContent = localStorage.getItem(USER_KEY) || '';
  view.appendChild(grid);
  const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
  const isDraft = (fm) => String(fm.draft).toLowerCase() === 'true';
  const isPinned = (fm) => String(fm.pinned).toLowerCase() === 'true';
  const inMonth = (d) => String(d || '').slice(0, 7) === monthPrefix;

  // 文章：读每篇 frontmatter 算草稿/置顶/本月新增
  const postStats = async (col) => {
    const rows = [];
    try {
      const list = await ghGetFile(col.path);
      const dirs = (Array.isArray(list) ? list : []).filter((x) => x.type === 'dir');
      const fill = async (e) => {
        try {
          const files = await ghGetFile(`${col.path}/${e.name}`);
          const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
          if (!md) return;
          const data = await ghGetFile(`${col.path}/${e.name}/${md.name}`);
          const { fm } = parseFrontmatter(data.text);
          rows.push(fm);
        } catch (err) { /* 单篇失败跳过 */ }
      };
      for (let i = 0; i < dirs.length; i += 4) await Promise.all(dirs.slice(i, i + 4).map(fill));
    } catch (e) { /* 忽略 */ }
    return {
      total: rows.length,
      dates: rows.map((fm) => fm.published).filter(Boolean),
      details: [
        ['📝', '草稿', rows.filter(isDraft).length],
        ['📌', '置顶', rows.filter(isPinned).length],
        ['🆕', '本月新增', rows.filter((fm) => inMonth(fm.published)).length],
      ],
    };
  };
  // 动态：文件名即日期 YYYY-MM-DD.md
  const dynStats = async (col) => {
    let files = [];
    try {
      const list = await ghGetFile(col.path);
      files = (Array.isArray(list) ? list : []).filter((x) => x.name.endsWith('.md'));
    } catch (e) { /* 忽略 */ }
    const dates = files.map((f) => f.name.slice(0, 10)).sort().reverse();
    return {
      total: files.length,
      dates,
      details: [
        ['🆕', '本月新增', dates.filter((d) => d.slice(0, 7) === monthPrefix).length],
        ['🕘', '最新', dates[0] || '—'],
      ],
    };
  };
  const simpleStats = async (col) => {
    let n = 0;
    try {
      const list = await ghGetFile(col.path);
      n = (Array.isArray(list) ? list : []).filter((x) => x.name.endsWith('.md') || x.type === 'dir').length;
    } catch (e) { /* 忽略 */ }
    return { total: n, details: [] };
  };

  /* 首页卡片在下方统一渲染（CARD_DEFS + homeCards 配置），这里只备统计函数 */

  // 快捷入口卡：友链 / 相册 / 时间线 / 碎碎念（与上面同款 .stat 卡，点卡跳对应管理页；读不到数据就停在「…」，不挡首页其他内容）
  const parseCfgItems = (text) => {
    const m = text.match(/items\s*:\s*\[([\s\S]*?)\n\t\],\n\};/) || text.match(/items\s*:\s*\[([\s\S]*?)\],\s*\n\};/);
    if (!m) return null;
    try {
      const arr = new Function(`return [${m[1]}];`)();
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  };
  // 日期归一：时间线的 "2026.10" 与碎碎念的 ISO 时间统一成 YYYY-MM / YYYY-MM-DD 再比较
  const normDate = (v) => {
    const n = String(v || '').trim().replace(/\./g, '-').slice(0, 10);
    return /^\d{4}-\d{2}(-\d{2})?$/.test(n) ? n : '';
  };
  const friendsCardStats = async () => {
    const data = await ghGetFile(FRIENDS_PATH);
    const list = friendsParseBody(friendsExtract(data.text).body);
    return {
      total: list.length,
      details: [['✅', '启用', list.filter((f) => f.enabled).length]],
    };
  };
  const galleryCardStats = async () => {
    if (typeof readAlbums !== 'function' || typeof loadAlbumPhotos !== 'function') return null;
    const { albums } = await readAlbums();
    const photosArr = await Promise.all(albums.map((a) => loadAlbumPhotos(a.id).catch(() => null)));
    const photos = photosArr.reduce((s, ph) => s + (ph ? ph.localImgs.length + ph.remoteUrls.length : 0), 0);
    return { total: photos, details: [['🖼', '相册', albums.length]] };
  };
  const cfgCardStats = async (path, dateOf) => {
    const data = await ghGetFile(path);
    const items = parseCfgItems(data.text);
    if (!items) return null;
    const dates = items.map((it) => normDate(dateOf(it))).filter(Boolean).sort().reverse();
    return {
      total: items.length,
      dates,
      details: [
        ['🆕', '本月新增', dates.filter((d) => d.slice(0, 7) === monthPrefix).length],
        ['🕘', '最新', dates[0] || '—'],
      ],
    };
  };
  /* ---------- 首页卡片（统一注册表）：显示哪些、什么顺序由「🧭 导航」页的 homeCards 配置决定 ---------- */
  const walineCardStats = async () => {
    if (typeof walineFetch !== 'function' || typeof wlToken !== 'function' || !wlToken()) {
      return { total: '—', details: [['🔑', '点开登录后显示数量', '']] };
    }
    const all = await walineFetch('/api/comment?type=list&pageSize=1');
    const wait = await walineFetch('/api/comment?type=list&pageSize=1&status=waiting').catch(() => null);
    return {
      total: all && all.count != null ? all.count : '—',
      details: [['⏳', '待审核', wait && wait.count != null ? wait.count : '—']],
    };
  };
  const musicCardStats = async () => {
    if (typeof extractConfigValue !== 'function' || typeof splitBraceObjects !== 'function') return null;
    const data = await ghGetFile('src/config/musicConfig.ts');
    const blk = extractConfigValue(data.text, 'playlist');
    if (!blk) return null;
    return { total: splitBraceObjects(blk.raw).length, details: [] };
  };
  /* key 集合要与「🧭 导航」页的 HOME_CARD_KEYS 保持一致 */
  const CARD_DEFS = {
    posts: { label: '文章', icon: '📝', fn: () => postStats(CFG.collections.posts) },
    dynamic: { label: '动态', icon: '💬', fn: () => dynStats(CFG.collections.dynamic) },
    projects: { label: '项目', icon: '🧩', fn: () => simpleStats(CFG.collections.projects) },
    spec: { label: '单页', icon: '📄', fn: () => simpleStats(CFG.collections.spec) },
    friends: { label: '友链', icon: '🔗', fn: friendsCardStats },
    gallery: { label: '相册', icon: '📸', fn: galleryCardStats },
    timeline: { label: '时间线', icon: '🕰️', fn: () => cfgCardStats(TIMELINE_PATH, (it) => it.date) },
    thoughts: { label: '碎碎念', icon: '💭', fn: () => cfgCardStats(THOUGHTS_PATH, (it) => it.createdAt) },
    music: { label: '音乐', icon: '🎵', fn: musicCardStats },
    waline: { label: '评论', icon: '💌', fn: walineCardStats },
    blog: { label: '博客', icon: '🌐', ext: 'blog', details: [['🌐', 'lanerc.me', '']] },
    umami: { label: '数据统计', icon: '📈', ext: 'umami', details: [['📈', 'Umami 访问统计', '']] },
    /* 纯入口卡（无统计数字）：点开进对应管理页；在「🧭 导航」页可加入/移除 */
    stats: { label: '写作', icon: '📊', nav: true, details: [['📊', '写作统计与总结报告', '']] },
    search: { label: '搜索', icon: '🔍', nav: true, details: [['🔍', '全文搜文章与动态', '']] },
    medialib: { label: '媒体库', icon: '🗂️', nav: true, details: [['🗂', '图片与音乐文件管理', '']] },
    tags: { label: '标签', icon: '🏷️', nav: true, details: [['🏷', '标签的增删改', '']] },
    fonts: { label: '字体', icon: '🔤', nav: true, details: [['🔤', '全局与各区域字体', '']] },
    theme: { label: '主题', icon: '🎨', nav: true, details: [['🎨', '色相、布局与特效', '']] },
    images: { label: '图片', icon: '🌄', nav: true, details: [['🖼', '头像、背景等图片位', '']] },
    announce: { label: '公告', icon: '📢', nav: true, details: [['📢', '静态与访客检测公告', '']] },
    booknav: { label: '书签', icon: '🔖', nav: true, details: [['🔖', '书签导航管理', '']] },
    navmgr: { label: '导航', icon: '🧭', nav: true, details: [['🧭', '导航栏与首页卡片布局', '']] },
    videos: { label: '视频', icon: '🎬', nav: true, details: [['🎬', '视频页管理', '']] },
    profile: { label: '简介', icon: '👤', nav: true, details: [['👤', '关于页资料', '']] },
    banner: { label: '横幅', icon: '🏞️', nav: true, details: [['🖼️', '横幅标题与文案', '']] },
    sitenav: { label: '站点导航', icon: '🗺️', nav: true, details: [['🌐', '博客顶栏导航', '']] },
  };
  const homeOrder = (() => {
    const cfgList = (CFG.navLayout && Array.isArray(CFG.navLayout.homeCards)) ? CFG.navLayout.homeCards : [];
    const list = cfgList.filter((k, i) => CARD_DEFS[k] && cfgList.indexOf(k) === i);
    return list.length ? list : Object.keys(CARD_DEFS);
  })();
  for (const key of homeOrder) {
    const def = CARD_DEFS[key];
    const d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = `<div class="stat-head"><span class="stat-ic">${def.icon || '✨'}</span><span class="lbl">${def.label}</span><span class="num">${def.ext ? '↗' : def.nav ? '→' : '…'}</span></div><div class="stat-rows"></div><div class="stat-spark"></div>`;
    d.onclick = () => {
      if (def.ext) { const u = CFG.navExternal && CFG.navExternal[def.ext]; if (u) window.open(u, '_blank', 'noopener'); }
      else location.hash = '#/' + key;
    };
    grid.appendChild(d);
    const rowsHtml = (details) => (details || []).map(([icon, sub, val]) =>
      `<div class="stat-row"><span class="dot"></span>${icon} ${sub} <b>${esc(String(val))}</b></div>`).join('');
    if (def.ext || def.nav) {
      d.querySelector('.stat-rows').innerHTML = rowsHtml(def.details);
    } else {
      (async () => {
        let r = null;
        try { r = await def.fn(); } catch (e) { /* 单卡失败留「…」占位 */ }
        if (!r) return;
        const numEl = d.querySelector('.num');
        if (numEl) countUp(numEl, r.total);
        const rowsEl = d.querySelector('.stat-rows');
        if (rowsEl) rowsEl.innerHTML = rowsHtml(r.details);
        const sparkEl = d.querySelector('.stat-spark');
        if (sparkEl && r.dates) sparkEl.innerHTML = sparkHtml(r.dates);
      })();
    }
  }
};

/* ---------- 写作统计图：折线图 + 热力图 ---------- */
const WRITE_COLORS = { posts: '#dc2626', dynamics: '#0d9488' };
function countByDay(dates) {
  const m = {};
  (dates || []).forEach((d) => { m[d] = (m[d] || 0) + 1; });
  return m;
}
function dayStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function renderWriteCharts(postDates, dynDates) {
  const postByDay = countByDay(postDates), dynByDay = countByDay(dynDates);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="card chart-card">
      <h2>📈 写作趋势 <span class="sub">近 30 天 · <i class="lg-dot" style="background:${WRITE_COLORS.posts}"></i>文章 <i class="lg-dot" style="background:${WRITE_COLORS.dynamics}"></i>动态</span></h2>
      <div class="chart-scroll"><div id="write-line"></div></div>
    </div>
    <div class="card chart-card">
      <h2>🗓 写作热力图 <span class="sub">近 26 周</span></h2>
      <div class="chart-scroll">
        <div class="heat-block"><div class="heat-title"><i class="lg-dot" style="background:${WRITE_COLORS.posts}"></i>文章</div><div id="heat-posts"></div></div>
        <div class="heat-block"><div class="heat-title"><i class="lg-dot" style="background:${WRITE_COLORS.dynamics}"></i>动态</div><div id="heat-dyns"></div></div>
      </div>
    </div>`;
  view.appendChild(wrap);
  $('#write-line').innerHTML = lineChartSVG(postByDay, dynByDay);
  $('#heat-posts').innerHTML = heatmapSVG(postByDay, '文章', ['#fecaca', '#fca5a5', '#f87171', '#dc2626']);
  $('#heat-dyns').innerHTML = heatmapSVG(dynByDay, '动态', ['#99f6e4', '#5eead4', '#2dd4bf', '#0d9488']);
}
/* 30 天双折线 SVG */
function lineChartSVG(postByDay, dynByDay) {
  const N = 30, W = 720, H = 230, P = { l: 34, r: 14, t: 14, b: 30 };
  const days = [];
  const today = new Date();
  for (let i = N - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(dayStr(d)); }
  const pc = days.map((d) => postByDay[d] || 0), dc = days.map((d) => dynByDay[d] || 0);
  const maxV = Math.max(2, ...pc, ...dc);
  const X = (i) => P.l + (i / (N - 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - v / maxV) * (H - P.t - P.b);
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = (arr, c) => `${line(arr)} L${X(N - 1).toFixed(1)},${Y(0).toFixed(1)} L${X(0).toFixed(1)},${Y(0).toFixed(1)} Z`;
  let g = '';
  const step = maxV <= 4 ? 1 : Math.ceil(maxV / 4);
  for (let v = 0; v <= maxV; v += step) {
    g += `<line x1="${P.l}" y1="${Y(v)}" x2="${W - P.r}" y2="${Y(v)}" class="ch-grid"/>`
      + `<text x="${P.l - 6}" y="${Y(v) + 4}" class="ch-lbl" text-anchor="end">${v}</text>`;
  }
  let xl = '';
  days.forEach((d, i) => {
    if (i % 5 === 0 || i === N - 1) xl += `<text x="${X(i)}" y="${H - 8}" class="ch-lbl" text-anchor="middle">${d.slice(5)}</text>`;
  });
  const dot = (arr, c) => arr.map((v, i) => v > 0 ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.2" fill="${c}"><title>${days[i]}：${v}</title></circle>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img">
    ${g}
    <path d="${area(dc, 1)}" fill="${WRITE_COLORS.dynamics}" opacity="0.12"/>
    <path d="${area(pc, 1)}" fill="${WRITE_COLORS.posts}" opacity="0.10"/>
    <path d="${line(dc)}" fill="none" stroke="${WRITE_COLORS.dynamics}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="${line(pc)}" fill="none" stroke="${WRITE_COLORS.posts}" stroke-width="2.4" stroke-linejoin="round"/>
    ${dot(dc, WRITE_COLORS.dynamics)}${dot(pc, WRITE_COLORS.posts)}
    ${xl}</svg>`;
}
/* 26 周热力图 SVG（周日起） */
function heatmapSVG(byDay, label, palette) {
  const WEEKS = 26, CS = 11, GAP = 3, TOP = 18;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endSunday = new Date(today); endSunday.setDate(endSunday.getDate() - today.getDay());
  const start = new Date(endSunday); start.setDate(start.getDate() - (WEEKS - 1) * 7);
  const W = WEEKS * (CS + GAP) + 8, H = 7 * (CS + GAP) + TOP + 26;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="heat-svg" role="img">`;
  let lastMonth = -1, lastLabelX = -50;
  for (let w = 0; w < WEEKS; w++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start); d.setDate(d.getDate() + w * 7 + r);
      if (d > today) continue;
      const ds = dayStr(d), c = byDay[ds] || 0;
      const lv = c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c === 3 ? 3 : 4;
      const fill = lv === 0 ? 'var(--heat-empty)' : palette[lv - 1];
      const x = 4 + w * (CS + GAP), y = TOP + r * (CS + GAP);
      s += `<rect x="${x}" y="${y}" width="${CS}" height="${CS}" rx="2.5" fill="${fill}" class="heat-cell"><title>${ds}：${c} ${label === '文章' ? '篇' : '条'}</title></rect>`;
    }
    const wd = new Date(start); wd.setDate(wd.getDate() + w * 7);
    const lx = 4 + w * (CS + GAP);
    if (wd.getMonth() !== lastMonth && lx - lastLabelX > 34) {
      lastMonth = wd.getMonth(); lastLabelX = lx;
      s += `<text x="${lx}" y="11" class="ch-lbl">${wd.getMonth() + 1}月</text>`;
    }
  }
  const cells = palette.map((c, i) => `<rect x="${i * 13}" y="0" width="10" height="10" rx="2" fill="${c}"/>`).join('');
  const ly = 7 * (CS + GAP) + TOP + 8;
  s += `<g transform="translate(${W - 132},${ly})"><text x="-30" y="9" class="ch-lbl">少</text>${cells}<text x="${palette.length * 13 + 4}" y="9" class="ch-lbl">多</text></g>`;
  return s + '</svg>';
}

/* 🛰 卫星星空页设置：读写 src/config/gnssConfig.ts（标题/简介/默认观察点/默认截止角/使用说明）。 */
async function mountGnssSection() {
  if ($('#gnss-sec')) return;
  const diaryCard = document.querySelector('#diary-list')?.closest('.card');
  const anchor = diaryCard || $('#list');
  if (!anchor) return;
  const sec = document.createElement('div');
  sec.className = 'card';
  sec.id = 'gnss-sec';
  sec.innerHTML = `<h2>🛰 卫星星空</h2>
    <p class="hint">博客 /gnss/ 页的标题、简介、默认观察点和「使用说明」都在这里改，保存后重新构建生效。<span class="meta copyable" data-copy="/gnss/" title="点击复制页面地址">/gnss/ 📋</span></p>
    <div id="gnss-form"><p class="hint">读取中…</p></div>`;
  anchor.after(sec);
  const box = sec.querySelector('#gnss-form');
  const PATH = 'src/config/gnssConfig.ts';
  try {
    const cf = await ghGetFile(PATH);
    let cSha = cf.sha;
    const t = cf.text;
    const pickS = (key, dft) => { const m = t.match(new RegExp(key + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); try { return m ? JSON.parse('"' + m[1] + '"') : dft; } catch (e) { return dft; } };
    const pickN = (key, dft) => { const m = t.match(new RegExp(key + '\\s*:\\s*(-?[\\d.]+)')); return m ? parseFloat(m[1]) : dft; };
    let notes = [];
    const nm = t.match(/notes\s*:\s*(\[[\s\S]*?\])\s*,?\s*\};/);
    if (nm) { try { notes = JSON.parse(nm[1].replace(/,\s*\]/, ']')); } catch (e) { notes = []; } }
    const cfg = {
      title: pickS('title', '卫星星空'), description: pickS('description', ''),
      defaultLat: pickN('defaultLat', 32.0603), defaultLon: pickN('defaultLon', 118.7969),
      defaultAlt: pickN('defaultAlt', 20), defaultCutoff: pickN('defaultCutoff', 10),
      notesTitle: pickS('notesTitle', '使用说明'), notes,
    };
    box.innerHTML = `
      <div class="field"><label>页面标题</label><input type="text" id="gn-title" value="${esc(cfg.title)}"></div>
      <div class="field"><label>页面简介</label><input type="text" id="gn-desc" value="${esc(cfg.description)}"></div>
      <div class="grid2">
        <div class="field"><label>默认纬度</label><input type="text" id="gn-lat" value="${cfg.defaultLat}"></div>
        <div class="field"><label>默认经度</label><input type="text" id="gn-lon" value="${cfg.defaultLon}"></div>
        <div class="field"><label>默认高度（米）</label><input type="text" id="gn-alt" value="${cfg.defaultAlt}"></div>
        <div class="field"><label>默认高度角截止</label><select id="gn-cut">${[0, 10, 15, 30].map((v) => `<option value="${v}" ${v === cfg.defaultCutoff ? 'selected' : ''}>${v}°</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>说明卡标题</label><input type="text" id="gn-ntitle" value="${esc(cfg.notesTitle)}"></div>
      <div class="field"><label>使用说明（每行一条，可用 &lt;strong&gt;加粗&lt;/strong&gt;）</label><textarea id="gn-notes" rows="7">${esc(cfg.notes.join('\n'))}</textarea></div>
      <button class="btn" id="gn-save">💾 保存卫星星空设置</button>`;
    box.querySelector('#gn-save').onclick = async () => {
      const num = (id) => parseFloat(box.querySelector(id).value);
      const lat = num('#gn-lat'), lon = num('#gn-lon'), alt = num('#gn-alt');
      if (!isFinite(lat) || lat < -90 || lat > 90) { toast('纬度要在 -90 ~ 90 之间', true); return; }
      if (!isFinite(lon) || lon < -180 || lon > 180) { toast('经度要在 -180 ~ 180 之间', true); return; }
      if (!isFinite(alt)) { toast('高度要填数字', true); return; }
      const out = {
        title: box.querySelector('#gn-title').value.trim() || '卫星星空',
        description: box.querySelector('#gn-desc').value.trim(),
        defaultLat: lat, defaultLon: lon, defaultAlt: alt,
        defaultCutoff: parseInt(box.querySelector('#gn-cut').value, 10),
        notesTitle: box.querySelector('#gn-ntitle').value.trim() || '使用说明',
        notes: box.querySelector('#gn-notes').value.split('\n').map((x) => x.trim()).filter(Boolean),
      };
      const text = '// GNSS 卫星星空页配置：标题、默认观察点与使用说明。\n'
        + '// 也可以在管理台「单页 → 🛰 卫星星空」里改。\n'
        + 'export const gnssConfig = {\n'
        + `\ttitle: ${JSON.stringify(out.title)},\n`
        + `\tdescription: ${JSON.stringify(out.description)},\n`
        + `\tdefaultLat: ${out.defaultLat},\n`
        + `\tdefaultLon: ${out.defaultLon},\n`
        + `\tdefaultAlt: ${out.defaultAlt},\n`
        + `\tdefaultCutoff: ${out.defaultCutoff},\n`
        + `\tnotesTitle: ${JSON.stringify(out.notesTitle)},\n`
        + '\tnotes: [\n'
        + out.notes.map((n) => '\t\t' + JSON.stringify(n) + ',').join('\n') + '\n'
        + '\t],\n};\n';
      try {
        const res = await saveWithLog(PATH, text, cSha, '卫星星空页设置更新 [管理台]', { type: '单页', action: '改卫星星空设置', target: out.title });
        cSha = res.content.sha;
        toast('卫星星空设置已保存，重新构建后生效');
      } catch (e) { toast(e.message, true); }
    };
  } catch (e) { box.innerHTML = '<p class="hint">读不到 src/config/gnssConfig.ts（可能还没上线这个文件）。</p>'; }
}

/* 单页评论区开关：写各页专属配置里的 showComment（友链/打赏/动态）。
 * 留言板跟全局评论走、一直开着；关于页模板里没评论组件，开不了——都不在此列。 */
const SPEC_COMMENT_TARGETS = [
  { label: '友链页', path: 'src/config/friendsConfig.ts' },
  { label: '打赏页', path: 'src/config/sponsorConfig.ts' },
  { label: '动态页', path: 'src/config/dynamicConfig.ts' },
  { label: '日记页', path: 'src/config/diaryConfig.ts' },
];
/* 单页里的「📔 日记」管理板块：条目 = src/content/diary/*.md，跟动态一样按条目增删改；
 * 博客展示页 /diary/ 模仿动态页版式；列表样式跟随全局（细条/卡片）。 */
async function mountDiarySection() {
  const anchor = $('#list');
  if (!anchor) return;
  const sec = document.createElement('div');
  sec.className = 'card';
  sec.innerHTML = `<h2>📔 日记</h2>
    <p class="hint">日记显示在博客 /diary/ 页（挂不挂导航栏去「🧭 站点导航」里配）。评论区开关在下面那张「💬 评论区开关」卡里，跟友链页/动态页并排。</p>
    <div class="toolbar"><button class="btn" id="btn-diary-new">＋ 新建日记</button>${LV_SEG}<span class="meta copyable" data-copy="/diary/" title="点击复制日记页地址（拿去站点导航里加）">/diary/ 📋</span><span class="spacer"></span><span class="hint copyable" data-copy="src/content/diary" title="点击复制路径">src/content/diary 📋</span></div>
    <div id="diary-list"><div class="card">加载中…</div></div>`;
  anchor.after(sec);
  sec.querySelector('#btn-diary-new').onclick = () => { location.hash = '#/edit/diary/__new__'; };
  syncLvSegs();
  const box = sec.querySelector('#diary-list');
  /* 密码锁皮肤切换（存 diaryConfig.ts 的 lockStyle，重新构建生效） */
  (async () => {
    try {
      const dc = await ghGetFile('src/config/diaryConfig.ts');
      let dSha = dc.sha, dText = dc.text;
      const NAMES = { notebook: '📕 日记本', classic: '🏛 经典', envelope: '✉️ 密封' };
      const cur = () => { const m = dText.match(/lockStyle\s*:\s*"(notebook|classic|envelope)"/); return m ? m[1] : 'notebook'; };
      const row = document.createElement('p');
      row.className = 'hint';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 2px';
      const draw = () => {
        row.innerHTML = `密码锁皮肤：${Object.keys(NAMES).map((k) => `<button class="btn btn-small" data-ls="${k}" ${k === cur() ? 'disabled' : ''}>${NAMES[k]}</button>`).join('')}<span class="meta">当前：${NAMES[cur()]}</span>`;
        row.querySelectorAll('[data-ls]').forEach((b) => { b.onclick = async () => {
          const want = b.dataset.ls;
          try {
            const text = /lockStyle\s*:/.test(dText)
              ? dText.replace(/lockStyle\s*:\s*"(notebook|classic|envelope)"/, `lockStyle: "${want}"`)
              : dText.replace(/(showComment\s*:\s*(?:true|false),)/, `$1\n\tlockStyle: "${want}",`);
            if (text === dText) throw new Error('配置格式对不上，没改动');
            const res = await saveWithLog('src/config/diaryConfig.ts', text, dSha, `日记密码锁皮肤改为${NAMES[want]} [管理台]`, { type: '日记', action: '切换锁皮肤', target: NAMES[want] });
            dSha = res.content.sha; dText = text;
            toast(`锁皮肤已换成${NAMES[want]}，重新构建后生效`);
          } catch (e) { toast(e.message, true); }
          draw();
        }; });
      };
      draw();
      sec.insertBefore(row, box);
    } catch (e) { /* 读不到配置就只显示列表 */ }
  })();
  try {
    const items = await ghGetFile('src/content/diary');
    const files = (Array.isArray(items) ? items : []).filter((x) => x.type === 'file' && x.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
    if (!files.length) { box.innerHTML = '<div class="card">还没有日记，点「＋ 新建日记」写第一篇。</div>'; return; }
    box.innerHTML = '';
    const rows = [];
    for (const f of files) {
      const div = document.createElement('div');
      div.className = 'list-item';
      const m = f.name.match(/(\d{4}-\d{2}-\d{2})/);
      div.innerHTML = `<span class="title">${esc(f.name.replace(/\.md$/, ''))}</span><span class="date">${m ? '📅 ' + m[1] : ''}</span><span class="meta">日记</span>
        <button class="btn btn-small">编辑</button>
        <button class="btn btn-small btn-danger">删除</button>`;
      const [btnEdit, btnDel] = div.querySelectorAll('button');
      btnEdit.onclick = () => { location.hash = `#/edit/diary/${encodeURIComponent(f.name)}`; };
      btnDel.onclick = async () => {
        if (!confirm(`确定删除日记 ${f.name}？`)) return;
        try {
          await delWithLog(`src/content/diary/${f.name}`, f.sha, `删除日记 ${f.name} [管理台]`, { type: '日记', action: '删除', target: f.name });
          toast('已删除');
          router();
        } catch (err) { toast(err.message, true); }
      };
      box.appendChild(div);
      rows.push({ f, div });
    }
    /* 回填真标题/发布日期/正文摘要（与文章列表同款，每批 4 个并发） */
    const fill = async ({ f, div }) => {
      try {
        const data = await ghGetFile(`src/content/diary/${f.name}`);
        const { fm, body } = parseFrontmatter(data.text);
        const tEl = div.querySelector('.title');
        if (tEl && fm.title) tEl.textContent = fm.title;
        const dEl = div.querySelector('.date');
        if (dEl && fm.published) dEl.textContent = '📅 ' + String(fm.published).slice(0, 10);
        const snippet = (body || '').split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('#')) || '';
        if (snippet && !div.querySelector('.excerpt')) {
          const p = document.createElement('p');
          p.className = 'excerpt'; p.textContent = snippet.slice(0, 120);
          div.insertBefore(p, div.querySelector('.meta'));
        }
        const mEl2 = div.querySelector('.meta');
        if (mEl2 && (fm.draft || fm.password)) mEl2.textContent = [fm.draft ? '草稿' : '', fm.password ? '🔒 密码保护' : ''].filter(Boolean).join(' · ');
      } catch (e) { /* 单篇失败不影响其他 */ }
    };
    for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map(fill));
  } catch (e) { box.innerHTML = `<div class="card">日记读取失败：${esc(e.message)}</div>`; }
}

async function mountSpecCommentCard() {
  const anchor = $('#list');
  if (!anchor) return;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>💬 评论区开关</h2><p class="hint">加载中…</p>';
  anchor.after(card); // 开关卡放列表下面，手机上先看文件列表（2026-10-25 用户要求）
  const rows = [];
  for (const t of SPEC_COMMENT_TARGETS) {
    try {
      const d = await ghGetFile(t.path);
      const m = d.text.match(/showComment\s*:\s*(true|false)/);
      rows.push({ ...t, sha: d.sha, text: d.text, on: m ? m[1] === 'true' : true, ok: !!m });
    } catch (e) { rows.push({ ...t, ok: false, on: false }); }
  }
  /* 通用单页（[slug] 模板）：开关存 specCommentConfig.ts 的 specComments 表 */
  const G_PATH = 'src/config/specCommentConfig.ts';
  let gSlugs = [], gMap = {}, gSha = null, gOk = false;
  try {
    const dir = await ghGetFile(CFG.collections.spec.path);
    if (Array.isArray(dir)) {
      gSlugs = dir.filter((x) => x.type === 'file' && /\.(md|mdx)$/.test(x.name))
        .map((x) => x.name.replace(/\.(md|mdx)$/, ''))
        .filter((s) => !['about', 'friends', 'guestbook'].includes(s));
    }
    const gd = await ghGetFile(G_PATH);
    gSha = gd.sha;
    const re = /"([^"]+)":\s*(true|false)/g;
    let mm;
    while ((mm = re.exec(gd.text))) gMap[mm[1]] = mm[2] === 'true';
    gOk = true;
  } catch (e) { /* 通用单页部分读取失败时只显示固定三项 */ }
  const buildGText = () => {
    const keys = Object.keys(gMap).sort();
    const body = keys.map((k) => `\t"${k}": ${gMap[k]},`).join('\n');
    return `// 通用单页评论区开关：slug -> 是否显示评论区；没写的默认显示。\n// 通用单页指由 src/pages/[slug].astro 模板生成的单页（src/content/spec/ 里的文件）。\n// 由 Alexander Console「单页 → 💬 评论区开关」卡维护。\nexport const specComments: Record<string, boolean> = {${body ? `\n${body}\n` : ''}};\n`;
  };
  const render = () => {
    card.innerHTML = `<h2>💬 评论区开关</h2>
      <p class="hint">切换后保存、重新构建才生效。留言板一直开着（跟全局评论走），不在这里管。</p>
      <p class="hint" style="margin-top:2px">展示单页（有专属版式，开关存在各自的配置文件里）：</p>
      ${rows.map((r, i) => `<div class="list-item"><span class="title">${esc(r.label)}</span><span class="meta copyable" data-copy="${esc(r.path)}" title="点击复制配置路径">${esc(r.path)} 📋</span><span class="spacer"></span>
        ${r.ok ? `<label class="pill${r.on ? ' on' : ''}" data-sct="${i}"><input type="checkbox" ${r.on ? 'checked' : ''}>评论区${r.on ? '开' : '关'}</label>` : '<span class="meta">读取失败</span>'}</div>`).join('')}
      <p class="hint" style="margin-top:14px">通用单页（通用模板生成，评论默认开）：</p>
      ${gOk ? (gSlugs.map((s) => `<div class="list-item"><span class="title">${esc(s)}</span><span class="meta copyable" data-copy="/${esc(s)}/" title="点击复制页面地址">/${esc(s)}/ 📋</span><span class="spacer"></span>
        <label class="pill${gMap[s] !== false ? ' on' : ''}" data-gct="${esc(s)}"><input type="checkbox" ${gMap[s] !== false ? 'checked' : ''}>评论区${gMap[s] !== false ? '开' : '关'}</label></div>`).join('') || '<p class="hint">还没有通用单页。在下面新建一个单页文件（别用关于/友链/留言这些已有名字），构建后开关会出现在这里。</p>') : '<p class="hint">通用单页开关读取失败</p>'}`;
    card.querySelectorAll('[data-sct]').forEach((el) => {
      el.querySelector('input').onchange = async (ev) => {
        const r = rows[parseInt(el.dataset.sct, 10)];
        const want = ev.target.checked;
        ev.target.disabled = true;
        try {
          const text = r.text.replace(/showComment\s*:\s*(true|false)/, `showComment: ${want}`);
          if (text === r.text) throw new Error('配置格式对不上，没改动');
          const res = await saveWithLog(r.path, text, r.sha, `${want ? '开启' : '关闭'}${r.label}评论区 [管理台]`, { type: '评论', action: want ? '开启评论区' : '关闭评论区', target: r.label });
          r.sha = res.content.sha; r.text = text; r.on = want;
          toast(`${r.label}评论区已${want ? '开启' : '关闭'}，重新构建后生效`);
        } catch (e) { toast(e.message, true); }
        render();
      };
    });
    card.querySelectorAll('[data-gct]').forEach((el) => {
      el.querySelector('input').onchange = async (ev) => {
        const slug = el.dataset.gct;
        const want = ev.target.checked;
        ev.target.disabled = true;
        try {
          gMap[slug] = want;
          const res = await saveWithLog(G_PATH, buildGText(), gSha, `${want ? '开启' : '关闭'}通用单页「${slug}」评论区 [管理台]`, { type: '评论', action: want ? '开启评论区' : '关闭评论区', target: `单页 ${slug}` });
          gSha = res.content.sha;
          toast(`单页「${slug}」评论区已${want ? '开启' : '关闭'}，重新构建后生效`);
        } catch (e) { toast(e.message, true); }
        render();
      };
    });
  };
  render();
}


/* 文章页工具栏里的「链接卡片」开关按钮：写 src/config/linkCardConfig.ts 的 enabled，重新构建生效。 */
async function mountLinkCardButton() {
  const btn = $('#btn-linkcard');
  if (!btn) return;
  const PATH = 'src/config/linkCardConfig.ts';
  try {
    const cf = await ghGetFile(PATH);
    let cSha = cf.sha, cText = cf.text;
    const cur = () => { const m = cText.match(/enabled\s*:\s*(true|false)/); return m ? m[1] === 'true' : true; };
    const draw = () => {
      const on = cur();
      btn.disabled = false;
      btn.textContent = `🔗 链接卡片：${on ? '开' : '关'}`;
      btn.title = on ? '已开启，点击关闭' : '已关闭，点击开启';
    };
    draw();
    btn.onclick = async () => {
      const want = !cur();
      btn.disabled = true;
      try {
        const text = cText.replace(/enabled\s*:\s*(true|false)/, `enabled: ${want}`);
        if (text === cText) throw new Error('配置格式对不上，没改动');
        const res = await saveWithLog(PATH, text, cSha, `文章链接卡片${want ? '开启' : '关闭'} [管理台]`, { type: '文章', action: '链接卡片开关', target: want ? '开' : '关' });
        cSha = res.content.sha; cText = text;
        toast(`文章链接卡片已${want ? '开启' : '关闭'}，重新构建后生效`);
      } catch (e) { toast(e.message, true); }
      draw();
    };
  } catch (e) {
    btn.textContent = '🔗 链接卡片：不可用';
    btn.title = '读不到 src/config/linkCardConfig.ts';
  }
}

/* 右侧栏快捷入口默认表（config.js 的 quickLinks 优先；「🧭 导航」页可改） */
const QUICK_LINK_DEFAULTS = [
  { icon: '🌐', label: '博客首页', url: 'https://lanerc.me/' },
  { icon: '🐙', label: 'GitHub 仓库', url: 'https://github.com/Misty-ui-source/Firefly' },
  { icon: '☁️', label: 'Cloudflare', url: 'https://dash.cloudflare.com' },
  { icon: '▲', label: 'Vercel', url: 'https://vercel.com/dashboard' },
  { icon: '💬', label: 'Waline 后台', url: 'https://waline.lanerc.me/ui' },
  { icon: '✨', label: 'Muse', url: 'https://muse.ai' },
  { icon: '🐧', label: 'Linux.do', url: 'https://linux.do/' },
  { icon: '🕰️', label: '旧站', url: 'https://www.lanerc.me' },
  { icon: '📝', label: '写作报告', url: '#/stats' },
];
function railQuickLinks() {
  const cfg = (CFG && Array.isArray(CFG.quickLinks) && CFG.quickLinks.length) ? CFG.quickLinks : null;
  if (cfg) return cfg;
  const list = QUICK_LINK_DEFAULTS.slice();
  const umami = CFG && CFG.navExternal && CFG.navExternal.umami;
  if (umami) list.splice(5, 0, { icon: '📊', label: 'Umami 统计', url: umami });
  return list;
}
function renderRailLinks() {
  const box = $('#rail-links');
  if (!box) return;
  box.innerHTML = railQuickLinks().map((l) => {
    const ext = /^https?:/i.test(l.url || '');
    return `<a href="${esc(l.url || '#')}" ${ext ? 'target="_blank" rel="noopener"' : ''}>${esc(l.icon || '🔗')} ${esc(l.label || '')}</a>`;
  }).join('');
}

/* 右侧信息栏（仅 PC 宽屏 side/mix 显示，CSS 控制）：快捷入口 + 最近操作 + GNSS 星历状态。 */
async function refreshRailOps() {
  const box = $('#rail-ops');
  if (!box) return;
  try {
    await oplogCurrentText();
    const list = (Array.isArray(window._oplogEntries) ? window._oplogEntries : []).slice(-5).reverse();
    box.innerHTML = list.length ? list.map((e) => `<div class="rail-op"><span class="t">${esc(e.type || '')} · ${esc(e.action || '')}</span><span class="g">${esc(e.target || '')}</span><time>${esc(String(e.ts || '').slice(5, 10))}</time></div>`).join('') : '<p class="hint">暂无操作记录</p>';
  } catch (e) { box.innerHTML = '<p class="hint">读取失败</p>'; }
}
async function mountRail() {
  const rail = $('#rail');
  if (!rail) return;
  if (rail.dataset.done) { renderRailLinks(); refreshRailOps(); return; }
  rail.dataset.done = '1';
  rail.innerHTML = `
    <div class="card rail-card"><h3>🧭 快捷入口</h3><div class="rail-links" id="rail-links"></div></div>
    <div class="card rail-card"><h3>🕘 最近操作</h3><div id="rail-ops"><p class="hint">读取中…</p></div></div>
    <div class="card rail-card" id="rail-gnss-card" hidden><h3>🛰 星历数据</h3><p class="hint" id="rail-gnss"></p></div>`;
  renderRailLinks();
  refreshRailOps();
  try {
    const m = await (await fetch('https://raw.githubusercontent.com/Misty-ui-source/Firefly/main/gnss-data/meta.json', { cache: 'no-store' })).json();
    const card = $('#rail-gnss-card'), line = $('#rail-gnss');
    if (card && line && m && m.updatedAtBj) {
      line.textContent = `数据日期 ${(m.brdcDates || []).join(' ~ ') || '-'} · 更新于 ${m.updatedAtBj}（北京时间）`;
      card.hidden = false;
    }
  } catch (e) { /* 拿不到星历状态就整卡不显示 */ }
}

/* 列表页 */
function listRoute(key) {
  return async () => {
    const col = CFG.collections[key];
    view.innerHTML = `<div class="toolbar">
        <button class="btn" id="btn-new">＋ 新建${col.label}</button>
        ${key === 'posts' ? '<button class="btn" id="btn-sort">🕒 按时间排</button>' : ''}
        ${key === 'posts' ? '<button class="btn" id="btn-linkcard" disabled>🔗 链接卡片…</button>' : ''}
        ${LV_SEG}
        <span class="spacer"></span><span class="hint copyable" data-copy="${col.path}" title="点击复制路径">${col.path} 📋</span>
      </div><div id="list"></div>`;
    $('#btn-new').onclick = () => { location.hash = `#/edit/${key}/__new__`; };
    if (key === 'posts') mountLinkCardButton();
    if (key === 'spec') { mountSpecCommentCard(); mountDiarySection(); mountGnssSection(); }
    const listEl = $('#list');
    /* 文章列表排序：默认文件名倒序，点按钮切到发布时间倒序（日期回填完会自动按当前模式重排） */
    let rowsRef = null;
    let sortMode = 'default';
    const applyOrder = () => {
      if (!rowsRef) return;
      const list = sortMode === 'time' ? [...rowsRef].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : rowsRef;
      list.forEach(({ div }) => listEl.appendChild(div));
    };
    const btnSort = $('#btn-sort');
    if (btnSort) btnSort.onclick = () => {
      sortMode = sortMode === 'time' ? 'default' : 'time';
      btnSort.textContent = sortMode === 'time' ? '🔤 默认序' : '🕒 按时间排';
      applyOrder();
    };
    listEl.innerHTML = '<div class="card">加载中…</div>';
    try {
      const items = await ghGetFile(col.path);
      const entries = (Array.isArray(items) ? items : []).filter((x) => x.type === 'dir' || x.name.endsWith('.md'));
      if (!entries.length) { listEl.innerHTML = '<div class="card">空的，来一篇吧 👆</div>'; return; }
      listEl.innerHTML = '';
      // 动态按文件名倒序
      entries.sort((a, b) => b.name.localeCompare(a.name));
      if (key === 'spec') {
        // 单页分两组：展示单页（关于/友链/留言，专属模板）在前，通用单页（通用模板）在后（2026-10-25 用户定顺序）
        const sRank = (n) => (['about', 'friends', 'guestbook'].includes(n.replace(/\.(md|mdx)$/, '')) ? 0 : 1);
        entries.sort((a, b) => sRank(a.name) - sRank(b.name) || b.name.localeCompare(a.name));
      }
      let lastSpecGroup = null;
      const rows = [];
      for (const e of entries) {
        const div = document.createElement('div');
        div.className = 'list-item';
        let dateHtml = '';
        if (key === 'dynamic') {
          const m = e.name.match(/(\d{4}-\d{2}-\d{2})/);
          dateHtml = `<span class="date">${m ? '📅 ' + m[1] : ''}</span>`;
        } else if (key === 'posts') {
          dateHtml = '<span class="date"></span>'; // 稍后异步回填 published
        }
        div.innerHTML = `<span class="title">${esc(e.name)}</span>${dateHtml}<span class="meta">${e.type}</span>
          <button class="btn btn-small">编辑</button>
          <button class="btn btn-small btn-danger">删除</button>`;
        const [btnEdit, btnDel] = div.querySelectorAll('button');
        btnEdit.onclick = () => { location.hash = `#/edit/${key}/${encodeURIComponent(e.name)}`; };
        btnDel.onclick = async () => {
          if (!confirm(`确定删除 ${e.name}？`)) return;
          try {
            if (e.type === 'dir') {
              /* 多文件目录删除保持逐文件删，日志记一条 pending，下次仓库保存时一并同步，避免一次提交塞几十个文件 */
              oplogRecord(col.label || key, '删除', e.name, '删除目录');
              const files = await ghGetFile(`${col.path}/${e.name}`);
              for (const f of files) await ghDelFile(`${col.path}/${e.name}/${f.name}`, f.sha, `删除 ${e.name}/${f.name} [管理台]`);
            } else {
              await delWithLog(`${col.path}/${e.name}`, e.sha, `删除 ${e.name} [管理台]`, { type: col.label || key, action: '删除', target: e.name });
            }
            toast('已删除');
            router();
          } catch (err) { toast(err.message, true); }
        };
        if (key === 'spec') {
          const isShow = ['about', 'friends', 'guestbook'].includes(e.name.replace(/\.(md|mdx)$/, ''));
          const grp = isShow ? 'show' : 'gen';
          if (grp !== lastSpecGroup) {
            lastSpecGroup = grp;
            const head = document.createElement('div');
            head.className = 'hint spec-group-head';
            head.style.cssText = 'margin:12px 2px 2px;font-weight:700';
            head.textContent = isShow ? '展示单页 · 专属模板（各有自己的版式）' : '通用单页 · 通用模板（新建文件自动生成页面）';
            listEl.appendChild(head);
          }
          const metaEl = div.querySelector('.meta');
          if (metaEl) metaEl.textContent = `${e.type} · ${isShow ? '专属模板' : '通用模板'}`;
          const slug = e.name.replace(/\.(md|mdx)$/, '');
          const urlChip = document.createElement('span');
          urlChip.className = 'meta copyable';
          urlChip.dataset.copy = `/${slug}/`;
          urlChip.title = '点击复制页面地址（拿去站点导航里加）';
          urlChip.textContent = `/${slug}/ 📋`;
          metaEl.after(urlChip);
        }
        listEl.appendChild(div);
        rows.push({ e, div });
      }
      rowsRef = rows;
      /* 文章列表：异步回填 published 写作时间 + 真实标题（每批 4 个并发），顺序默认不动 */
      if (key === 'posts' && rows.length) {
        const fill = async (row) => {
          const { e, div } = row;
          try {
            const files = await ghGetFile(`${col.path}/${e.name}`);
            const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
            if (!md) return;
            const data = await ghGetFile(`${col.path}/${e.name}/${md.name}`);
            const { fm } = parseFrontmatter(data.text);
            const dEl = div.querySelector('.date');
            if (dEl && fm.published) { dEl.textContent = '📅 ' + String(fm.published).slice(0, 10); row.date = String(fm.published); }
            const tEl = div.querySelector('.title');
            if (tEl && fm.title) tEl.textContent = fm.title;
            if (fm.description && !div.querySelector('.excerpt')) {
              const p = document.createElement('p');
              p.className = 'excerpt'; p.textContent = fm.description;
              div.insertBefore(p, div.querySelector('.meta'));
            }
            const mEl = div.querySelector('.meta');
            if (mEl && (fm.category || fm.draft)) mEl.textContent = (fm.draft ? '草稿 · ' : '') + (fm.category || '未分类');
          } catch (err) { /* 单篇失败不影响其他 */ }
        };
        for (let i = 0; i < rows.length; i += 4) {
          await Promise.all(rows.slice(i, i + 4).map(fill));
        }
        if (sortMode === 'time') applyOrder();
      }
    } catch (e) { listEl.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; }
  };
}
for (const key of Object.keys(CFG.collections)) routes[key] = listRoute(key);

/* 编辑页 */
routes.edit = async (arg) => {
  const [key, name] = arg.split('/');
  const col = CFG.collections[key];
  const isNew = name === '__new__';
  /* 本地草稿键：按 集合+目标 区分（文章/动态/项目/单页 各自独立，互不覆盖） */
  const draftKey = `admin-edit-draft:${key}:${name}`;
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  let fm = {}, body = '', sha = null, filePath = '', dirName = '';

  try {
    if (isNew) {
      fm = { published: nowISO().slice(0, 10), draft: 'false' };
      if (col.mode === 'file' && col.newFileName) {
        filePath = `${col.path}/${col.newFileName()}`;
        if (key === 'dynamic') fm = { published: nowISO(), pinned: 'false' };
        else if (key === 'diary') fm = { published: nowISO(), pinned: 'false', draft: 'false' };
      }
    } else if (col.mode === 'dir') {
      dirName = name;
      const files = await ghGetFile(`${col.path}/${name}`);
      const md = files.find((f) => f.name.endsWith('.md'));
      if (!md) throw new Error('目录里没有 md 文件');
      const data = await ghGetFile(`${col.path}/${name}/${md.name}`);
      ({ fm, body } = parseFrontmatter(data.text));
      sha = data.sha; filePath = `${col.path}/${name}/${md.name}`;
    } else {
      const data = await ghGetFile(`${col.path}/${name}`);
      ({ fm, body } = parseFrontmatter(data.text));
      sha = data.sha; filePath = `${col.path}/${name}`;
    }
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  /* ============ 表单：doulor 式分区编辑器 ============ */
  const isPost = key === 'posts';
  const isDynamic = key === 'dynamic';
  const isDiary = key === 'diary';
  const isTrue = (v) => String(v).toLowerCase() === 'true';
  const dtLocal = (v) => {
    const m = String(v || '').match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return m ? `${m[1]}T${m[2]}` : '';
  };
  const pill = (f, label, on) =>
    `<label class="pill${on ? ' on' : ''}"><input type="checkbox" data-f="${f}"${on ? ' checked' : ''}>${label}</label>`;

  let infoHtml = '';
  if (isPost) {
    const hasPw = !!(fm.password || fm.passwordHint);
    infoHtml = `
    <div class="field"><label>标题</label>
      <input type="text" data-f="title" class="big" value="${esc(fm.title ?? '')}" placeholder="文章标题"></div>
    <div class="grid2">
      <div class="field"><label>发布时间</label><input type="datetime-local" id="f-published" value="${dtLocal(fm.published)}"></div>
      <div class="field"><label>更新时间（可选）</label><input type="datetime-local" id="f-updated" value="${dtLocal(fm.updated)}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>分类</label><input type="text" data-f="category" value="${esc(fm.category ?? '')}" placeholder="如：技术"></div>
      <div class="field"><label>标签（逗号分隔）</label><input type="text" data-f="tags" value="${esc(Array.isArray(fm.tags) ? fm.tags.join(', ') : (fm.tags ?? ''))}" placeholder="如：AI, 折腾"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>系列</label><input type="text" data-f="series" id="f-series" list="series-list" value="${esc(fm.series ?? '')}" placeholder="如：博客搭建系列（留空=不归属）"><datalist id="series-list"></datalist></div>
      <div class="field"><label>系列内排序（数字越小越靠前）</label><input type="number" data-f="seriesOrder" value="${esc(fm.seriesOrder ?? '')}" placeholder="留空按发布时间排"></div>
    </div>
    <div class="field"><label>描述</label>
      <textarea data-f="description" rows="2" placeholder="一句话简介，显示在文章列表页">${esc(fm.description ?? '')}</textarea></div>
    <div class="field"><label>封面</label>
      <div class="cover-row">
        <input type="text" data-f="image" id="f-image" value="${esc(fm.image ?? '')}" placeholder=https://… 或 /assets/…">
        <input type="file" id="f-cover" accept="image/*" class="hidden">
        <button class="btn btn-small" id="btn-cover" type="button">🖼 上传</button>
        <button class="btn btn-small" id="btn-cover-ml" type="button">🗂 媒体库</button>
      </div>
      <div class="cover-prev" id="cover-prev">${fm.image ? `<img src="${esc(fm.image)}" alt="封面预览">` : '<span class="hint">暂无封面（留空则不显示）</span>'}</div>
    </div>
    <div class="field"><label>选项</label><div class="pills">
      ${pill('draft', '📝 草稿', isTrue(fm.draft))}
      ${pill('pinned', '📌 置顶', isTrue(fm.pinned))}
      ${pill('_pw', '🔒 密码保护', hasPw)}
    </div></div>
    <div id="pw-zone" class="${hasPw ? '' : 'hidden'}"><div class="grid2">
      <div class="field"><label>访问密码</label><input type="text" data-f="password" value="${esc(fm.password ?? '')}" placeholder="留空则不设"></div>
      <div class="field"><label>密码提示</label><input type="text" data-f="passwordHint" value="${esc(fm.passwordHint ?? '')}" placeholder="给读者的提示"></div>
    </div></div>
    ${isNew && col.mode === 'dir' ? `<div class="grid2">
      <div class="field"><label>目录名（英文）</label><input type="text" id="f-dirname" placeholder="my-new-post"></div>
      <div class="field"><label>文件名</label><input type="text" id="f-filename" value="index.md"></div>
    </div>` : ''}`;
  } else if (isDynamic) {
    infoHtml = `
    <div class="grid2">
      <div class="field"><label>发布时间</label><input type="datetime-local" id="f-published" value="${dtLocal(fm.published)}"></div>
      <div class="field"><label>地点（可选）</label><input type="text" data-f="location" value="${esc(fm.location ?? '')}" placeholder="如：上海"></div>
    </div>
    <div class="field"><label>选项</label><div class="pills">
      ${pill('pinned', '📌 置顶', isTrue(fm.pinned))}
      <button class="btn btn-small" id="btn-ai-tag" type="button">📰 插入【Muse AI 发布】</button>
    </div></div>
    <p class="hint">💡 动态支持 Markdown；配图点下方「🖼 插入图片」上传，R2 目录已自动填好今天的日期。</p>`;
  } else if (isDiary) {
    const hasPw = !!(fm.password || fm.passwordHint);
    infoHtml = `
    <div class="field"><label>标题</label>
      <input type="text" data-f="title" class="big" value="${esc(fm.title ?? '')}" placeholder="日记标题"></div>
    <div class="grid2">
      <div class="field"><label>发布时间</label><input type="datetime-local" id="f-published" value="${dtLocal(fm.published)}"></div>
      <div class="field"><label>地点（可选）</label><input type="text" data-f="location" value="${esc(fm.location ?? '')}" placeholder="如：南京"></div>
    </div>
    <div class="field"><label>选项</label><div class="pills">
      ${pill('draft', '📝 草稿', isTrue(fm.draft))}
      ${pill('pinned', '📌 置顶', isTrue(fm.pinned))}
      ${pill('_pw', '🔒 密码保护', hasPw)}
    </div></div>
    <div id="pw-zone" class="${hasPw ? '' : 'hidden'}"><div class="grid2">
      <div class="field"><label>访问密码</label><input type="text" data-f="password" value="${esc(fm.password ?? '')}" placeholder="留空则不设"></div>
      <div class="field"><label>密码提示</label><input type="text" data-f="passwordHint" value="${esc(fm.passwordHint ?? '')}" placeholder="给读者的提示"></div>
    </div></div>
    <p class="hint">💡 日记支持 Markdown；配图点下方「🖼 插入图片」上传，R2 目录已自动填好今天的日期。</p>`;
  } else {
    /* 项目 / 单页：通用表单 */
    const fieldDefs = {
      title: '标题', published: '发布时间', description: '描述',
      image: '封面', tags: '标签（逗号分隔）', draft: '草稿',
    };
    const fields = col.fields || Object.keys(fieldDefs);
    for (const f of fields) {
      const label = fieldDefs[f] || f;
      let val = fm[f] ?? '';
      if (Array.isArray(val)) val = val.join(', ');
      if (f === 'draft') {
        infoHtml += `<div class="field"><label>选项</label><div class="pills">${pill('draft', '📝 草稿', isTrue(val))}</div></div>`;
      } else if (f === 'published') {
        infoHtml += `<div class="field"><label>${esc(label)}</label><input type="datetime-local" id="f-published" value="${dtLocal(val)}"></div>`;
      } else if (f === 'description') {
        infoHtml += `<div class="field"><label>${esc(label)}</label><textarea data-f="${f}" rows="2">${esc(val)}</textarea></div>`;
      } else {
        infoHtml += `<div class="field"><label>${esc(label)}</label><input type="text" data-f="${f}" value="${esc(val)}"></div>`;
      }
    }
  }

  const r2dirDefault = isDynamic
    ? `dynamic/${new Date().toISOString().slice(0, 10)}`
    : col.mode === 'dir'
      ? `${key}/${filePath ? filePath.split('/').slice(-2, -1)[0] : new Date().toISOString().slice(0, 10)}`
      : `${key}/${new Date().toISOString().slice(0, 10)}`;
  view.innerHTML = `
  <div class="toolbar">
    <button class="btn btn-ghost" id="btn-back">← 返回</button>
    <span class="spacer"></span>
    <button class="btn btn-ghost" id="btn-preview">👁 预览</button>
    ${isNew ? '' : '<button class="btn btn-ghost" id="btn-history" type="button">🕘 历史</button>'}
    <button class="btn btn-ghost hidden" id="btn-discard-draft" type="button">🗑 丢弃草稿</button>
    <button class="btn btn-ghost hidden" id="btn-restore-draft" type="button">↩ 仍用旧草稿</button>
    <button class="btn" id="btn-save">💾 保存发布</button>
  </div>
  <div class="card"><h2>${isNew ? '新建' : '编辑'}${col.label} <span class="sub">${esc(filePath || '')}</span></h2>
    ${infoHtml}
  </div>
  <div class="card"><h2>正文 <span class="sub">Markdown · <span id="char-count">0</span> 字</span></h2>
    <div class="mdbar">
      <button class="btn btn-small" data-md="bold" type="button" title="加粗"><b>B</b></button>
      <button class="btn btn-small" data-md="italic" type="button" title="斜体"><i>I</i></button>
      <button class="btn btn-small" data-md="quote" type="button" title="引用">❝ 引用</button>
      <button class="btn btn-small" data-md="code" type="button" title="行内代码">‹› 代码</button>
      <button class="btn btn-small" data-md="link" type="button" title="链接">🔗 链接</button>
      <button class="btn btn-small" id="btn-video" type="button" title="插入视频">🎬 视频</button>
      <button class="btn btn-small" data-md="hl" type="button" title="高亮">✨ 高亮</button>
      <button class="btn btn-small" data-md="codeblock" type="button" title="代码块">📦 代码块</button>
      <button class="btn btn-small" data-md="task" type="button" title="任务列表">☑️ 任务</button>
      <button class="btn btn-small" data-md="table" type="button" title="表格">🗒 表格</button>
      <button class="btn btn-small" data-md="hr" type="button" title="分割线">➖ 分割线</button>
      <button class="btn btn-small" id="btn-img" type="button">🖼 插入图片</button>
      <input type="file" id="f-img" accept="image/*" multiple class="hidden">
      <button class="btn btn-small" id="btn-import" type="button" title="也可以直接把文件拖到页面上">📥 导入文件</button>
      <input type="file" id="f-import" accept=".md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp,.avif" multiple class="hidden">
      <input type="text" id="f-r2dir" value="${r2dirDefault}" placeholder="R2 目录，如 posts/2026-10-24">
      <button class="btn btn-small btn-ghost" id="btn-raw" type="button" title="开启后所有图片上传都不压缩、不转 WebP（文字多的截图建议开）；全局生效，含封面与背景">🖼 原图直传：关</button>
    </div>
    <div class="field"><textarea id="md-body" class="code" rows="20">${esc(body)}</textarea></div>
    <div id="preview" class="preview hidden"></div>
  </div>`;

  /* pill 开关样式 + 密码区显隐 */
  view.querySelectorAll('.pill input[type=checkbox]').forEach((el) => {
    el.onchange = () => {
      el.closest('.pill').classList.toggle('on', el.checked);
      if (el.dataset.f === '_pw') $('#pw-zone').classList.toggle('hidden', !el.checked);
    };
  });
  const ta = $('#md-body');
  /* 🖼 原图直传开关：状态存 localStorage，uploadImages 全局读取（封面/背景等上传同样生效） */
  const btnRaw = $('#btn-raw');
  if (btnRaw) {
    const paintRaw = () => {
      let on = false;
      try { on = localStorage.getItem('admin-upload-raw') === '1'; } catch (e) {}
      btnRaw.textContent = on ? '🖼 原图直传：开' : '🖼 原图直传：关';
      btnRaw.classList.toggle('btn-ghost', !on);
    };
    paintRaw();
    btnRaw.onclick = () => {
      let on = false;
      try { on = localStorage.getItem('admin-upload-raw') === '1'; localStorage.setItem('admin-upload-raw', on ? '0' : '1'); } catch (e) {}
      paintRaw();
      toast(on ? '原图直传已关，图片恢复压缩上传' : '原图直传已开：所有图片不压缩直传（全局生效）');
    };
  }
  const updCount = () => { $('#char-count').textContent = ta.value.replace(/\s/g, '').length; };
  ta.addEventListener('input', updCount); updCount();
  /* ---------- 本地草稿（自动保存）：写作中途退出/手机后台被杀也不丢 ----------
   * 文章/动态/项目/单页共用本编辑器，一处实现、四处生效。草稿只存本机浏览器，
   * 内容与打开时一致不落草稿；输入防抖 400ms 写一次，切后台/关页时立即补写；
   * 下次打开同一篇时自动恢复并提示，可用工具栏「🗑 丢弃草稿」放弃；保存成功即清。 */
  const draftCollect = () => {
    const d = { fields: {}, body: ta.value };
    view.querySelectorAll('[data-f]').forEach((el) => {
      d.fields[el.dataset.f] = el.type === 'checkbox' ? { c: el.checked } : { v: el.value };
    });
    ['f-published', 'f-updated', 'f-dirname', 'f-filename'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) d[id] = el.value;
    });
    return d;
  };
  const draftBaseline = JSON.stringify(draftCollect());
  const draftSession = {}; window._editDraftSession = draftSession;
  const draftWrite = () => {
    if (window._editDraftSession !== draftSession) return; /* 已切走/重开编辑器：旧会话不写 */
    if (!document.body.contains(ta)) return; /* 编辑器已不在页面上（在别的栏目打字不许污染草稿） */
    try {
      const cur = JSON.stringify(draftCollect());
      if (cur === draftBaseline) { localStorage.removeItem(draftKey); return; }
      localStorage.setItem(draftKey, JSON.stringify({ ts: Date.now(), baseSha: sha, data: JSON.parse(cur) }));
    } catch (e) {}
  };
  let draftTimer = null;
  const draftSchedule = () => { if (draftTimer) clearTimeout(draftTimer); draftTimer = setTimeout(draftWrite, 400); };
  view.addEventListener('input', draftSchedule);
  view.addEventListener('change', draftSchedule);
  window.addEventListener('pagehide', draftWrite);
  document.addEventListener('visibilitychange', () => { if (document.hidden) draftWrite(); });
  try {
    const rawDraft = localStorage.getItem(draftKey);
    if (rawDraft) {
      const savedDraft = JSON.parse(rawDraft);
      if (savedDraft && savedDraft.data && JSON.stringify(savedDraft.data) !== draftBaseline) {
        const applyDraft = () => {
        const d = savedDraft.data;
        view.querySelectorAll('[data-f]').forEach((el) => {
          const s = d.fields[el.dataset.f];
          if (!s) return;
          if (el.type === 'checkbox') {
            el.checked = !!s.c;
            const p = el.closest('.pill'); if (p) p.classList.toggle('on', el.checked);
            if (el.dataset.f === '_pw') { const z = $('#pw-zone'); if (z) z.classList.toggle('hidden', !el.checked); }
          } else el.value = s.v ?? '';
        });
        ['f-published', 'f-updated', 'f-dirname', 'f-filename'].forEach((id) => {
          const el = document.getElementById(id);
          if (el && d[id] !== undefined) el.value = d[id];
        });
        ta.value = d.body || '';
        updCount();
        };
        const showDiscard = () => {
          const dbtn = $('#btn-discard-draft');
          if (dbtn) {
            dbtn.classList.remove('hidden');
            dbtn.onclick = () => {
              try { localStorage.removeItem(draftKey); } catch (e) {}
              toast('草稿已丢弃，恢复为已保存的版本');
              router();
            };
          }
        };
        /* 版本守卫：草稿写作时文件的 sha 与现在对不上 = 这篇已在别处更新过，不自动恢复防旧盖新；
         * 旧版草稿没有 baseSha，同样按对不上处理（安全优先）。新建文章无版本可盖，不守卫。 */
        const shaMismatch = !isNew && !!sha && savedDraft.baseSha !== sha;
        if (!shaMismatch) {
          applyDraft();
          showDiscard();
          toast(`已恢复 ${new Date(savedDraft.ts).toLocaleString()} 未保存的草稿`);
        } else {
          showDiscard();
          const rbtn = $('#btn-restore-draft');
          if (rbtn) {
            rbtn.classList.remove('hidden');
            rbtn.onclick = () => { applyDraft(); rbtn.classList.add('hidden'); toast('已恢复旧草稿——这篇已在别处更新过，保存前请核对内容'); };
          }
          toast(`这篇已在其他地方更新过，${new Date(savedDraft.ts).toLocaleString()} 的旧草稿没有自动恢复`, true);
        }
      } else {
        localStorage.removeItem(draftKey);
      }
    }
  } catch (e) {}
  /* markdown 快捷按钮：在光标处包裹/插入 */
  const wrapSel = (before, after, placeholder) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || placeholder;
    ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length;
    updCount();
  };
  view.querySelectorAll('[data-md]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.md;
      if (k === 'bold') wrapSel('**', '**', '加粗文字');
      else if (k === 'italic') wrapSel('*', '*', '斜体文字');
      else if (k === 'quote') wrapSel('\n> ', '', '引用内容');
      else if (k === 'code') wrapSel('`', '`', '代码');
      else if (k === 'link') wrapSel('[', '](https://)', '链接文字');
      else if (k === 'hl') wrapSel('==', '==', '高亮文字');
      else if (k === 'codeblock') insertAtCursor('\n```js\n代码\n```\n');
      else if (k === 'task') insertAtCursor('\n- [ ] 任务\n');
      else if (k === 'table') insertAtCursor('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n');
      else if (k === 'hr') insertAtCursor('\n---\n');
    };
  });
  /* ---------- 正文右键菜单：工具栏全部 Markdown 动作搬到光标处，写长文不用滚回顶部 ---------- */
  const ctxMenu = document.createElement('div');
  ctxMenu.className = 'ctx-menu hidden';
  ctxMenu.innerHTML = `
    <button type="button" data-c="cut">剪切</button>
    <button type="button" data-c="copy">复制</button>
    <button type="button" data-c="paste">粘贴</button>
    <button type="button" data-c="cbmenu">代码块 <span class="ctx-arrow">▸</span></button>
    <div class="ctx-group">格式</div>
    <button type="button" data-c="bold">加粗</button>
    <button type="button" data-c="italic">斜体</button>
    <button type="button" data-c="quote">引用</button>
    <button type="button" data-c="code">行内代码</button>
    <button type="button" data-c="link">链接</button>
    <button type="button" data-c="hl">高亮</button>
    <div class="ctx-group">插入</div>
    <button type="button" data-c="task">任务列表</button>
    <button type="button" data-c="table">表格</button>
    <button type="button" data-c="hr">分割线</button>
    <button type="button" data-c="video">🎬 视频</button>
    <button type="button" data-c="img">🖼 图片</button>
    <button type="button" data-c="import">📥 导入文件</button>`;
  view.appendChild(ctxMenu);
  /* 代码块辅栏：悬停/点「代码块」时在主菜单旁展开，选语言 */
  const ctxSub = document.createElement('div');
  ctxSub.className = 'ctx-menu ctx-sub hidden';
  ctxSub.innerHTML = `
    <button type="button" data-cb="powershell">PowerShell</button>
    <button type="button" data-cb="batch">CMD / Batch</button>
    <button type="button" data-cb="bash">Bash</button>
    <button type="button" data-cb="js">JavaScript</button>
    <button type="button" data-cb="ts">TypeScript</button>
    <button type="button" data-cb="python">Python</button>
    <button type="button" data-cb="text">纯文本</button>`;
  view.appendChild(ctxSub);
  let ctxSel = null; /* 打开菜单时存下选区，执行前还原，防点菜单把选区弄丢 */
  const hideCtx = () => { ctxMenu.classList.add('hidden'); ctxSub.classList.add('hidden'); };
  let subTimer = null;
  const cbBtn = ctxMenu.querySelector('button[data-c="cbmenu"]');
  const showSub = () => {
    clearTimeout(subTimer);
    ctxSub.classList.remove('hidden');
    const r = cbBtn.getBoundingClientRect();
    const sw = ctxSub.offsetWidth, sh = ctxSub.offsetHeight;
    let left = r.right + 4;
    if (left + sw > window.innerWidth - 8) left = r.left - sw - 4;
    ctxSub.style.left = left + 'px';
    ctxSub.style.top = Math.max(8, Math.min(r.top, window.innerHeight - sh - 8)) + 'px';
  };
  const scheduleHideSub = () => { subTimer = setTimeout(() => ctxSub.classList.add('hidden'), 250); };
  cbBtn.addEventListener('mouseenter', showSub);
  cbBtn.addEventListener('click', () => { if (ctxSub.classList.contains('hidden')) showSub(); else ctxSub.classList.add('hidden'); });
  ctxMenu.addEventListener('mouseleave', scheduleHideSub);
  ctxSub.addEventListener('mouseenter', () => clearTimeout(subTimer));
  ctxSub.addEventListener('mouseleave', scheduleHideSub);
  const insertCodeBlock = (lang) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    const head = '\n```' + lang + '\n';
    const text = head + sel + '\n```\n';
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + head.length + sel.length;
    updCount();
  };
  const ctxCutCopy = (cut) => {
    /* runCtx 已还原选区并聚焦：先走系统命令（与 Ctrl+X/C 完全一致），失败再用剪贴板 API 兜底 */
    if (document.execCommand(cut ? 'cut' : 'copy')) { if (cut) updCount(); return; }
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    if (!sel) return;
    navigator.clipboard.writeText(sel).then(() => {
      if (cut) { ta.value = ta.value.slice(0, s) + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s; updCount(); }
    }).catch(() => {});
  };
  const ctxPaste = async () => {
    /* 右键粘贴：先读剪贴板里的图片（截图、复制的图片）→ 走图片上传管线插入；没有图片再贴文字 */
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        const imgs = [];
        for (const it of items) {
          const t = (it.types || []).find((x) => x.startsWith('image/'));
          if (!t) continue;
          const blob = await it.getType(t);
          const ext = (t.split('/')[1] || 'png').replace('jpeg', 'jpg');
          imgs.push(new File([blob], `clipboard-${Date.now()}-${imgs.length + 1}.${ext}`, { type: t }));
        }
        if (imgs.length) { await importDroppedImages(imgs); return; }
      } catch (err) { /* 浏览器不给读取权限/不支持时，落到下面的文字粘贴 */ }
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      try { const t = await navigator.clipboard.readText(); if (t) insertAtCursor(t); } catch (err) { /* 静默，Ctrl+V 仍可用 */ }
    }
  };
  const runCtx = (c) => {
    if (ctxSel) { ta.focus(); ta.selectionStart = ctxSel[0]; ta.selectionEnd = ctxSel[1]; }
    if (c === 'cut') ctxCutCopy(true);
    else if (c === 'copy') ctxCutCopy(false);
    else if (c === 'paste') ctxPaste();
    else if (c === 'bold') wrapSel('**', '**', '加粗文字');
    else if (c === 'italic') wrapSel('*', '*', '斜体文字');
    else if (c === 'quote') wrapSel('\n> ', '', '引用内容');
    else if (c === 'code') wrapSel('`', '`', '代码');
    else if (c === 'link') wrapSel('[', '](https://)', '链接文字');
    else if (c === 'hl') wrapSel('==', '==', '高亮文字');
    else if (c === 'task') insertAtCursor('\n- [ ] 任务\n');
    else if (c === 'table') insertAtCursor('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n');
    else if (c === 'hr') insertAtCursor('\n---\n');
    else if (c === 'video') $('#btn-video').click();
    else if (c === 'img') $('#btn-img').click();
    else if (c === 'import') $('#btn-import').click();
    else if (c.startsWith('cb:')) insertCodeBlock(c.slice(3));
  };
  ctxMenu.querySelectorAll('button[data-c]').forEach((b) => {
    b.addEventListener('mousedown', (ev) => ev.preventDefault());
    b.addEventListener('click', () => { if (b.dataset.c === 'cbmenu') return; hideCtx(); runCtx(b.dataset.c); });
  });
  ctxSub.querySelectorAll('button[data-cb]').forEach((b) => {
    b.addEventListener('mousedown', (ev) => ev.preventDefault());
    b.addEventListener('click', () => { hideCtx(); runCtx('cb:' + b.dataset.cb); });
  });
  ta.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ctxSel = [ta.selectionStart, ta.selectionEnd];
    ctxMenu.classList.remove('hidden');
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
  });
  document.addEventListener('mousedown', (e) => { if (!ctxMenu.contains(e.target) && !ctxSub.contains(e.target)) hideCtx(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); });
  window.addEventListener('blur', hideCtx);
  ta.addEventListener('scroll', hideCtx);
  /* 在光标处插入文本（不包裹选区） */
  function insertAtCursor(text) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + text.length;
    updCount();
  }
  /* 🎬 视频：弹窗粘贴链接 → 转 iframe 嵌入 */
  $('#btn-video').onclick = () => {
    const m = document.createElement('div');
    m.className = 'modal-mask';
    m.innerHTML = `<div class="modal-card">
      <h3>🎬 插入视频</h3>
      <p class="hint">粘贴 YouTube / B站 视频链接，自动转为嵌入播放器（宽 100%、高 400）。</p>
      <div class="field"><label>视频链接</label>
        <input type="text" id="v-url" placeholder="https://www.youtube.com/watch?v=… 或 https://www.bilibili.com/video/BV…"></div>
      <div class="modal-ops">
        <button class="btn btn-ghost" id="v-cancel" type="button">取消</button>
        <button class="btn" id="v-ok" type="button">插入</button>
      </div></div>`;
    view.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#v-cancel').onclick = close;
    m.addEventListener('mousedown', (ev) => { if (ev.target === m) close(); });
    const input = m.querySelector('#v-url');
    input.focus();
    m.querySelector('#v-ok').onclick = () => {
      const embed = parseVideoUrl(input.value);
      if (!embed) { toast('识别不了这个链接，换个试试', true); return; }
      insertAtCursor(`\n<iframe src="${embed}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`);
      close();
      toast('视频已插入');
    };
  };
  /* 封面：从媒体库选 */
  if ($('#btn-cover-ml')) $('#btn-cover-ml').onclick = () => openMediaPicker((url) => {
    $('#f-image').value = url;
    $('#cover-prev').innerHTML = `<img src="${esc(url)}" alt="封面预览">`;
    toast('封面已从媒体库选择（记得保存）');
  });
  /* 封面上传 */
  if ($('#btn-cover')) {
    $('#btn-cover').onclick = () => $('#f-cover').click();
    $('#f-cover').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      toast('上传封面中…');
      try {
        const { urls } = await uploadImages([f], 'covers');
        $('#f-image').value = urls[0];
        $('#cover-prev').innerHTML = `<img src="${esc(urls[0])}" alt="封面预览">`;
        toast('封面已上传');
      } catch (err) { toast(err.message, true); }
    };
  }
  /* 动态：一键插入 AI 发布标记 */
  if ($('#btn-ai-tag')) $('#btn-ai-tag').onclick = () => {
    ta.value = '【Muse AI 发布】' + ta.value; ta.focus(); updCount();
  };

  $('#btn-back').onclick = () => { location.hash = '#/' + key; };
  /* 系列输入框：异步加载已有系列名做候选（防拼写不一致） */
  if ($('#series-list')) {
    (async () => {
      try {
        const items = await ghGetFile(CFG.collections.posts.path);
        const names = new Set();
        const dirs = (Array.isArray(items) ? items : []).filter((x) => x.type === 'dir');
        for (let i = 0; i < dirs.length; i += 6) {
          await Promise.all(dirs.slice(i, i + 6).map(async (d) => {
            try {
              const files = await ghGetFile(`${CFG.collections.posts.path}/${d.name}`);
              const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
              if (!md) return;
              const data = await ghGetFile(`${CFG.collections.posts.path}/${d.name}/${md.name}`);
              const m = data.text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
              const sm = m && m[1].match(/^series:\s*(.+)$/m);
              if (sm) { const v = sm[1].trim().replace(/^["']|["']$/g, ''); if (v) names.add(v); }
            } catch (e) {}
          }));
        }
        $('#series-list').innerHTML = [...names].sort().map((n) => `<option value="${esc(n)}">`).join('');
      } catch (e) {}
    })();
  }
  $('#btn-preview').onclick = () => {
    const p = $('#preview');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) p.innerHTML = mdPreview(ta.value);
  };
  $('#btn-img').onclick = () => $('#f-img').click();
  $('#f-img').onchange = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    const dir = $('#f-r2dir').value.trim();
    toast('上传中…');
    try {
      const { urls } = await uploadImages(files, dir);
      const ins = urls.map((u) => `![图片](${u})`).join('\n');
      const pos = ta.selectionStart;
      ta.value = ta.value.slice(0, pos) + '\n' + ins + '\n' + ta.value.slice(pos);
      toast(`上传成功 ${urls.length} 张`);
      updCount();
    } catch (err) { toast(err.message, true); }
  };
  $('#btn-save').onclick = async () => {
    const newFm = {};
    view.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (f === '_pw') return; // 仅作开关，不写入
      if (el.type === 'checkbox') newFm[f] = el.checked ? 'true' : 'false';
      else if (f === 'tags') newFm[f] = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      else if (el.value.trim() !== '') newFm[f] = el.value.trim();
    });
    /* 密码保护未勾选 → 不写 password 字段 */
    const pwOn = view.querySelector('[data-f="_pw"]');
    if (pwOn && !pwOn.checked) { delete newFm.password; delete newFm.passwordHint; }
    /* 发布时间：datetime-local → ISO+08:00 */
    const toISO = (v) => (v && v.length === 16 ? v + ':00+08:00' : v);
    const pv = $('#f-published') ? $('#f-published').value : '';
    newFm.published = pv ? toISO(pv) : (fm.published || nowISO());
    const uv = $('#f-updated') ? $('#f-updated').value : '';
    if (uv) newFm.updated = toISO(uv);
    const newBody = ta.value;
    let path = filePath;
    if (isNew) {
      if (col.mode === 'dir') {
        const d = $('#f-dirname').value.trim(), fn = $('#f-filename').value.trim() || 'index.md';
        if (!d) { toast('请填写目录名', true); return; }
        path = `${col.path}/${d}/${fn}`;
      }
      sha = null;
      /* 新建撞同名：不覆盖已有文件，按用户要求自动改名顺延 (1)(2)(3)…
       * （同一天发第二条动态就会撞名，直接覆盖会把上一篇吃掉） */
      const origPath = path;
      let renamed = 0;
      for (let n = 1; n <= 50; n++) {
        let exists = false;
        try { const cur = await ghGetFile(path); exists = !!(cur && !Array.isArray(cur) && cur.sha); } catch (e) {}
        if (!exists) break;
        const np = origPath.endsWith('/index.md')
          ? origPath.replace(/\/index\.md$/, `(${n})/index.md`)
          : origPath.replace(/\.md$/, `(${n}).md`);
        if (np === path) break;
        renamed = n; path = np;
      }
      if (renamed) toast(`已存在同名文件，自动改名保存为 ${path}`);
    }
    const text = serializeFrontmatter(newFm, newBody);
    $('#btn-save').disabled = true;
    try {
      await saveWithLog(path, text, sha, `${isNew ? '新建' : '更新'} ${path} [管理台]`, { type: col.label || key, action: isNew ? '新建' : '更新', target: path });
      try { localStorage.removeItem(draftKey); } catch (e) {} /* 已正式保存：清掉本地草稿 */
      toast('保存成功！');
      location.hash = '#/' + key;
    } catch (err) { toast(err.message, true); $('#btn-save').disabled = false; }
  };

  /* 🕘 历史版本：git 历史本来就在仓库里，这里把它露出来（列表 / 对比 / 恢复） */
  const btnHistory = $('#btn-history');
  if (btnHistory) btnHistory.onclick = () => openFileHistory(filePath, () => { router(); });

  /* ---------- 拖文件导入：拖到编辑页松手即导入，只填草稿不自动保存 ---------- */
  /* 把解析出的 frontmatter 填进表单字段（走现有 [data-f] 字段，保存流程不变） */
  function fillFormFromFm(newFm) {
    for (const [k, v] of Object.entries(newFm)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'published' || k === 'updated') {
        const inp = k === 'published' ? $('#f-published') : $('#f-updated');
        if (inp) { const lv = dtLocal(v); if (lv) inp.value = lv; }
        continue;
      }
      const el = view.querySelector(`[data-f="${k}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') {
        el.checked = isTrue(v);
        const pillEl = el.closest('.pill');
        if (pillEl) pillEl.classList.toggle('on', el.checked);
      } else {
        el.value = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }
    /* 封面预览同步 */
    if (newFm.image) {
      const cp = $('#cover-prev');
      if (cp) cp.innerHTML = `<img src="${esc(newFm.image)}" alt="封面预览">`;
    }
    /* 原文带密码 → 勾上密码保护开关并展开密码区 */
    if (newFm.password || newFm.passwordHint) {
      const pw = view.querySelector('[data-f="_pw"]');
      if (pw && !pw.checked) { pw.checked = true; pw.dispatchEvent(new Event('change')); }
    }
  }
  async function importDroppedText(file) {
    const raw = await file.text();
    const parsed = parseFrontmatter(raw);
    const ifm = parsed.fm;
    let bodyToSet = parsed.body;
    let filled = false;
    /* 编辑器里已有内容（正文或标题）时先确认，防误拖覆盖丢稿 */
    const titleEl = view.querySelector('[data-f="title"]');
    const hasContent = ta.value.trim() !== '' || (titleEl && titleEl.value.trim() !== '');
    if (hasContent && !confirm('编辑器里已有内容，导入将覆盖正文和相关字段，继续？')) return;
    if (Object.keys(ifm).length) {
      fillFormFromFm(ifm);
      filled = true;
    } else if (isPost) {
      /* 没有 frontmatter：第一个一级标题/第一行作标题建议，其余作正文 */
      const sp = splitTitleFromBody(parsed.body);
      if (sp.title && titleEl) { titleEl.value = sp.title; bodyToSet = sp.body; filled = true; }
    }
    ta.value = bodyToSet;
    updCount();
    ta.focus();
    toast(filled ? `已导入 ${file.name}：字段与正文已填好（未保存）` : `已导入 ${file.name} 的正文（未保存）`);
  }
  async function importDroppedImages(imgs) {
    const dirEl = $('#f-r2dir');
    const dir = dirEl ? dirEl.value.trim() : '';
    toast(`上传图片中…（${imgs.length} 张）`);
    try {
      const res = await uploadImages(imgs, dir);
      const { urls } = res;
      insertAtCursor('\n' + urls.map((u) => `![图片](${u})`).join('\n') + '\n');
      const cp = res.compressed;
      toast(cp && cp.converted ? `图片已插入 ${urls.length} 张（已压缩，省了 ${Math.max(1, Math.round(cp.savedBytes / 1024))} KB）` : `图片已插入 ${urls.length} 张`);
    } catch (err) { toast(err.message, true); }
  }
  /* 拖放监听挂在 document 上，离开编辑页后自清理（textarea 已不在 DOM / hash 已变） */
  const dropOverlay = document.createElement('div');
  dropOverlay.className = 'drop-overlay hidden';
  dropOverlay.innerHTML = '<div class="drop-overlay-inner">📥 松开导入文件<div class="drop-overlay-sub">.md / .txt 导入正文（带 frontmatter 自动填字段）· 图片上传后插入光标处</div></div>';
  view.appendChild(dropOverlay);
  let dragDepth = 0;
  const dropAlive = () => document.contains(ta) && location.hash.startsWith('#/edit');
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  function cleanupDropImport() {
    document.removeEventListener('dragenter', onDropDragEnter);
    document.removeEventListener('dragover', onDropDragOver);
    document.removeEventListener('dragleave', onDropDragLeave);
    document.removeEventListener('drop', onDropDrop);
    dropOverlay.remove();
    if (view._dropImportCleanup === cleanupDropImport) view._dropImportCleanup = null;
  }
  function onDropDragEnter(e) {
    if (!hasFiles(e)) return;
    if (!dropAlive()) { cleanupDropImport(); return; }
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.remove('hidden');
  }
  function onDropDragOver(e) {
    if (!hasFiles(e)) return;
    if (!dropAlive()) { cleanupDropImport(); return; }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function onDropDragLeave(e) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.add('hidden');
  }
  /* 拖放与「导入文件」按钮共用同一条导入管线：分类 → 超限/不支持提示 → 文本填字段、图片上传插入 */
  async function importFiles(files) {
    if (!files.length) return;
    const cls = classifyDropFiles(files);
    if (cls.oversized.length) toast(`文件超过 2MB，已忽略：${cls.oversized.map((f) => f.name).join('、')}`, true);
    if (cls.ignored.length) toast(`不支持的文件，已忽略：${cls.ignored.map((f) => f.name).join('、')}`, true);
    if (cls.text) await importDroppedText(cls.text);
    if (cls.images.length) await importDroppedImages(cls.images);
  }
  async function onDropDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.add('hidden');
    if (!dropAlive()) { cleanupDropImport(); return; }
    await importFiles(Array.from(e.dataTransfer.files || []));
  }
  /* 「📥 导入文件」按钮（工具栏，routes.edit 共用）：点开选文件，与拖放走同一条管线 */
  const fImport = $('#f-import');
  if ($('#btn-import') && fImport) {
    $('#btn-import').onclick = () => fImport.click();
    fImport.onchange = async () => {
      const files = Array.from(fImport.files || []);
      fImport.value = '';
      await importFiles(files);
    };
  }
  if (view._dropImportCleanup) view._dropImportCleanup();
  view._dropImportCleanup = cleanupDropImport;
  document.addEventListener('dragenter', onDropDragEnter);
  document.addEventListener('dragover', onDropDragOver);
  document.addEventListener('dragleave', onDropDragLeave);
  document.addEventListener('drop', onDropDrop);
  /* 剪贴板粘贴图片：剪贴板里是图片时（右键粘贴 / Ctrl+V）上传 R2 并插入光标处，走与拖放相同的管线；纯文字粘贴不受影响 */
  ta.addEventListener('paste', async (e) => {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    let imgs = Array.from(cd.files || []).filter((f) => f.type && f.type.startsWith('image/'));
    if (!imgs.length) {
      imgs = Array.from(cd.items || []).filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean);
    }
    if (!imgs.length) return;
    e.preventDefault();
    await importDroppedImages(imgs);
  });
};

/* ---------- 网站公告：src/config/announcementConfig.ts ---------- */
const ANN_PATH = 'src/config/announcementConfig.ts';
/* 从 TS 源码里提取 "key: \"...\"" 字符串（处理 \\ \" \n 转义） */
function tsGetStr(src, key) {
  const m = src.match(new RegExp(key + '\\s*:\\s*"((?:[^"\\\\\\n]|\\\\.)*)"'));
  if (!m) return '';
  return m[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
function tsGetBool(src, key, def) {
  const m = src.match(new RegExp(key + '\\s*:\\s*(true|false)'));
  return m ? m[1] === 'true' : def;
}
/* 写回 TS 双引号字符串时的转义 */
function tsEsc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}
function tsGetNum(src, key, def) {
  const m = src.match(new RegExp(key + '\\s*:\\s*(-?[\\d.]+)'));
  return m ? parseFloat(m[1]) : def;
}
/* 解析公告 history 存档：[{ date, content }, ...] */
function parseAnnHistory(src) {
  const out = [];
  const re = /\{\s*date:\s*"((?:[^"\\]|\\.)*)",\s*content:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  const un = (s) => s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  let m;
  while ((m = re.exec(src))) out.push({ date: un(m[1]), content: un(m[2]) });
  return out;
}
/* 解析常用地址预设：[{ label, city, lat, lon }, ...] */
function parseAnnPlaces(src) {
  const out = [];
  const block = (src.match(/ownerPlaces\s*:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const re = /\{\s*label:\s*"((?:[^"\\]|\\.)*)",\s*city:\s*"((?:[^"\\]|\\.)*)",\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)\s*\}/g;
  const un = (x) => x.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  let m;
  while ((m = re.exec(block))) out.push({ label: un(m[1]), city: un(m[2]), lat: parseFloat(m[3]), lon: parseFloat(m[4]) });
  return out;
}
function buildAnnouncementTs({ content, closable, linkEnable, linkText, linkUrl, external, mode, geoTemplate, ownerCity, ownerLat, ownerLon, ownerPlaces, geoLinkEnable, geoLinkText, geoLinkUrl, geoExternal, history }) {
  const histLines = (history || []).map((h) => `\t\t{ date: "${tsEsc(h.date)}", content: "${tsEsc(h.content)}" },`).join('\n');
  const placeLines = (ownerPlaces || []).map((pl) => `\t\t{ label: "${tsEsc(pl.label)}", city: "${tsEsc(pl.city)}", lat: ${Number.isFinite(pl.lat) ? pl.lat : 0}, lon: ${Number.isFinite(pl.lon) ? pl.lon : 0} },`).join('\n');
  return `import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
\t// 公告标题，留空则走i18n默认标题
\ttitle: "",

\t// 公告内容（静态模式用）
\tcontent: "${tsEsc(content)}",

\t// 显示模式：static=静态公告 / geo=访客检测公告（控制台公告页可切换）
\tmode: "${mode === 'geo' ? 'geo' : 'static'}",

\t// 检测版文案模板，占位符：{country} {region} {city} {distance} {greeting}
\tgeoTemplate: "${tsEsc(geoTemplate)}",

\t// 博主位置（检测版算距离用）
\townerCity: "${tsEsc(ownerCity)}",
\townerLat: ${Number.isFinite(ownerLat) ? ownerLat : 0},
\townerLon: ${Number.isFinite(ownerLon) ? ownerLon : 0},

\t// 常用地址预设（控制台公告页维护，点预设切换到上面的 ownerCity/ownerLat/ownerLon）
\townerPlaces: [${placeLines ? `\n${placeLines}\n\t` : ''}],

\t// 是否允许用户关闭公告
\tclosable: ${closable},

\t// 静态公告的「了解更多」链接
\tlink: {
\t\t// 启用链接
\t\tenable: ${linkEnable},
\t\t// 链接文本
\t\ttext: "${tsEsc(linkText)}",
\t\t// 链接 URL
\t\turl: "${tsEsc(linkUrl)}",
\t\t// 内部链接
\t\texternal: ${external},
\t},

\t// 检测版公告的「了解更多」链接
\tgeoLink: {
\t\tenable: ${geoLinkEnable},
\t\ttext: "${tsEsc(geoLinkText)}",
\t\turl: "${tsEsc(geoLinkUrl)}",
\t\texternal: ${geoExternal},
\t},

\t// 历史公告存档（控制台自动维护）
\thistory: [${histLines ? `\n${histLines}\n\t` : ''}],
};
`;
}
routes.announce = async () => {
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  let sha = null, external = false, geoExternal = false;
  let content = '', closable = true, linkEnable = true, linkText = '', linkUrl = '';
  let mode = 'static', geoTemplate = '', ownerCity = '南京', ownerLat = 32.0603, ownerLon = 118.7969;
  let geoLinkEnable = true, geoLinkText = '', geoLinkUrl = '';
  let annHistory = [];
  let annPlaces = [], loadedPlaces = [];
  try {
    const data = await ghGetFile(ANN_PATH);
    sha = data.sha;
    const src = data.text;
    content = tsGetStr(src, 'content');
    closable = tsGetBool(src, 'closable', true);
    const linkBlock = (src.match(/link\s*:\s*\{([\s\S]*?)\}/) || [])[1] || '';
    linkEnable = tsGetBool(linkBlock, 'enable', true);
    linkText = tsGetStr(linkBlock, 'text');
    linkUrl = tsGetStr(linkBlock, 'url');
    external = tsGetBool(linkBlock, 'external', false);
    mode = tsGetStr(src, 'mode') === 'geo' ? 'geo' : 'static';
    geoTemplate = tsGetStr(src, 'geoTemplate');
    ownerCity = tsGetStr(src, 'ownerCity') || '南京';
    ownerLat = tsGetNum(src, 'ownerLat', 32.0603);
    ownerLon = tsGetNum(src, 'ownerLon', 118.7969);
    const geoLinkBlock = (src.match(/geoLink\s*:\s*\{([\s\S]*?)\}/) || [])[1] || '';
    geoLinkEnable = tsGetBool(geoLinkBlock, 'enable', true);
    geoLinkText = tsGetStr(geoLinkBlock, 'text');
    geoLinkUrl = tsGetStr(geoLinkBlock, 'url');
    geoExternal = tsGetBool(geoLinkBlock, 'external', false);
    annHistory = parseAnnHistory(src);
    annPlaces = parseAnnPlaces(src);
    if (!annPlaces.length) annPlaces = [{ label: ownerCity, city: ownerCity, lat: ownerLat, lon: ownerLon }];
    loadedPlaces = annPlaces.slice();
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  view.innerHTML = `
  <div class="toolbar">
    <button class="btn btn-ghost" id="btn-back">← 返回</button>
    <span class="spacer"></span>
    <button class="btn btn-ghost hidden" id="btn-ann-discard" type="button">🗑 丢弃草稿</button>
    <button class="btn btn-ghost hidden" id="btn-ann-restore" type="button">↩ 仍用旧草稿</button>
    <button class="btn" id="btn-save-ann">💾 保存公告</button>
  </div>
  <div class="card"><h2>📢 网站公告 <span class="sub">${ANN_PATH}</span></h2>
    <p class="hint">两种公告二选一启用，保存后重新构建网站生效。</p>
    <div class="field"><label>显示模式</label><div class="pills">
      <label class="pill${mode === 'static' ? ' on' : ''}"><input type="checkbox" id="ann-mode-static"${mode === 'static' ? ' checked' : ''}>📌 静态公告</label>
      <label class="pill${mode === 'geo' ? ' on' : ''}"><input type="checkbox" id="ann-mode-geo"${mode === 'geo' ? ' checked' : ''}>📍 访客检测公告</label>
      <label class="pill${closable ? ' on' : ''}"><input type="checkbox" id="ann-closable"${closable ? ' checked' : ''}>❌ 允许用户关闭</label>
    </div></div>
    <div id="ann-static-zone" class="${mode === 'static' ? '' : 'hidden'}">
      <div class="field"><label>公告内容</label>
        <input type="text" id="ann-content" class="big" value="${esc(content)}" placeholder="一句话公告"></div>
      <div class="field"><label>「了解更多」链接</label><div class="pills">
        <label class="pill${linkEnable ? ' on' : ''}"><input type="checkbox" id="ann-link-enable"${linkEnable ? ' checked' : ''}>🔗 显示链接</label>
      </div></div>
      <div id="ann-link-zone" class="${linkEnable ? '' : 'hidden'}">
        <div class="grid2">
          <div class="field"><label>链接文本</label><input type="text" id="ann-link-text" value="${esc(linkText)}" placeholder="了解更多"></div>
          <div class="field"><label>链接 URL</label><input type="text" id="ann-link-url" value="${esc(linkUrl)}" placeholder="/about/"></div>
        </div>
      </div>
      <div class="field"><label>🕘 历史公告</label>
        <div id="ann-history-list"></div>
        <p class="hint">保存新公告时，当前这条会自动归档到这里（最多 20 条）；「恢复」是把旧文案填回内容框，检查后点保存才生效。</p></div>
    </div>
    <div id="ann-geo-zone" class="${mode === 'geo' ? '' : 'hidden'}">
      <div class="field"><label>文案模板</label>
        <textarea id="ann-geo-template" rows="3">${esc(geoTemplate)}</textarea>
        <p class="hint">占位符：{country} 国家 · {region} 地区 · {city} 城市 · {distance} 距博主公里数 · {greeting} 时段问候（按访客当地时间）。位置拿不到时自动回落静态公告。</p></div>
      <div class="grid2">
        <div class="field"><label>博主所在城市</label><input type="text" id="ann-owner-city" value="${esc(ownerCity)}" placeholder="南京"></div>
        <div class="field"><label>城市坐标（纬度, 经度）</label><input type="text" id="ann-owner-coords" value="${ownerLat}, ${ownerLon}" placeholder="32.0603, 118.7969"></div>
      </div>
      <div class="field"><label>📍 常用地址</label>
        <div id="ann-places-list"></div>
        <p class="hint">出差、回家不用再查坐标：点预设的「使用」填进上面的城市和坐标，再点「保存公告」生效；增删会跟公告草稿一起自动暂存。</p>
        <button class="btn btn-ghost" id="btn-ann-place-add" type="button">＋ 把当前城市存为常用地址</button>
      </div>
      <div class="field"><label>「了解更多」链接</label><div class="pills">
        <label class="pill${geoLinkEnable ? ' on' : ''}"><input type="checkbox" id="ann-geolink-enable"${geoLinkEnable ? ' checked' : ''}>🔗 显示链接</label>
      </div></div>
      <div id="ann-geolink-zone" class="${geoLinkEnable ? '' : 'hidden'}">
        <div class="grid2">
          <div class="field"><label>链接文本</label><input type="text" id="ann-geolink-text" value="${esc(geoLinkText)}" placeholder="了解更多"></div>
          <div class="field"><label>链接 URL</label><input type="text" id="ann-geolink-url" value="${esc(geoLinkUrl)}" placeholder="/about/"></div>
        </div>
      </div>
    </div>
  </div>`;

  $('#btn-back').onclick = () => { location.hash = '#/dashboard'; };
  view.querySelectorAll('.pill input[type=checkbox]').forEach((el) => {
    el.onchange = () => {
      el.closest('.pill').classList.toggle('on', el.checked);
      if (el.id === 'ann-link-enable') $('#ann-link-zone').classList.toggle('hidden', !el.checked);
      if (el.id === 'ann-geolink-enable') $('#ann-geolink-zone').classList.toggle('hidden', !el.checked);
    };
  });
  /* 模式二选一（当单选钮用）：点哪个启哪个，对应的设置区展开 */
  const annSetMode = (m) => {
    const s = $('#ann-mode-static'), g = $('#ann-mode-geo');
    if (s) { s.checked = m === 'static'; s.closest('.pill').classList.toggle('on', m === 'static'); }
    if (g) { g.checked = m === 'geo'; g.closest('.pill').classList.toggle('on', m === 'geo'); }
    $('#ann-static-zone').classList.toggle('hidden', m !== 'static');
    $('#ann-geo-zone').classList.toggle('hidden', m !== 'geo');
  };
  const annMs = $('#ann-mode-static'), annMg = $('#ann-mode-geo');
  if (annMs) annMs.onchange = () => annSetMode('static');
  if (annMg) annMg.onchange = () => annSetMode('geo');
  /* 本地草稿（自动保存）：与正文编辑器同款机制，改到一半退出也不丢；保存成功即清 */
  const annDraftKey = 'admin-edit-draft:announce';
  const annCollect = () => {
    const coords = ($('#ann-owner-coords') ? $('#ann-owner-coords').value : '').split(',').map((x) => parseFloat(x));
    return {
      content: $('#ann-content').value, closable: $('#ann-closable').checked,
      linkEnable: $('#ann-link-enable').checked,
      linkText: $('#ann-link-text').value, linkUrl: $('#ann-link-url').value,
      mode: ($('#ann-mode-geo') && $('#ann-mode-geo').checked) ? 'geo' : 'static',
      geoTemplate: $('#ann-geo-template') ? $('#ann-geo-template').value : '',
      ownerCity: $('#ann-owner-city') ? $('#ann-owner-city').value : '',
      ownerLat: Number.isFinite(coords[0]) ? coords[0] : 0,
      ownerLon: Number.isFinite(coords[1]) ? coords[1] : 0,
      places: annPlaces,
      geoLinkEnable: $('#ann-geolink-enable') ? $('#ann-geolink-enable').checked : true,
      geoLinkText: $('#ann-geolink-text') ? $('#ann-geolink-text').value : '',
      geoLinkUrl: $('#ann-geolink-url') ? $('#ann-geolink-url').value : '',
    };
  };
  /* 用一组字段值 + 指定历史存档生成完整配置文件文本（vals 形状同 annCollect） */
  const buildAnnText = (vals, hist) => buildAnnouncementTs({
    content: vals.content.trim(), closable: vals.closable,
    linkEnable: vals.linkEnable, linkText: vals.linkText.trim(), linkUrl: vals.linkUrl.trim(), external,
    mode: vals.mode, geoTemplate: vals.geoTemplate.trim(), ownerCity: vals.ownerCity.trim() || '南京',
    ownerLat: vals.ownerLat, ownerLon: vals.ownerLon, ownerPlaces: vals.places || [],
    geoLinkEnable: vals.geoLinkEnable, geoLinkText: vals.geoLinkText.trim(), geoLinkUrl: vals.geoLinkUrl.trim(), geoExternal,
    history: hist,
  });
  /* 文件里已保存的值（删历史存档时用它生成文本，不带上表单里没保存的改动） */
  const loadedVals = () => ({ content, closable, linkEnable, linkText, linkUrl, mode, geoTemplate, ownerCity, ownerLat, ownerLon, places: loadedPlaces, geoLinkEnable, geoLinkText, geoLinkUrl });
  const renderAnnHistory = () => {
    const box = $('#ann-history-list');
    if (!box) return;
    if (!annHistory.length) { box.innerHTML = '<p class="hint">暂无存档。</p>'; return; }
    box.innerHTML = annHistory.map((h, i) => `
      <div class="list-item"><span class="title">${esc((h.content || '').slice(0, 60))}${(h.content || '').length > 60 ? '…' : ''}</span>
        <span class="meta">${esc(new Date(h.date).toLocaleString())}</span><span class="spacer"></span>
        <button class="mini-btn" data-hact="restore" data-i="${i}">恢复</button>
        <button class="mini-btn danger" data-hact="del" data-i="${i}">删除</button></div>`).join('');
    box.querySelectorAll('[data-hact]').forEach((b) => { b.onclick = () => annHistoryAct(b.dataset.hact, parseInt(b.dataset.i, 10)); });
  };
  const annHistoryAct = async (act, i) => {
    const h = annHistory[i];
    if (!h) return;
    if (act === 'restore') {
      $('#ann-content').value = h.content || '';
      $('#ann-content').scrollIntoView({ block: 'center' });
      toast('已填入内容框，检查后点「保存公告」生效');
      return;
    }
    if (!confirm(`删除这条历史公告？\n${(h.content || '').slice(0, 80)}`)) return;
    annHistory.splice(i, 1);
    try {
      await saveWithLog(ANN_PATH, buildAnnText(loadedVals(), annHistory), sha, '删除一条历史公告 [管理台]', { type: '公告', action: '删除历史', target: '历史公告' });
      toast('历史公告已删除');
    } catch (e) { toast(e.message, true); }
    routes.announce();
  };
  const renderAnnPlaces = () => {
    const box = $('#ann-places-list');
    if (!box) return;
    const curCity = ($('#ann-owner-city') ? $('#ann-owner-city').value : '').trim();
    const cc = ($('#ann-owner-coords') ? $('#ann-owner-coords').value : '').split(',').map((x) => parseFloat(x));
    if (!annPlaces.length) { box.innerHTML = '<p class="hint">暂无预设。</p>'; return; }
    box.innerHTML = annPlaces.map((pl, i) => {
      const on = pl.city === curCity && Math.abs(pl.lat - cc[0]) < 1e-9 && Math.abs(pl.lon - cc[1]) < 1e-9;
      return `<div class="list-item"><span class="title">${on ? '✅ ' : ''}${esc(pl.label)} · ${esc(pl.city)}</span>
        <span class="meta">${pl.lat}, ${pl.lon}</span><span class="spacer"></span>
        <button class="mini-btn" data-pact="apply" data-i="${i}">使用</button>
        <button class="mini-btn danger" data-pact="del" data-i="${i}">删除</button></div>`;
    }).join('');
    box.querySelectorAll('[data-pact]').forEach((b) => { b.onclick = () => annPlacesAct(b.dataset.pact, parseInt(b.dataset.i, 10)); });
  };
  const annPlacesAct = (act, i) => {
    const pl = annPlaces[i];
    if (!pl) return;
    if (act === 'apply') {
      $('#ann-owner-city').value = pl.city;
      $('#ann-owner-coords').value = `${pl.lat}, ${pl.lon}`;
      ['#ann-owner-city', '#ann-owner-coords'].forEach((sel) => { const el = $(sel); if (el) el.dispatchEvent(new Event('input', { bubbles: true })); });
      renderAnnPlaces();
      toast(`已填入「${pl.label}」，点「保存公告」后生效`);
      return;
    }
    if (!confirm(`删除常用地址「${pl.label}」？`)) return;
    annPlaces.splice(i, 1);
    renderAnnPlaces();
    annSchedule();
  };
  ['#ann-owner-city', '#ann-owner-coords'].forEach((sel) => { const el = $(sel); if (el) el.addEventListener('input', renderAnnPlaces); });
  const annPlaceAddBtn = $('#btn-ann-place-add');
  if (annPlaceAddBtn) annPlaceAddBtn.onclick = () => {
    const city = ($('#ann-owner-city').value || '').trim();
    const cc = $('#ann-owner-coords').value.split(',').map((x) => parseFloat(x));
    if (!city) { toast('先填博主所在城市', true); return; }
    if (!Number.isFinite(cc[0]) || !Number.isFinite(cc[1])) { toast('坐标格式不对，应为 纬度, 经度', true); return; }
    const label = (prompt('给这个地址起个备注名（如：学校、家、出差）', city) || '').trim();
    if (!label) return;
    const ex = annPlaces.findIndex((x) => x.label === label);
    if (ex >= 0) annPlaces[ex] = { label, city, lat: cc[0], lon: cc[1] };
    else annPlaces.push({ label, city, lat: cc[0], lon: cc[1] });
    renderAnnPlaces();
    annSchedule();
    toast(`常用地址「${label}」已加入，点「保存公告」后写入`);
  };
  renderAnnHistory();
  const annBaseline = JSON.stringify(annCollect());
  const annSession = {}; window._annDraftSession = annSession;
  const annWrite = () => {
    if (window._annDraftSession !== annSession) return;
    const ac = $('#ann-content'); if (!ac || !document.body.contains(ac)) return; /* 已离开公告页：不写 */
    try {
      const cur = JSON.stringify(annCollect());
      if (cur === annBaseline) { localStorage.removeItem(annDraftKey); return; }
      localStorage.setItem(annDraftKey, JSON.stringify({ ts: Date.now(), baseSha: sha, data: JSON.parse(cur) }));
    } catch (e) {}
  };
  let annTimer = null;
  const annSchedule = () => { if (annTimer) clearTimeout(annTimer); annTimer = setTimeout(annWrite, 400); };
  view.addEventListener('input', annSchedule);
  view.addEventListener('change', annSchedule);
  window.addEventListener('pagehide', annWrite);
  try {
    const rawAnn = localStorage.getItem(annDraftKey);
    if (rawAnn) {
      const savedAnn = JSON.parse(rawAnn);
      if (savedAnn && savedAnn.data && JSON.stringify(savedAnn.data) !== annBaseline) {
        const applyAnn = () => {
        const d = savedAnn.data;
        $('#ann-content').value = d.content ?? '';
        $('#ann-link-text').value = d.linkText ?? '';
        $('#ann-link-url').value = d.linkUrl ?? '';
        [['#ann-closable', d.closable], ['#ann-link-enable', d.linkEnable]].forEach(([sel, v]) => {
          const el = $(sel); el.checked = !!v;
          el.closest('.pill').classList.toggle('on', el.checked);
        });
        $('#ann-link-zone').classList.toggle('hidden', !$('#ann-link-enable').checked);
        /* 检测版字段（老草稿没这些字段时跳过，保留文件里的值） */
        if (d.geoTemplate !== undefined) $('#ann-geo-template').value = d.geoTemplate;
        if (d.ownerCity !== undefined) $('#ann-owner-city').value = d.ownerCity;
        if (d.ownerLat !== undefined && d.ownerLon !== undefined) $('#ann-owner-coords').value = `${d.ownerLat}, ${d.ownerLon}`;
        if (Array.isArray(d.places)) { annPlaces = d.places; renderAnnPlaces(); }
        if (d.geoLinkText !== undefined) $('#ann-geolink-text').value = d.geoLinkText;
        if (d.geoLinkUrl !== undefined) $('#ann-geolink-url').value = d.geoLinkUrl;
        if (d.geoLinkEnable !== undefined) {
          const gel = $('#ann-geolink-enable');
          gel.checked = !!d.geoLinkEnable;
          gel.closest('.pill').classList.toggle('on', gel.checked);
          $('#ann-geolink-zone').classList.toggle('hidden', !gel.checked);
        }
        if (d.mode) annSetMode(d.mode);
        };
        const showAnnDiscard = () => {
          const b = $('#btn-ann-discard');
          if (b) { b.classList.remove('hidden'); b.onclick = () => { try { localStorage.removeItem(annDraftKey); } catch (e) {} toast('草稿已丢弃，恢复为已保存的版本'); router(); }; }
        };
        /* 版本守卫（同编辑器）：公告已在别处更新过时不自动恢复旧草稿 */
        if (!sha || savedAnn.baseSha === sha) {
          applyAnn();
          showAnnDiscard();
          toast(`已恢复 ${new Date(savedAnn.ts).toLocaleString()} 未保存的公告草稿`);
        } else {
          showAnnDiscard();
          const rb = $('#btn-ann-restore');
          if (rb) { rb.classList.remove('hidden'); rb.onclick = () => { applyAnn(); rb.classList.add('hidden'); toast('已恢复旧草稿——公告已在别处更新过，保存前请核对'); }; }
          toast(`公告已在其他地方更新过，${new Date(savedAnn.ts).toLocaleString()} 的旧草稿没有自动恢复`, true);
        }
      } else localStorage.removeItem(annDraftKey);
    }
  } catch (e) {}
  $('#btn-save-ann').onclick = async () => {
    const ac = annCollect();
    /* 静态内容变了就把当前这条归档（去重相邻重复，最多 20 条） */
    let newHistory = annHistory.slice();
    if (ac.content.trim() !== content && content) {
      newHistory.unshift({ date: new Date().toISOString(), content });
      newHistory = newHistory.filter((h, i) => i === 0 || h.content !== newHistory[i - 1].content).slice(0, 20);
    }
    const text = buildAnnText(ac, newHistory);
    const btn = $('#btn-save-ann');
    btn.disabled = true;
    try {
      await saveWithLog(ANN_PATH, text, sha, '更新网站公告 [管理台]', { type: '公告', action: '更新', target: '网站公告' });
      annHistory = newHistory;
      try { localStorage.removeItem('admin-edit-draft:announce'); } catch (e) {} /* 已正式保存：清草稿 */
      toast('公告已保存，重新构建网站后生效');
      routes.announce();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };
};

/* ---------- 友链管理 ---------- */
const FRIENDS_PATH = 'src/config/friendsConfig.ts';
function friendsExtract(src) {
  const kw = 'export const friendsConfig';
  const ks = src.indexOf(kw);
  if (ks < 0) throw new Error('找不到 friendsConfig');
  const eq = src.indexOf('=', ks);
  const as = src.indexOf('[', eq); /* 跳过类型注解 FriendLink[] 里的 [] */
  let depth = 0, i = as;
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (!depth) break; }
  }
  return { head: src.slice(0, as + 1), body: src.slice(as + 1, i), tail: src.slice(i) };
}
function friendsParseBody(body) {
  const list = [];
  let i = 0;
  while (i < body.length) {
    const s = body.indexOf('{', i);
    if (s < 0) break;
    let depth = 0, j = s;
    for (; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') { depth--; if (!depth) break; }
    }
    const block = body.slice(s, j + 1);
    const get = (k) => { const mm = block.match(new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return mm ? mm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : ''; };
    const tagsM = block.match(/tags\s*:\s*\[([^\]]*)\]/);
    const tags = tagsM ? tagsM[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
    list.push({
      title: get('title'), imgurl: get('imgurl'), desc: get('desc'), siteurl: get('siteurl'),
      tags, weight: parseInt((block.match(/weight\s*:\s*(\d+)/) || [])[1] || '0', 10),
      enabled: /enabled\s*:\s*true/.test(block), rss: get('rss'),
    });
    i = j + 1;
  }
  return list;
}
/* 友链剪切板解析：认博主通用的「本站信息」格式（带标签的行 + 裸 URL 兜底分类，也吃 JSON） */
function parseFriendClipboard(text) {
  const out = { title: '', siteurl: '', imgurl: '', desc: '', rss: '' };
  if (!text) return out;
  const t = String(text).trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      out.title = j.title || j.name || '';
      out.siteurl = j.siteurl || j.url || j.link || '';
      out.imgurl = j.imgurl || j.avatar || j.img || j.icon || '';
      out.desc = j.desc || j.description || '';
      out.rss = j.rss || j.feed || '';
      if (out.title || out.siteurl) return out;
    } catch (e) { /* 不是 JSON，按文本继续 */ }
  }
  const urlRe = /https?:\/\/[^\s"'<>，。、；）)】\]]+/g;
  const labelMap = [
    ['title', /^(站点名称|网站名称|站名|名称|名字|博客名|title|name)\s*[:：]\s*(.+)$/i],
    ['siteurl', /^(站点链接|网站链接|站点地址|网址|地址|链接|主页|url|link|site)\s*[:：]\s*(.+)$/i],
    ['imgurl', /^(头像链接|头像地址|头像|avatar|imgurl|img|icon|logo)\s*[:：]\s*(.+)$/i],
    ['desc', /^(站点描述|网站描述|描述|简介|介绍|签名|desc|description|intro)\s*[:：]\s*(.+)$/i],
    ['rss', /^(rss|feed|订阅地址|订阅)\s*[:：]\s*(.+)$/i],
  ];
  const usedUrls = new Set();
  const plainLines = [];
  for (const rawLine of t.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let matched = false;
    for (const [key, re] of labelMap) {
      const m = line.match(re);
      if (m) {
        const v = m[2].trim();
        const um = v.match(urlRe);
        out[key] = (key === 'title' || key === 'desc') ? v : (um ? um[0] : v);
        if (um) um.forEach((u) => usedUrls.add(u));
        matched = true;
        break;
      }
    }
    if (!matched) plainLines.push(line);
  }
  const rest = [...new Set(t.match(urlRe) || [])].filter((u) => !usedUrls.has(u) && u !== out.siteurl && u !== out.imgurl && u !== out.rss);
  for (const u of rest) {
    if (!out.rss && /(rss|feed|atom|\.xml($|[?#]))/i.test(u)) out.rss = u;
    else if (!out.imgurl && /\.(png|jpe?g|webp|avif|gif|svg|ico)($|[?#])/i.test(u)) out.imgurl = u;
  }
  const rest2 = rest.filter((u) => u !== out.rss && u !== out.imgurl);
  if (!out.imgurl) { const av = rest2.find((u) => /avatar|logo|icon|favicon/i.test(u)); if (av) out.imgurl = av; }
  if (!out.siteurl) { const site = rest2.find((u) => u !== out.imgurl); if (site) out.siteurl = site; }
  for (const line of plainLines) {
    const cleaned = line.replace(urlRe, '').replace(/^[-*·•#\s]+/, '').trim();
    if (!cleaned) continue;
    if (!out.title && cleaned.length <= 30) { out.title = cleaned; continue; }
    if (!out.desc) out.desc = cleaned;
  }
  return out;
}
/* 按常用路径逐个实测站点的 RSS，测通哪个返回哪个（剪切板填充、网址自动探测共用同一套） */
async function probeRss(siteurl) {
  let u0;
  try { u0 = new URL(siteurl); } catch (e) { return ''; }
  const cands = [];
  if (u0.pathname && u0.pathname !== '/') {
    const base = siteurl.replace(/\/+$/, '');
    cands.push(base + '/rss.xml', base + '/atom.xml', base + '/feed');
  }
  for (const p of ['/rss.xml', '/atom.xml', '/feed', '/feed.xml', '/rss', '/index.xml']) cands.push(u0.origin + p);
  for (const u of [...new Set(cands)]) {
    try {
      const r = await fetch('/api/rss-test?url=' + encodeURIComponent(u), { headers: { Authorization: `Bearer ${token()}` } });
      const j = await r.json();
      if (j && j.ok) return u;
    } catch (e) { /* 测不通换下一个 */ }
  }
  return '';
}
function wireClipFill(formEl) {
  const btn = formEl.querySelector('[data-a=clipfill]');
  if (!btn) return;
  const apply = async (text) => {
    const p = parseFriendClipboard(text);
    const filled = [];
    const set = (k, v, label) => {
      if (!v) return;
      const el = formEl.querySelector(`[data-k="${k}"]`);
      if (el) { el.value = v; filled.push(label); }
    };
    set('title', p.title, '站名'); set('siteurl', p.siteurl, '网址'); set('imgurl', p.imgurl, '头像'); set('desc', p.desc, '描述');
    if (p.rss) set('rss', p.rss, 'RSS');
    else if (p.siteurl) {
      if (filled.length) toast('基本信息已填充，正在探测 RSS…');
      const found = await probeRss(p.siteurl);
      if (found) set('rss', found, 'RSS（自动探测）');
    }
    if (filled.length) toast('已从剪切板填充：' + filled.join('、'));
    else toast('没认出友链信息，确认复制的是对方的本站信息', true);
  };
  btn.onclick = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
    if (text && text.trim()) { apply(text); return; }
    const box = formEl.querySelector('.clip-paste');
    if (box) { box.classList.remove('hidden'); const ta = box.querySelector('.clip-ta'); if (ta) ta.focus(); }
  };
  const go = formEl.querySelector('[data-a=clipgo]');
  if (go) go.onclick = () => apply(formEl.querySelector('.clip-ta').value);
}
function friendToTs(f, weight) {
  const q = (s) => `"${String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `\t{\n\t\ttitle: ${q(f.title)},\n\t\timgurl: ${q(f.imgurl)},\n\t\tdesc: ${q(f.desc)},\n\t\tsiteurl: ${q(f.siteurl)},\n\t\ttags: [${(f.tags || []).map(q).join(', ')}],\n\t\tweight: ${weight},\n\t\tenabled: ${f.enabled ? 'true' : 'false'},\n\t\trss: ${q(f.rss)},\n\t},`;
}
routes.friends = async () => {
  view.innerHTML = `<div class="toolbar">
      <button class="btn" data-tab="mgr">🔗 友链管理</button>
      <button class="btn btn-ghost" data-tab="rss">📡 RSS 管理</button>
    </div><div id="friends-body"><div class="card"><p class="hint">正在读取仓库…</p></div></div>`;
  const body = $('#friends-body');
  const tabs = view.querySelectorAll('[data-tab]');
  // 缓存友链列表供 RSS tab 用
  let cachedList = null;
  const getList = async (force) => {
    if (cachedList && !force) return cachedList;
    const data = await ghGetFile(FRIENDS_PATH);
    cachedList = friendsParseBody(friendsExtract(data.text).body);
    return cachedList;
  };
  // 友链管理里保存后，清掉缓存让 RSS 页读到最新的
  const invalidateCache = () => { cachedList = null; };
  tabs.forEach((t) => { t.onclick = () => {
    tabs.forEach((x) => x.classList.add('btn-ghost'));
    t.classList.remove('btn-ghost');
    if (t.dataset.tab === 'mgr') friendsMgr(body, invalidateCache); else friendsRss(body, getList);
  }; });
  friendsMgr(body, invalidateCache);
};
/* RSS 管理：列出所有订阅源，一键测试，坏源不影响构建 */
async function friendsRss(body, getList) {
  body.innerHTML = '<div class="card"><p class="hint">正在读取友链 RSS 配置…</p></div>';
  let list;
  try { list = await getList(); }
  catch (e) { body.innerHTML = `<div class="card">读取失败：${esc(e.message)}</div>`; return; }
  const withRss = list.filter((f) => f.rss);
  const noRss = list.filter((f) => !f.rss);
  body.innerHTML = `<p class="hint">共 ${list.length} 个友链，${withRss.length} 个配了 RSS，${noRss.length} 个没配。构建时只拉取有效的源，坏源自动跳过、不影响构建。</p>
    <div id="rss-list"></div>
    ${noRss.length ? `<div class="card"><b>没配 RSS 的友链</b><p class="hint">${noRss.map((f) => esc(f.title)).join('、')}</p><p class="hint">去「友链管理」里编辑，给它们加上 RSS 地址。</p></div>` : ''}`;
  const box = body.querySelector('#rss-list');
  const testOne = async (f, btn, stEl) => {
    btn.disabled = true; stEl.innerHTML = '<span class="hint">测试中…</span>';
    try {
      const r = await fetch('/api/rss-test?url=' + encodeURIComponent(f.rss), {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const j = await r.json();
      if (j.ok) stEl.innerHTML = `<span style="color:#16a34a">✓ 有效（约 ${j.count} 篇）</span><span class="hint">${esc((j.titles || []).join(' / ').slice(0, 80))}</span>`;
      else stEl.innerHTML = `<span style="color:#dc2626">✗ ${esc(j.error || '无效')}</span><span class="hint">构建时会自动跳过，不影响其他源。</span>`;
    } catch (e) { stEl.innerHTML = `<span style="color:#dc2626">✗ 测试失败：${esc(e.message)}</span>`; }
    btn.disabled = false;
  };
  box.innerHTML = withRss.map((f, i) => `
    <div class="list-item" data-i="${i}">
      <span class="title">${esc(f.title)}</span><span class="meta">${esc(f.rss)}</span>
      <span class="rss-st hint"></span>
      <button class="btn btn-small" data-a="test">🔍 测试</button>
    </div>`).join('') || '<div class="card">还没有配 RSS 的友链</div>';
  box.querySelectorAll('.list-item').forEach((row) => {
    const f = withRss[+row.dataset.i];
    row.querySelector('[data-a=test]').onclick = (e) => testOne(f, e.target, row.querySelector('.rss-st'));
  });
  /* 一键全测 */
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.innerHTML = `<span class="spacer"></span><button class="btn btn-small" id="btn-rss-all">🔍 全部测试</button>`;
  box.before(bar);
  bar.querySelector('#btn-rss-all').onclick = async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = '测试中…';
    const rows = box.querySelectorAll('.list-item');
    for (const row of rows) {
      const f = withRss[+row.dataset.i];
      await testOne(f, row.querySelector('[data-a=test]'), row.querySelector('.rss-st'));
    }
    btn.disabled = false; btn.textContent = '🔍 全部测试';
    toast('全部测试完成');
  };
}
async function friendsMgr(body, invalidateCache) {
  body.innerHTML = '<div class="card"><p class="hint">正在读取仓库…</p></div>';
  let sha = null, head = '', tail = '', list = [], randomize = false;
  try {
    const data = await ghGetFile(FRIENDS_PATH);
    sha = data.sha;
    const parts = friendsExtract(data.text);
    head = parts.head; tail = parts.tail;
    list = friendsParseBody(parts.body);
    list.sort((a, b) => b.weight - a.weight);
    randomize = /randomizeSort\s*:\s*true/.test(data.text);
  } catch (e) { body.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  const dirty = { v: false };
  const markDirty = () => { dirty.v = true; $('#btn-fsave').disabled = false; };

  function rowHtml(f, i) {
    return `<div class="list-item friend-row" data-i="${i}">
      <img class="friend-avatar" src="${esc(f.imgurl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="title">${esc(f.title || '(无标题)')}${f.enabled ? '' : ' <span class="hint">(已停用)</span>'}</span>
      <span class="meta">${esc(f.siteurl)}</span>
      <button class="btn btn-small" data-a="up" title="上移">↑</button>
      <button class="btn btn-small" data-a="down" title="下移">↓</button>
      <button class="btn btn-small" data-a="toggle">${f.enabled ? '停用' : '启用'}</button>
      <button class="btn btn-small" data-a="edit">编辑</button>
      <button class="btn btn-small btn-danger" data-a="del">删除</button>
    </div>
    <div class="friend-form hidden" data-form="${i}"></div>`;
  }
  function formHtml(f) {
    const inp = (k, label, v, ph) => `<div class="field"><label>${label}</label><input type="text" data-k="${k}" value="${esc(v || '')}" placeholder="${ph || ''}"></div>`;
    return `<div class="card"><div class="grid2">
      ${inp('title', '站名 *', f.title)}
      ${inp('siteurl', '网址 *', f.siteurl, 'https://')}
      ${inp('imgurl', '头像 URL', f.imgurl)}
      <div class="field"><label>RSS（用于 moments 聚合）</label>
        <div class="cover-row"><input type="text" data-k="rss" value="${esc(f.rss || '')}" placeholder="https://…/rss.xml" style="flex:1">
        <button class="btn btn-small" data-a="rsstest" type="button">🔍 测试</button></div>
        <div class="hint rss-test-tip"></div></div>
      ${inp('desc', '描述', f.desc)}
      ${inp('tags', '标签（逗号分隔）', (f.tags || []).join(', '))}
    </div>
    <label class="pill${f.enabled ? ' on' : ''}"><input type="checkbox" data-k="enabled"${f.enabled ? ' checked' : ''}>启用</label>
    <div class="toolbar">
      <button class="btn btn-small btn-ghost" data-a="clipfill" type="button">📋 剪切板填充</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-ghost" data-a="cancel">取消</button>
      <button class="btn btn-small" data-a="oksave">确定</button>
    </div>
    <div class="clip-paste hidden">
      <div class="field"><label>浏览器没读到剪切板，把对方的「本站信息」粘贴到这里</label>
      <textarea class="clip-ta" rows="4" placeholder="站点名称：……&#10;站点链接：https://……&#10;头像链接：https://……&#10;站点描述：……"></textarea></div>
      <button class="btn btn-small" data-a="clipgo" type="button">按粘贴内容填充</button>
    </div></div>`;
  }
  async function runRssTest(formEl) {
    const btn = formEl.querySelector('[data-a=rsstest]');
    const url = formEl.querySelector('[data-k=rss]').value.trim();
    const tip = formEl.querySelector('.rss-test-tip');
    if (!url) { tip.textContent = '先填 RSS 地址'; return; }
    if (btn) btn.disabled = true;
    tip.textContent = '测试中…';
    try {
      const r = await fetch('/api/rss-test?url=' + encodeURIComponent(url), { headers: { Authorization: `Bearer ${token()}` } });
      const j = await r.json();
      tip.innerHTML = j.ok
        ? `<span style="color:#16a34a">✓ 有效，约 ${j.count} 篇</span>`
        : `<span style="color:#dc2626">✗ ${esc(j.error || '无效')}（构建时会自动跳过）</span>`;
    } catch (e) { tip.textContent = '测试失败：' + e.message; }
    if (btn) btn.disabled = false;
  }
  function wireRssTest(formEl) {
    const btn = formEl.querySelector('[data-a=rsstest]');
    if (!btn) return;
    btn.onclick = () => runRssTest(formEl);
  }
  /* 手动添加/编辑：网址填完（失焦）后自动探测 RSS，与剪切板填充同一套探测；
     测通自动填入并直接跑测试出「✓ 有效，约 N 篇」；手填过的 RSS 不覆盖 */
  function wireRssAuto(formEl) {
    const urlEl = formEl.querySelector('[data-k=siteurl]');
    const rssEl = formEl.querySelector('[data-k=rss]');
    const tip = formEl.querySelector('.rss-test-tip');
    if (!urlEl || !rssEl || !tip) return;
    rssEl.addEventListener('input', () => { delete rssEl.dataset.auto; });
    let probing = false;
    const tryProbe = async () => {
      const site = urlEl.value.trim();
      if (!site || probing) return;
      let u0; try { u0 = new URL(site); } catch (e) { return; }
      if (!/^https?:$/.test(u0.protocol)) return;
      const cur = rssEl.value.trim();
      if (cur && !rssEl.dataset.auto) return;
      if (rssEl.dataset.probedFor === site) return;
      if (cur && rssEl.dataset.autoFor === site) return;
      probing = true;
      rssEl.dataset.probedFor = site;
      tip.textContent = '🔍 正在自动探测这个站点的 RSS…';
      const found = await probeRss(site);
      probing = false;
      if (urlEl.value.trim() !== site) return;
      if (found) {
        rssEl.value = found;
        rssEl.dataset.auto = '1'; rssEl.dataset.autoFor = site;
        runRssTest(formEl);
      } else {
        tip.innerHTML = '<span style="color:#dc2626">✗ 没探测到 RSS（常用路径都试过了），可以手动填</span>';
      }
    };
    urlEl.addEventListener('change', tryProbe);
  }
  function render() {
    const box = $('#friend-list');
    box.innerHTML = list.map(rowHtml).join('');
    box.querySelectorAll('.friend-row').forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; markDirty(); render(); } };
      row.querySelector('[data-a=down]').onclick = () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; markDirty(); render(); } };
      row.querySelector('[data-a=toggle]').onclick = () => { list[i].enabled = !list[i].enabled; markDirty(); render(); };
      row.querySelector('[data-a=del]').onclick = () => { if (confirm(`删除友链「${list[i].title}」？`)) { list.splice(i, 1); markDirty(); render(); } };
      row.querySelector('[data-a=edit]').onclick = () => {
        const fe = box.querySelector(`[data-form="${i}"]`);
        fe.innerHTML = formHtml(list[i]);
        fe.classList.remove('hidden');
        wireRssTest(fe);
        wireRssAuto(fe);
        wireClipFill(fe);
        fe.querySelector('[data-a=cancel]').onclick = () => { fe.classList.add('hidden'); fe.innerHTML = ''; };
        fe.querySelector('[data-a=oksave]').onclick = () => {
          const f = list[i];
          fe.querySelectorAll('[data-k]').forEach((el) => {
            const k = el.dataset.k;
            if (k === 'enabled') f.enabled = el.checked;
            else if (k === 'tags') f.tags = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
            else f[k] = el.value.trim();
          });
          if (!f.title || !f.siteurl) { toast('站名和网址必填', true); return; }
          markDirty(); render(); toast('已更新（记得点保存）');
        };
      };
    });
    $('#friend-count').textContent = `共 ${list.length} 个`;
  }

  body.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-fadd">＋ 添加友链</button>
      <span class="spacer"></span><span class="hint" id="friend-count"></span>
      <label class="pill" id="pill-random" title="开启后友链页每次构建随机展示顺序"><input type="checkbox" id="chk-random">🔀 随机排序</label>
      <button class="btn" id="btn-fsave" disabled>💾 保存到仓库</button>
    </div>
    <p class="hint">↑↓ 调整顺序（保存后按此顺序展示）；停用=前台隐藏但保留；🔀 随机排序开启后每次构建随机展示，↑↓ 顺序暂时不生效。</p>
    <div id="friend-new"></div>
    <div id="friend-list"></div>`;
  render();
  const chkRandom = $('#chk-random');
  chkRandom.checked = randomize;
  $('#pill-random').classList.toggle('on', randomize);
  chkRandom.onchange = () => {
    randomize = chkRandom.checked;
    $('#pill-random').classList.toggle('on', randomize);
    markDirty();
  };

  $('#btn-fadd').onclick = () => {
    const box = $('#friend-new');
    if (box.innerHTML) { box.innerHTML = ''; return; }
    box.innerHTML = formHtml({ title: '', siteurl: '', imgurl: '', desc: '', tags: ['Blog'], rss: '', enabled: true });
    wireRssTest(box);
    wireRssAuto(box);
    wireClipFill(box);
    box.querySelector('[data-a=cancel]').onclick = () => { box.innerHTML = ''; };
    box.querySelector('[data-a=oksave]').onclick = () => {
      const f = { tags: [] };
      box.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        if (k === 'enabled') f.enabled = el.checked;
        else if (k === 'tags') f.tags = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        else f[k] = el.value.trim();
      });
      if (!f.title || !f.siteurl) { toast('站名和网址必填', true); return; }
      list.push(f); box.innerHTML = ''; markDirty(); render(); toast('已添加（记得点保存）');
    };
  };
  $('#btn-fsave').onclick = async () => {
    const btn = $('#btn-fsave');
    btn.disabled = true;
    try {
      const n = list.length;
      const body = list.map((f, i) => friendToTs(f, n - i)).join('\n');
      let outHead = head;
      if (/randomizeSort\s*:\s*(true|false)/.test(outHead)) {
        outHead = outHead.replace(/randomizeSort\s*:\s*(true|false)/, `randomizeSort: ${randomize}`);
      }
      const text = outHead + '\n' + body + '\n' + tail;
      const r = await saveWithLog(FRIENDS_PATH, text, sha, '更新友链 [管理台]', { type: '友链', action: '更新', target: '友链配置' });
      sha = r.content.sha;
      dirty.v = false;
      if (invalidateCache) invalidateCache();
      toast('已保存，构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 书签导航管理 ---------- */
const BOOKNAV_PATH = 'src/config/booknavConfig.ts';
function booknavExtract(src) {
  const ks = src.indexOf('export const booknavConfig');
  if (ks < 0) throw new Error('找不到 booknavConfig');
  const eq = src.indexOf('=', ks);
  const as = src.indexOf('[', eq);
  let depth = 0, i = as;
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (!depth) break; }
  }
  return { head: src.slice(0, as + 1), body: src.slice(as + 1, i), tail: src.slice(i) };
}
function topBlocks(body) {
  const blocks = [];
  let i = 0;
  while (i < body.length) {
    const s = body.indexOf('{', i);
    if (s < 0) break;
    let depth = 0, j = s, inStr = null;
    for (; j < body.length; j++) {
      const c = body[j];
      if (inStr) { if (c === inStr && body[j - 1] !== '\\') inStr = null; }
      else if (c === '"' || c === "'") inStr = c;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) break; }
    }
    blocks.push(body.slice(s, j + 1));
    i = j + 1;
  }
  return blocks;
}
function booknavParse(src) {
  const { head, body, tail } = booknavExtract(src);
  const get = (block, k) => {
    const mm = block.match(new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return mm ? mm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
  };
  const groups = topBlocks(body).map((gb) => {
    const itemsM = gb.match(/items\s*:\s*\[/);
    let items = [];
    if (itemsM) {
      const as = gb.indexOf('[', itemsM.index);
      let depth = 0, i = as, inStr = null;
      for (; i < gb.length; i++) {
        const c = gb[i];
        if (inStr) { if (c === inStr && gb[i - 1] !== '\\') inStr = null; }
        else if (c === '"' || c === "'") inStr = c;
        else if (c === '[') depth++;
        else if (c === ']') { depth--; if (!depth) break; }
      }
      const itemsBody = gb.slice(as + 1, i);
      items = topBlocks(itemsBody).map((ib) => ({
        title: get(ib, 'title'), url: get(ib, 'url'), desc: get(ib, 'desc'),
        icon: get(ib, 'icon'),
        weight: parseInt((ib.match(/weight\s*:\s*(\d+)/) || [])[1] || '0', 10),
      }));
    }
    return {
      id: get(gb, 'id'), name: get(gb, 'name'), icon: get(gb, 'icon'), desc: get(gb, 'desc'),
      weight: parseInt((gb.match(/weight\s*:\s*(\d+)/) || [])[1] || '0', 10),
      items,
    };
  });
  return { head, tail, groups };
}
function booknavToTs(groups) {
  const q = (s) => `"${String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = [];
  groups.forEach((g, gi) => {
    lines.push(`\t{`);
    lines.push(`\t\tid: ${q(g.id || 'g' + Date.now())},`);
    lines.push(`\t\tname: ${q(g.name)},`);
    if (g.icon) lines.push(`\t\ticon: ${q(g.icon)},`);
    if (g.desc) lines.push(`\t\tdesc: ${q(g.desc)},`);
    lines.push(`\t\tweight: ${groups.length - gi},`);
    lines.push(`\t\titems: [`);
    g.items.forEach((it, ii) => {
      lines.push(`\t\t\t{`);
      lines.push(`\t\t\t\ttitle: ${q(it.title)},`);
      lines.push(`\t\t\t\turl: ${q(it.url)},`);
      if (it.desc) lines.push(`\t\t\t\tdesc: ${q(it.desc)},`);
      if (it.icon) lines.push(`\t\t\t\ticon: ${q(it.icon)},`);
      lines.push(`\t\t\t\tweight: ${g.items.length - ii},`);
      lines.push(`\t\t\t},`);
    });
    lines.push(`\t\t],`);
    lines.push(`\t},`);
  });
  return lines.join('\n');
}
routes.booknav = async () => {
  view.innerHTML = '<div class="card"><h2>🔖 书签导航</h2><p class="hint">正在读取仓库…</p></div>';
  let sha = null, head = '', tail = '', groups = [];
  try {
    const data = await ghGetFile(BOOKNAV_PATH);
    sha = data.sha;
    const p = booknavParse(data.text);
    head = p.head; tail = p.tail; groups = p.groups;
    groups.sort((a, b) => b.weight - a.weight);
    groups.forEach((g) => g.items.sort((a, b) => b.weight - a.weight));
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  const markDirty = () => { $('#btn-bsave').disabled = false; };
  const openGroups = new Set(); // 书签分组默认全折叠，这里存已展开的分组 id
  const itemForm = (it) => {
    const inp = (k, label, v, ph) => `<div class="field"><label>${label}</label><input type="text" data-k="${k}" value="${esc(v || '')}" placeholder="${ph || ''}"></div>`;
    return `<div class="card">${inp('title', '标题 *', it.title)}${inp('url', '网址 *', it.url, 'https://')}${inp('desc', '描述', it.desc)}${inp('icon', '图标（留空自动获取 favicon）', it.icon, 'material-symbols:…')}
    <div class="toolbar"><span class="spacer"></span><button class="btn btn-small btn-ghost" data-a="cancel">取消</button><button class="btn btn-small" data-a="ok">确定</button></div></div>`;
  };
  const groupForm = (g) => {
    const inp = (k, label, v, ph) => `<div class="field"><label>${label}</label><input type="text" data-k="${k}" value="${esc(v || '')}" placeholder="${ph || ''}"></div>`;
    return `<div class="card"><div class="grid2">${inp('name', '分组名 *', g.name)}${inp('id', 'ID（英文唯一）', g.id)}</div><div class="grid2">${inp('icon', '图标', g.icon, 'material-symbols:…')}${inp('desc', '描述', g.desc)}</div>
    <div class="toolbar"><span class="spacer"></span><button class="btn btn-small btn-ghost" data-a="cancel">取消</button><button class="btn btn-small" data-a="ok">确定</button></div></div>`;
  };
  function readForm(box) {
    const o = {};
    box.querySelectorAll('[data-k]').forEach((el) => { o[el.dataset.k] = el.value.trim(); });
    return o;
  }
  function render() {
    const box = $('#booknav-list');
    box.innerHTML = groups.map((g, gi) => `
      <div class="card" data-g="${gi}">
        <div class="toolbar"><b>📁 ${esc(g.name || '(未命名)')} <span class="hint">${g.items.length} 个书签</span></b><span class="spacer"></span>
          <button class="btn btn-small" data-a="gtoggle">${openGroups.has(g.id) ? '收起 ▴' : '展开 ▾'}</button>
          <button class="btn btn-small" data-a="gup">↑</button><button class="btn btn-small" data-a="gdown">↓</button>
          <button class="btn btn-small" data-a="gedit">编辑分组</button><button class="btn btn-small" data-a="iadd">＋书签</button>
          <button class="btn btn-small btn-danger" data-a="gdel">删分组</button></div>
        <div class="gform hidden"></div>
        <div class="gitems${openGroups.has(g.id) ? '' : ' hidden'}">
        ${g.items.map((it, ii) => `
          <div class="list-item" data-ii="${ii}">
            <span class="title">${esc(it.title || '(无标题)')}</span><span class="meta">${esc(it.url)}</span>
            <button class="btn btn-small" data-a="iup">↑</button><button class="btn btn-small" data-a="idown">↓</button>
            <button class="btn btn-small" data-a="iedit">编辑</button><button class="btn btn-small btn-danger" data-a="idel">删除</button>
          </div><div class="iform hidden"></div>`).join('')}
        <div class="inew"></div>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-g]').forEach((card) => {
      const gi = +card.dataset.g, g = groups[gi];
      const qsa = (s) => card.querySelector(s);
      qsa('[data-a=gup]').onclick = () => { if (gi > 0) { [groups[gi - 1], groups[gi]] = [groups[gi], groups[gi - 1]]; markDirty(); render(); } };
      qsa('[data-a=gdown]').onclick = () => { if (gi < groups.length - 1) { [groups[gi + 1], groups[gi]] = [groups[gi], groups[gi + 1]]; markDirty(); render(); } };
      qsa('[data-a=gtoggle]').onclick = () => { openGroups.has(g.id) ? openGroups.delete(g.id) : openGroups.add(g.id); render(); };
      qsa('[data-a=gdel]').onclick = () => { if (confirm(`删除分组「${g.name}」（含 ${g.items.length} 个书签）？`)) { groups.splice(gi, 1); markDirty(); render(); } };
      qsa('[data-a=gedit]').onclick = () => {
        const f = qsa('.gform'); f.innerHTML = groupForm(g); f.classList.remove('hidden');
        f.querySelector('[data-a=cancel]').onclick = () => { f.classList.add('hidden'); f.innerHTML = ''; };
        f.querySelector('[data-a=ok]').onclick = () => {
          const o = readForm(f);
          if (!o.name) { toast('分组名必填', true); return; }
          Object.assign(g, o); if (!g.id) g.id = 'g' + Date.now();
          markDirty(); render(); toast('已更新（记得点保存）');
        };
      };
      qsa('[data-a=iadd]').onclick = () => {
        if (!openGroups.has(g.id)) { openGroups.add(g.id); render(); } // 折叠时先展开再出表单
        const nw = box.querySelector(`[data-g="${gi}"] .inew`);
        if (!nw) return;
        if (nw.innerHTML) { nw.innerHTML = ''; return; }
        nw.innerHTML = itemForm({ title: '', url: '', desc: '', icon: '' });
        nw.querySelector('[data-a=cancel]').onclick = () => { nw.innerHTML = ''; };
        nw.querySelector('[data-a=ok]').onclick = () => {
          const o = readForm(nw);
          if (!o.title || !o.url) { toast('标题和网址必填', true); return; }
          g.items.push(o); nw.innerHTML = ''; markDirty(); render(); toast('已添加（记得点保存）');
        };
      };
      card.querySelectorAll('.list-item').forEach((row) => {
        const ii = +row.dataset.ii, it = g.items[ii];
        const iform = row.nextElementSibling;
        row.querySelector('[data-a=iup]').onclick = () => { if (ii > 0) { [g.items[ii - 1], g.items[ii]] = [g.items[ii], g.items[ii - 1]]; markDirty(); render(); } };
        row.querySelector('[data-a=idown]').onclick = () => { if (ii < g.items.length - 1) { [g.items[ii + 1], g.items[ii]] = [g.items[ii], g.items[ii + 1]]; markDirty(); render(); } };
        row.querySelector('[data-a=idel]').onclick = () => { if (confirm(`删除书签「${it.title}」？`)) { g.items.splice(ii, 1); markDirty(); render(); } };
        row.querySelector('[data-a=iedit]').onclick = () => {
          iform.innerHTML = itemForm(it); iform.classList.remove('hidden');
          iform.querySelector('[data-a=cancel]').onclick = () => { iform.classList.add('hidden'); iform.innerHTML = ''; };
          iform.querySelector('[data-a=ok]').onclick = () => {
            const o = readForm(iform);
            if (!o.title || !o.url) { toast('标题和网址必填', true); return; }
            Object.assign(it, o); markDirty(); render(); toast('已更新（记得点保存）');
          };
        };
      });
    });
    $('#booknav-count').textContent = `共 ${groups.length} 个分组 / ${groups.reduce((s, g) => s + g.items.length, 0)} 个书签`;
  }
  view.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-gadd">＋ 添加分组</button><button class="btn btn-ghost" id="btn-ball">全部展开</button><span class="spacer"></span>
      <span class="hint" id="booknav-count"></span><button class="btn" id="btn-bsave" disabled>💾 保存到仓库</button>
    </div><p class="hint">↑↓ 调整顺序（保存后按此顺序展示）。图标留空则自动获取目标站 favicon。</p>
    <div id="booknav-new"></div><div id="booknav-list"></div>`;
  render();
  $('#btn-ball').onclick = () => {
    const allOpen = groups.length > 0 && groups.every((g) => openGroups.has(g.id));
    openGroups.clear();
    if (!allOpen) groups.forEach((g) => openGroups.add(g.id));
    $('#btn-ball').textContent = allOpen ? '全部展开' : '全部收起';
    render();
  };
  $('#btn-gadd').onclick = () => {
    const nw = $('#booknav-new');
    if (nw.innerHTML) { nw.innerHTML = ''; return; }
    nw.innerHTML = groupForm({ name: '', id: '', icon: '', desc: '' });
    nw.querySelector('[data-a=cancel]').onclick = () => { nw.innerHTML = ''; };
    nw.querySelector('[data-a=ok]').onclick = () => {
      const o = readForm(nw);
      if (!o.name) { toast('分组名必填', true); return; }
      o.id = o.id || 'g' + Date.now(); o.items = [];
      groups.push(o); nw.innerHTML = ''; markDirty(); render(); toast('已添加（记得点保存）');
    };
  };
  $('#btn-bsave').onclick = async () => {
    const btn = $('#btn-bsave'); btn.disabled = true;
    try {
      const text = head + '\n' + booknavToTs(groups) + '\n' + tail;
      const r = await saveWithLog(BOOKNAV_PATH, text, sha, '更新书签导航 [管理台]', { type: '书签', action: '更新', target: '书签导航' });
      sha = r.content.sha; toast('已保存，构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 控制台导航栏管理 ---------- */
const NAVMGR_PATH = 'public/admin/config.js';
routes.navmgr = async () => {
  view.innerHTML = '<div class="card"><h2>🧭 导航</h2><p class="hint">正在读取配置…</p></div>';
  let sha = null, cfgText = '';
  try {
    const data = await ghGetFile(NAVMGR_PATH);
    sha = data.sha; cfgText = data.text;
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  // 解析当前 navLayout
  const parseLayout = (t) => {
    const m = t.match(/navLayout\s*:\s*\{([\s\S]*?)\n\s*\},/);
    if (!m) return null;
    const blk = m[1];
    const arr = (k) => { const mm = blk.match(new RegExp(k + '\\s*:\\s*\\[([^\\]]*)\\]')); return mm ? mm[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []; };
    const labels = {};
    const lm = blk.match(/labels\s*:\s*\{([^}]*)\}/);
    if (lm) lm[1].split(',').forEach((p) => { const mm = p.match(/(\w+)\s*:\s*['"]([^'"]*)['"]/); if (mm) labels[mm[1]] = mm[2]; });
    return { primary: arr('primary'), secondary: arr('secondary'), homeCards: arr('homeCards'), labels };
  };
  let layout = parseLayout(cfgText) || { primary: [], secondary: [], homeCards: [], labels: {} };
  const defs = navDefs();
  const allKeys = Object.keys(defs);
  // 补齐漏掉的 key
  allKeys.forEach((k) => { if (!layout.primary.includes(k) && !layout.secondary.includes(k)) layout.secondary.push(k); });
  layout.primary = layout.primary.filter((k) => allKeys.includes(k));
  layout.secondary = layout.secondary.filter((k) => allKeys.includes(k));
  /* 首页卡片可选项（与首页 CARD_DEFS 对齐）；配置里没写过 homeCards 时用默认全套 */
  const HOME_CARD_KEYS = ['posts', 'dynamic', 'projects', 'spec', 'friends', 'gallery', 'timeline', 'thoughts', 'music', 'waline', 'blog', 'umami', 'stats', 'search', 'medialib', 'tags', 'fonts', 'theme', 'images', 'announce', 'booknav', 'navmgr', 'videos', 'profile', 'banner', 'sitenav'];
  layout.homeCards = (layout.homeCards || []).filter((k) => HOME_CARD_KEYS.includes(k));
  if (!/homeCards\s*:/.test(cfgText)) layout.homeCards = HOME_CARD_KEYS.slice();
  const markDirty = () => { $('#btn-navmsave').disabled = false; };
  const labelOf = (k) => layout.labels[k] || defs[k] || k;
  function render() {
    const box = $('#navm-list');
    const row = (k, listName, i, list) => `
      <div class="list-item" data-k="${k}">
        <span class="title">${esc(labelOf(k))}</span><span class="meta">${esc(k)}${layout.labels[k] ? ' · 已改名' : ''}</span>
        <button class="btn btn-small" data-a="up">↑</button><button class="btn btn-small" data-a="down">↓</button>
        <button class="btn btn-small" data-a="move">${listName === 'primary' ? '→ ···' : '← 主栏'}</button>
        <button class="btn btn-small" data-a="rename">改名</button>
      </div>`;
    box.innerHTML = `
      <div class="card"><b>主栏</b><p class="hint">直接显示在导航栏</p>
        ${layout.primary.map((k, i) => row(k, 'primary', i, layout.primary)).join('') || '<p class="hint">空</p>'}</div>
      <div class="card"><b>··· 更多</b><p class="hint">收进 ··· 下拉菜单（移动端换行全显）</p>
        ${layout.secondary.map((k, i) => row(k, 'secondary', i, layout.secondary)).join('') || '<p class="hint">空</p>'}</div>`;
    box.querySelectorAll('.list-item').forEach((el) => {
      const k = el.dataset.k;
      const inPrimary = layout.primary.includes(k);
      const list = inPrimary ? layout.primary : layout.secondary;
      const i = list.indexOf(k);
      el.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [list[i-1], list[i]] = [list[i], list[i-1]]; markDirty(); render(); } };
      el.querySelector('[data-a=down]').onclick = () => { if (i < list.length - 1) { [list[i+1], list[i]] = [list[i], list[i+1]]; markDirty(); render(); } };
      el.querySelector('[data-a=move]').onclick = () => {
        list.splice(i, 1);
        (inPrimary ? layout.secondary : layout.primary).push(k);
        markDirty(); render();
      };
      el.querySelector('[data-a=rename]').onclick = () => {
        const v = prompt(`「${defs[k]}」显示名称：`, labelOf(k));
        if (v === null) return;
        const name = v.trim();
        if (!name) delete layout.labels[k];
        else if (name !== defs[k]) layout.labels[k] = name;
        else delete layout.labels[k];
        markDirty(); render();
      };
    });
    /* 🏠 首页卡片区：单独容器，避免与上面导航行的接线互相干扰 */
    const homeBox = $('#navm-home');
    if (homeBox) {
      const homeRow = (k) => `
      <div class="list-item" data-hk="${k}">
        <span class="title">${esc(labelOf(k))}</span><span class="meta">${esc(k)}</span>
        <button class="btn btn-small" data-ha="up">↑</button><button class="btn btn-small" data-ha="down">↓</button>
        <button class="btn btn-small" data-ha="remove">移除</button>
      </div>`;
      const pool = HOME_CARD_KEYS.filter((k) => !layout.homeCards.includes(k));
      const poolRow = (k) => `
      <div class="list-item" data-pk="${k}">
        <span class="title">${esc(labelOf(k))}</span><span class="meta">${esc(k)}</span>
        <button class="btn btn-small" data-pa="add">＋ 加到首页</button>
      </div>`;
      homeBox.innerHTML = `
      <div class="card"><b>🏠 首页卡片</b><p class="hint">控制台首页显示哪些功能卡、什么顺序；移除只是不显示，功能还在导航里</p>
        ${layout.homeCards.map(homeRow).join('') || '<p class="hint">空（首页会回退为默认全套）</p>'}</div>
      ${pool.length ? `<div class="card"><b>未显示的卡片</b>${pool.map(poolRow).join('')}</div>` : ''}`;
      homeBox.querySelectorAll('[data-hk]').forEach((el) => {
        const k = el.dataset.hk;
        const i = layout.homeCards.indexOf(k);
        el.querySelector('[data-ha=up]').onclick = () => { if (i > 0) { [layout.homeCards[i - 1], layout.homeCards[i]] = [layout.homeCards[i], layout.homeCards[i - 1]]; markDirty(); render(); } };
        el.querySelector('[data-ha=down]').onclick = () => { if (i < layout.homeCards.length - 1) { [layout.homeCards[i + 1], layout.homeCards[i]] = [layout.homeCards[i], layout.homeCards[i + 1]]; markDirty(); render(); } };
        el.querySelector('[data-ha=remove]').onclick = () => { layout.homeCards.splice(i, 1); markDirty(); render(); };
      });
      homeBox.querySelectorAll('[data-pk]').forEach((el) => {
        const k = el.dataset.pk;
        el.querySelector('[data-pa=add]').onclick = () => { layout.homeCards.push(k); markDirty(); render(); };
      });
    }
  }
  view.innerHTML = `<div class="toolbar"><span class="spacer"></span>
      <button class="btn" id="btn-navmsave" disabled>💾 保存到仓库</button></div>
    <p class="hint">调整控制台导航栏：↑↓ 排序，→··· / ←主栏 切换分组，改名自定义显示名称。下方还能定首页显示哪些卡片。保存后所有设备生效。</p>
    <div id="navm-list"></div><div id="navm-home"></div><div id="navm-quick"></div>`;
  render();
  $('#btn-navmsave').onclick = async () => {
    const btn = $('#btn-navmsave'); btn.disabled = true;
    try {
      const q = (s) => `'${s}'`;
      const labelsStr = Object.entries(layout.labels).map(([k, v]) => `${k}: '${v.replace(/'/g, "\\'")}'`).join(', ');
      const newLayout = `navLayout: {\n    primary: [${layout.primary.map(q).join(', ')}],\n    secondary: [${layout.secondary.map(q).join(', ')}],\n    homeCards: [${layout.homeCards.map(q).join(', ')}],\n    labels: { ${labelsStr} },\n  },`;
      const text = cfgText.replace(/navLayout\s*:\s*\{[\s\S]*?\n\s*\},/, newLayout);
      if (text === cfgText) throw new Error('配置未变化或格式不匹配');
      const r = await saveWithLog(NAVMGR_PATH, text, sha, '更新控制台导航栏 [管理台]', { type: '导航', action: '更新', target: '控制台导航栏' });
      sha = r.content.sha; cfgText = text;
      // 同步到当前页
      CFG.navLayout = { primary: layout.primary.slice(), secondary: layout.secondary.slice(), homeCards: layout.homeCards.slice(), labels: { ...layout.labels } };
      toast('已保存，刷新页面生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  /* ---------- 右侧栏快捷入口（config.js 的 quickLinks；仅 side/mix 宽屏右栏可见） ---------- */
  const qUnesc = (v) => v.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const qEsc = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const parseQuick = (t) => {
    const m = t.match(/quickLinks\s*:\s*\[([\s\S]*?)\],\n/);
    if (!m) return null;
    const out = [];
    const re = /\{\s*icon:\s*'((?:[^'\\]|\\.)*)',\s*label:\s*'((?:[^'\\]|\\.)*)',\s*url:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
    let mm;
    while ((mm = re.exec(m[1]))) out.push({ icon: qUnesc(mm[1]), label: qUnesc(mm[2]), url: qUnesc(mm[3]) });
    return out.length ? out : null;
  };
  let quick = parseQuick(cfgText) || QUICK_LINK_DEFAULTS.map((x) => ({ ...x }));
  const qbox = $('#navm-quick');
  const readQuickRows = () => [...qbox.querySelectorAll('.q-row')].map((r) => ({
    icon: r.querySelector('.q-icon').value.trim(),
    label: r.querySelector('.q-label').value.trim(),
    url: r.querySelector('.q-url').value.trim(),
  })).filter((x) => x.label && x.url);
  function renderQuick() {
    qbox.innerHTML = `<div class="card"><h3>🧭 右侧栏快捷入口</h3>
      <p class="hint">仅在「左侧边栏 / 混合」布局、PC 宽屏（≥1680）时显示在右侧栏，平板和手机上看不到。链接以 http 开头会在新标签打开；站内页用 #/ 开头（如 #/stats）。</p>
      ${quick.map((l) => `<div class="list-item q-row">
        <input class="q-icon" type="text" value="${esc(l.icon)}" maxlength="4" title="图标 emoji">
        <input class="q-label" type="text" value="${esc(l.label)}" placeholder="名称">
        <input class="q-url" type="text" value="${esc(l.url)}" placeholder="https:// 或 #/">
        <button class="btn btn-small" data-qa="up">↑</button><button class="btn btn-small" data-qa="down">↓</button>
        <button class="btn btn-small btn-danger" data-qa="del">✕</button>
      </div>`).join('')}
      <div class="toolbar"><button class="btn btn-small" id="btn-qadd">＋ 添加入口</button><span class="spacer"></span><button class="btn" id="btn-qsave">💾 保存快捷入口</button></div>
    </div>`;
    qbox.querySelectorAll('.q-row').forEach((r, i) => {
      r.querySelector('[data-qa=up]').onclick = () => { quick = readQuickRows(); if (i > 0) { [quick[i - 1], quick[i]] = [quick[i], quick[i - 1]]; renderQuick(); } };
      r.querySelector('[data-qa=down]').onclick = () => { quick = readQuickRows(); if (i < quick.length - 1) { [quick[i + 1], quick[i]] = [quick[i], quick[i + 1]]; renderQuick(); } };
      r.querySelector('[data-qa=del]').onclick = () => { quick = readQuickRows(); quick.splice(i, 1); renderQuick(); };
    });
    qbox.querySelector('#btn-qadd').onclick = () => { quick = readQuickRows(); quick.push({ icon: '🔗', label: '', url: 'https://' }); renderQuick(); };
    qbox.querySelector('#btn-qsave').onclick = async () => {
      quick = readQuickRows();
      if (!quick.length) { toast('至少留一个入口', true); return; }
      const block = '  quickLinks: [\n' + quick.map((l) => `    { icon: '${qEsc(l.icon)}', label: '${qEsc(l.label)}', url: '${qEsc(l.url)}' },`).join('\n') + '\n  ],\n';
      let text;
      if (/quickLinks\s*:\s*\[[\s\S]*?\],\n/.test(cfgText)) {
        text = cfgText.replace(/quickLinks\s*:\s*\[[\s\S]*?\],\n/, block);
      } else {
        const m2 = cfgText.match(/navLayout\s*:\s*\{[\s\S]*?\n  \},\n/);
        if (!m2) { toast('配置格式对不上，没改动', true); return; }
        text = cfgText.replace(m2[0], m2[0] + '\n' + block);
      }
      try {
        const r = await saveWithLog(NAVMGR_PATH, text, sha, '更新右侧栏快捷入口 [管理台]', { type: '导航', action: '改快捷入口', target: `${quick.length} 个入口` });
        sha = r.content.sha; cfgText = text;
        CFG.quickLinks = quick.map((x) => ({ ...x }));
        renderRailLinks();
        toast('快捷入口已保存（仅左侧边栏/混合布局的宽屏右栏可见）');
      } catch (e) { toast(e.message, true); }
    };
  }
  renderQuick();
};

/* ---------- 站点导航管理：src/config/navBarConfig.ts（博客顶栏，非控制台自己的导航） ---------- */
const SITENAV_PATH = 'src/config/navBarConfig.ts';
/* 找一段 [...] 的配平结尾下标（字符串感知） */
function snBracketEnd(s, start) {
  let depth = 0, inStr = false, escN = false, q = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (escN) escN = false; else if (c === '\\') escN = true; else if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) return i; }
  }
  return -1;
}
function parseSiteNavItem(raw) {
  let children = [];
  let rest = raw;
  const ci = raw.indexOf('children:');
  if (ci >= 0) {
    const s = raw.indexOf('[', ci);
    const e = s >= 0 ? snBracketEnd(raw, s) : -1;
    if (e > s) {
      children = splitBraceObjects(raw.slice(s + 1, e)).map(parseSiteNavItem);
      rest = raw.slice(0, ci) + raw.slice(e + 1);
    }
  }
  return {
    name: getStrField(rest, 'name'), url: getStrField(rest, 'url'), icon: getStrField(rest, 'icon'),
    external: /external\s*:\s*true/.test(rest), pageKey: getStrField(rest, 'pageKey'),
    children, _drop: children.length > 0, _open: false,
  };
}
function parseSiteNav(src) {
  const li = src.indexOf('links:');
  if (li < 0) return null;
  const s = src.indexOf('[', li);
  const e = s >= 0 ? snBracketEnd(src, s) : -1;
  if (e < 0) return null;
  return splitBraceObjects(src.slice(s + 1, e)).map(parseSiteNavItem);
}
function siteNavItemTs(it, indent) {
  const t = '\t'.repeat(indent);
  let s = `${t}{\n${t}\tname: "${tsEsc(it.name)}",\n${t}\turl: "${tsEsc(it.url)}",\n`;
  if (it.external) s += `${t}\texternal: true,\n`;
  if (it.icon) s += `${t}\ticon: "${tsEsc(it.icon)}",\n`;
  if (it.pageKey) s += `${t}\tpageKey: "${tsEsc(it.pageKey)}",\n`;
  if (it._drop && it.children && it.children.length) {
    s += `${t}\tchildren: [\n${it.children.map((c) => siteNavItemTs(c, indent + 2)).join('\n')}\n${t}\t],\n`;
  }
  return s + `${t}}},`;
}
function buildSiteNavTs(items) {
  return `import {
\ttype NavBarConfig,
\ttype NavBarLink,
\ttype NavBarSearchConfig,
\tNavBarSearchMethod,
} from "../types/navBarConfig";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// 本文件为纯数据格式，由 Alexander Console「🌐 站点导航」页维护（增删/排序/改名）
// ============================================================================
export const navBarConfig: NavBarConfig = {
\tlinks: [
${items.map((it) => siteNavItemTs(it, 2)).join('\n')}
\t],
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
\tmethod: NavBarSearchMethod.PageFind,
};
`;
}
routes.sitenav = async () => {
  view.innerHTML = '<p class="hint">加载中…</p>';
  let sha = null, items = null;
  try {
    const data = await ghGetFile(SITENAV_PATH);
    sha = data.sha;
    items = parseSiteNav(data.text);
    if (!items || !items.length) throw new Error('没解析出导航项，文件格式可能变了，先别保存');
  } catch (e) { view.innerHTML = `<p class="hint">加载失败：${esc(e.message)}</p>`; return; }
  view.innerHTML = `
    <div class="toolbar"><button class="btn" id="btn-sn-add">＋ 添加顶级项</button><span class="spacer"></span>
      <button class="btn" id="btn-sn-save">💾 保存到仓库</button></div>
    <div class="card"><h2>🌐 站点导航 <span class="sub">${SITENAV_PATH}</span></h2>
    <p class="hint">这里管的是<b>博客 lanerc.me 顶部</b>的导航栏（不是控制台自己的）。顶级项和下拉项都能 ↑↓ 排序、编辑、删除；带下拉的项点「管理下拉」展开。纯父项 URL 填 #。图标填 Iconify 名（如 material-symbols:home）。保存后重新构建生效。<b>注意：这里只加菜单入口、不生成页面，新栏目先建单页再挂。</b></p>
    <div id="sn-list"></div></div>`;
  const render = () => {
    $('#sn-list').innerHTML = items.map((it, i) => `
      <div class="card">
        <div class="list-item">
          <span class="title">${esc(it.name)}</span><span class="meta">${esc(it.url)}${it._drop ? ` · 下拉 ${it.children.length} 项` : ''}${it.external ? ' · 外链' : ''}</span><span class="spacer"></span>
          <button class="mini-btn" data-ta="up" data-i="${i}">↑</button><button class="mini-btn" data-ta="down" data-i="${i}">↓</button>
          <button class="mini-btn" data-ta="edit" data-i="${i}">编辑</button>
          ${it._drop ? `<button class="mini-btn" data-ta="toggle" data-i="${i}">${it._open ? '收起下拉' : '管理下拉'}</button>` : ''}
          <button class="mini-btn danger" data-ta="del" data-i="${i}">删除</button>
        </div>
        ${it._drop && it._open ? `<div class="sn-kids">${it.children.map((c, j) => `
          <div class="list-item">
            <span class="title">${esc(c.name)}</span><span class="meta">${esc(c.url)}${c.external ? ' · 外链' : ''}</span><span class="spacer"></span>
            <button class="mini-btn" data-ca="up" data-i="${i}" data-j="${j}">↑</button><button class="mini-btn" data-ca="down" data-i="${i}" data-j="${j}">↓</button>
            <button class="mini-btn" data-ca="edit" data-i="${i}" data-j="${j}">编辑</button>
            <button class="mini-btn danger" data-ca="del" data-i="${i}" data-j="${j}">删除</button>
          </div>`).join('') || '<p class="hint">还没有下拉项</p>'}
          <button class="mini-btn" data-addkid="${i}">＋ 添加下拉项</button></div>` : ''}
      </div>`).join('');
    $('#sn-list').querySelectorAll('[data-ta]').forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.i, 10), act = b.dataset.ta, it = items[i];
        if (act === 'up' && i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); }
        if (act === 'down' && i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); }
        if (act === 'toggle') { it._open = !it._open; render(); }
        if (act === 'edit') openSnEditor(it, false, render);
        if (act === 'del') {
          if (!confirm(`删除顶级项「${it.name}」？${it._drop && it.children.length ? `\n它的 ${it.children.length} 个下拉项会一起删掉。` : ''}`)) return;
          items.splice(i, 1); render();
        }
      };
    });
    $('#sn-list').querySelectorAll('[data-ca]').forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.i, 10), j = parseInt(b.dataset.j, 10), act = b.dataset.ca;
        const kids = items[i].children, c = kids[j];
        if (act === 'up' && j > 0) { [kids[j - 1], kids[j]] = [kids[j], kids[j - 1]]; render(); }
        if (act === 'down' && j < kids.length - 1) { [kids[j + 1], kids[j]] = [kids[j], kids[j + 1]]; render(); }
        if (act === 'edit') openSnEditor(c, true, render);
        if (act === 'del') { if (confirm(`删除下拉项「${c.name}」？`)) { kids.splice(j, 1); render(); } }
      };
    });
    $('#sn-list').querySelectorAll('[data-addkid]').forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.addkid, 10);
        const draft = { name: '', url: '', icon: '', external: false, pageKey: '', children: [], _drop: false, _open: false };
        openSnEditor(draft, true, () => { items[i].children.push(draft); items[i]._open = true; render(); });
      };
    });
  };
  const openSnEditor = (target, isChild, onOk) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal card">
        <h3>${isChild ? '下拉项' : '导航项'}编辑</h3>
        <div class="field"><label>名称 *</label><input id="sn-name" value="${esc(target.name || '')}" placeholder="如：文章"></div>
        <div class="field"><label>链接 URL *</label><input id="sn-url" value="${esc(target.url || '')}" placeholder="/archive/ 或 https://…；纯下拉父项填 #"></div>
        <p class="hint">说明：只加菜单链接，不生成页面；新栏目先建「单页」，地址不存在会 404。</p>
        <div class="field"><label>图标（Iconify 名） <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">🔍 去 Iconify 找图标 ↗</a></label><input id="sn-icon" value="${esc(target.icon || '')}" placeholder="material-symbols:home"></div>
        <div class="field"><label>pageKey（可空，主题标当前页用）</label><input id="sn-pagekey" value="${esc(target.pageKey || '')}" placeholder="friends"></div>
        <div class="field"><label><input type="checkbox" id="sn-ext" ${target.external ? 'checked' : ''}> 外链（新窗口打开）</label></div>
        ${isChild ? '' : `<div class="field"><label><input type="checkbox" id="sn-drop" ${target._drop ? 'checked' : ''}> 这是下拉父项（能在下面加子项）</label></div>`}
        <div class="toolbar"><span class="spacer"></span>
          <button class="btn btn-ghost" id="sn-cancel">取消</button>
          <button class="btn" id="sn-ok">确定</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#sn-cancel').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#sn-ok').onclick = () => {
      const name = overlay.querySelector('#sn-name').value.trim();
      const url = overlay.querySelector('#sn-url').value.trim();
      if (!name || !url) { toast('名称和 URL 必填', true); return; }
      if (!isChild) {
        const drop = overlay.querySelector('#sn-drop').checked;
        if (!drop && target._drop && target.children && target.children.length) {
          if (!confirm(`取消下拉会删掉已有的 ${target.children.length} 个子项，确定？`)) return;
          target.children = [];
        }
        target._drop = drop;
        if (drop) target._open = true;
      }
      target.name = name; target.url = url;
      target.icon = overlay.querySelector('#sn-icon').value.trim();
      target.pageKey = overlay.querySelector('#sn-pagekey').value.trim();
      target.external = overlay.querySelector('#sn-ext').checked;
      overlay.remove();
      onOk();
    };
  };
  render();
  $('#btn-sn-add').onclick = () => {
    const draft = { name: '', url: '', icon: '', external: false, pageKey: '', children: [], _drop: false, _open: false };
    openSnEditor(draft, false, () => { items.push(draft); render(); });
  };
  $('#btn-sn-save').onclick = async () => {
    const btn = $('#btn-sn-save');
    btn.disabled = true;
    try {
      const r = await saveWithLog(SITENAV_PATH, buildSiteNavTs(items), sha, '更新站点导航 [管理台]', { type: '导航', action: '更新', target: '站点导航' });
      sha = r.content.sha;
      toast('站点导航已保存，重新构建网站后生效');
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };
};

/* ---------- 时间线管理 ---------- */
/* ---------- 列表型编辑器（时间线/碎碎念）本地草稿 ----------
 * 两层：① items 未保存改动（点了「确定」没点「保存到仓库」就退出也不丢）
 *       ② 弹窗里写一半的字段（App 被杀也不丢；仅草稿 idx 与当前编辑条目一致时恢复）
 * 草稿只存本机浏览器；与仓库内容一致时自动清除；正式保存成功后清除。 */
function makeListDraft(listKey, modalKey) {
  return {
    saveItems(items, baselineJson, baseSha) {
      try {
        if (JSON.stringify(items) === baselineJson) { localStorage.removeItem(listKey); return; }
        localStorage.setItem(listKey, JSON.stringify({ ts: Date.now(), baseSha, items }));
      } catch (e) {}
    },
    /* 返回 null=无草稿；{stale:false}=版本没变可直接恢复；{stale:true}=配置已在别处更新过，别自动恢复 */
    loadItems(baselineJson, curSha) {
      try {
        const raw = localStorage.getItem(listKey);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.items)) {
          if (JSON.stringify(d.items) === baselineJson) { localStorage.removeItem(listKey); return null; }
          d.stale = !!(curSha && d.baseSha !== curSha);
          return d;
        }
        localStorage.removeItem(listKey);
      } catch (e) {}
      return null;
    },
    clearItems() { try { localStorage.removeItem(listKey); } catch (e) {} },
    saveModal(data) { try { localStorage.setItem(modalKey, JSON.stringify({ ts: Date.now(), data })); } catch (e) {} },
    /* guardTitle：编辑已有条目时传它现在的标题；对不上说明条目已在别处变过，弹窗草稿作废 */
    loadModal(idx, guardTitle) {
      try {
        const raw = localStorage.getItem(modalKey);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (d && d.data && d.data.idx === idx) {
          if (idx >= 0 && d.data.guardTitle !== undefined && d.data.guardTitle !== guardTitle) { localStorage.removeItem(modalKey); return null; }
          return d;
        }
      } catch (e) {}
      return null;
    },
    clearModal() { try { localStorage.removeItem(modalKey); } catch (e) {} },
  };
}

const TIMELINE_PATH = 'src/config/timelineConfig.ts';
routes.timeline = async () => {
  view.innerHTML = '<div class="card"><h2>🕘 时间线</h2><p class="hint">正在读取配置…</p></div>';
  let sha = null, cfgText = '';
  try {
    const data = await ghGetFile(TIMELINE_PATH);
    sha = data.sha; cfgText = data.text;
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  // 解析 items 数组
  const parseItems = (t) => {
    const m = t.match(/items\s*:\s*\[([\s\S]*?)\n\t\],\n\};/);
    if (!m) { const m2 = t.match(/items:\s*\[([\s\S]*?)\],\s*\n\};/); if (!m2) return null; }
    const arrText = (m || m2)[1];
    try {
      // 用 Function 求值（配置是合法 JS 对象字面量）
      const fn = new Function(`return [${arrText}];`);
      return fn();
    } catch (e) { return null; }
  };
  let items = parseItems(cfgText);
  if (!items) { view.innerHTML = '<div class="card">解析时间线配置失败，格式不匹配。</div>'; return; }
  /* 本地草稿接入：恢复未保存的 items 改动；此后每次改动自动落草稿 */
  const tlDraft = makeListDraft('admin-edit-draft:timeline', 'admin-edit-draft:timeline-modal');
  const tlBaseline = JSON.stringify(items);
  const tlSaved = tlDraft.loadItems(tlBaseline, sha);
  if (tlSaved && !tlSaved.stale) items = tlSaved.items;
  const markDirty = () => { $('#btn-tlsave').disabled = false; tlDraft.saveItems(items, tlBaseline, sha); };
  const genTS = (list) => {
    const escS = (s) => (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const itemStr = (it) => {
      const parts = [];
      parts.push(`\t\t\tdate: '${escS(it.date)}'`);
      parts.push(`\t\t\ttype: '${escS(it.type)}'`);
      if (it.featured) parts.push(`\t\t\tfeatured: true`);
      parts.push(`\t\t\ttitle: '${escS(it.title)}'`);
      if (it.subtitle) parts.push(`\t\t\tsubtitle: '${escS(it.subtitle)}'`);
      parts.push(`\t\t\tdescription: '${escS(it.description)}'`);
      if (it.details && it.details.length) parts.push(`\t\t\tdetails: [${it.details.map((d) => `'${escS(d)}'`).join(', ')}]`);
      if (it.tags && it.tags.length) parts.push(`\t\t\ttags: [${it.tags.map((t) => `'${escS(t)}'`).join(', ')}]`);
      if (it.link) parts.push(`\t\t\tlink: '${escS(it.link)}'`);
      if (it.image) parts.push(`\t\t\timage: '${escS(it.image)}'`);
      if (it.enabled === false) parts.push(`\t\t\tenabled: false`);
      return `\t\t{\n${parts.join(',\n')}\n\t\t}`;
    };
    const itemsBlock = list.map(itemStr).join(',\n');
    return cfgText.replace(/items:\s*\[[\s\S]*?\],\s*\n\};/, `items: [\n${itemsBlock},\n\t],\n};`);
  };
  function render() {
    const box = $('#tl-list');
    box.innerHTML = items.map((it, i) => `
      <div class="list-item" data-i="${i}">
        <span class="title">${esc(it.title)}</span>
        <span class="meta">${esc(it.date)} · ${esc(it.type)}${it.featured ? ' · 精选' : ''}${it.enabled === false ? ' · 已隐藏' : ''}</span>
        <button class="btn btn-small" data-a="up">↑</button>
        <button class="btn btn-small" data-a="down">↓</button>
        <button class="btn btn-small" data-a="edit">编辑</button>
        <button class="btn btn-small" data-a="toggle">${it.enabled === false ? '显示' : '隐藏'}</button>
        <button class="btn btn-small" data-a="del">删除</button>
      </div>`).join('') || '<div class="card"><p class="hint">还没有时间线节点，点「＋ 新增」添加。</p></div>';
    box.querySelectorAll('.list-item').forEach((el) => {
      const i = +el.dataset.i;
      el.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [items[i-1], items[i]] = [items[i], items[i-1]]; markDirty(); render(); } };
      el.querySelector('[data-a=down]').onclick = () => { if (i < items.length - 1) { [items[i+1], items[i]] = [items[i], items[i+1]]; markDirty(); render(); } };
      el.querySelector('[data-a=toggle]').onclick = () => { items[i].enabled = items[i].enabled === false ? true : false; markDirty(); render(); };
      el.querySelector('[data-a=del]').onclick = () => { if (confirm(`删除「${items[i].title}」？`)) { items.splice(i, 1); markDirty(); render(); } };
      el.querySelector('[data-a=edit]').onclick = () => openEditor(i);
    });
  }
  function openEditor(idx) {
    const it = idx >= 0 ? items[idx] : { date: '', type: '项目', title: '', description: '' };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal card">
        <h3>${idx >= 0 ? '编辑' : '新增'}时间线节点</h3>
        <div class="field"><label>日期 *</label><input id="tl-date" value="${esc(it.date || '')}" placeholder="2026.10"></div>
        <div class="field"><label>分类 *</label><input id="tl-type" value="${esc(it.type || '项目')}" placeholder="项目 / 里程碑"></div>
        <div class="field"><label><input type="checkbox" id="tl-featured" ${it.featured ? 'checked' : ''}> 精选</label></div>
        <div class="field"><label>标题 *</label><input id="tl-title" value="${esc(it.title || '')}"></div>
        <div class="field"><label>副标题</label><input id="tl-subtitle" value="${esc(it.subtitle || '')}"></div>
        <div class="field"><label>描述 *</label><textarea id="tl-desc" rows="3">${esc(it.description || '')}</textarea></div>
        <div class="field"><label>详情列表（一行一条）</label><textarea id="tl-details" rows="4">${esc((it.details || []).join('\n'))}</textarea></div>
        <div class="field"><label>标签（逗号分隔）</label><input id="tl-tags" value="${esc((it.tags || []).join(', '))}"></div>
        <div class="field"><label>链接</label><input id="tl-link" value="${esc(it.link || '')}" placeholder="https://…"></div>
        <div class="field"><label>配图</label><input id="tl-image" value="${esc(it.image || '')}" placeholder="/assets/images/…"></div>
        <div class="toolbar"><span class="spacer"></span>
          <button class="btn btn-ghost" id="tl-cancel">取消</button>
          <button class="btn" id="tl-ok">确定</button></div>
      </div>`;
    document.body.appendChild(overlay);
    /* 弹窗草稿：写到一半退出/App 被杀也不丢；恢复仅限草稿属于当前这条时 */
    const tlModalSaved = tlDraft.loadModal(idx, idx >= 0 && items[idx] ? items[idx].title : null);
    if (tlModalSaved) {
      const d = tlModalSaved.data;
      const setF = (id, v) => { const el = overlay.querySelector(id); if (el && v !== undefined) el.value = v; };
      setF('#tl-date', d.date); setF('#tl-type', d.type); setF('#tl-title', d.title);
      setF('#tl-subtitle', d.subtitle); setF('#tl-desc', d.desc); setF('#tl-details', d.details);
      setF('#tl-tags', d.tags); setF('#tl-link', d.link); setF('#tl-image', d.image);
      const fcb = overlay.querySelector('#tl-featured'); if (fcb) fcb.checked = !!d.featured;
      toast(`已恢复 ${new Date(tlModalSaved.ts).toLocaleString()} 未写完的节点草稿`);
    }
    const tlModalWrite = () => {
      if (!document.body.contains(overlay)) return; /* 弹窗已关：不写 */
      const g = (id) => overlay.querySelector(id).value;
      tlDraft.saveModal({ idx, guardTitle: idx >= 0 && items[idx] ? items[idx].title : null, date: g('#tl-date'), type: g('#tl-type'), featured: overlay.querySelector('#tl-featured').checked, title: g('#tl-title'), subtitle: g('#tl-subtitle'), desc: g('#tl-desc'), details: g('#tl-details'), tags: g('#tl-tags'), link: g('#tl-link'), image: g('#tl-image') });
    };
    let tlModalTimer = null;
    const tlModalSchedule = () => { if (tlModalTimer) clearTimeout(tlModalTimer); tlModalTimer = setTimeout(tlModalWrite, 400); };
    overlay.addEventListener('input', tlModalSchedule);
    overlay.addEventListener('change', tlModalSchedule);
    window.addEventListener('pagehide', tlModalWrite);
    overlay.querySelector('#tl-cancel').onclick = () => { tlDraft.clearModal(); overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay) { tlDraft.clearModal(); overlay.remove(); } };
    overlay.querySelector('#tl-ok').onclick = () => {
      const v = (id) => overlay.querySelector(id).value.trim();
      const date = v('#tl-date'), type = v('#tl-type'), title = v('#tl-title'), desc = v('#tl-desc');
      if (!date || !type || !title || !desc) { toast('日期、分类、标题、描述必填', true); return; }
      const obj = {
        date, type,
        title,
        description: desc,
      };
      if (overlay.querySelector('#tl-featured').checked) obj.featured = true;
      const sub = v('#tl-subtitle'); if (sub) obj.subtitle = sub;
      const det = v('#tl-details').split('\n').map((s) => s.trim()).filter(Boolean);
      if (det.length) obj.details = det;
      const tags = v('#tl-tags').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      if (tags.length) obj.tags = tags;
      const link = v('#tl-link'); if (link) obj.link = link;
      const img = v('#tl-image'); if (img) obj.image = img;
      if (idx >= 0) items[idx] = { ...items[idx], ...obj };
      else items.unshift(obj);
      tlDraft.clearModal();
      overlay.remove();
      markDirty(); render();
    };
  }
  view.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-tladd">＋ 新增节点</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost hidden" id="btn-tldiscard" type="button">🗑 丢弃草稿</button>
      <button class="btn btn-ghost hidden" id="btn-tlrestore" type="button">↩ 仍用旧草稿</button>
      <button class="btn" id="btn-tlsave" disabled>💾 保存到仓库</button></div>
    <p class="hint">时间线显示在博客首页。↑↓ 排序，新增的节点默认排最前面。保存后重新构建生效。</p>
    <div id="tl-list"></div>`;
  render();
  if (tlSaved && !tlSaved.stale) {
    markDirty();
    const tdb = $('#btn-tldiscard');
    tdb.classList.remove('hidden');
    tdb.onclick = () => { tlDraft.clearItems(); tlDraft.clearModal(); toast('草稿已丢弃，恢复为仓库里的版本'); router(); };
    toast(`已恢复 ${new Date(tlSaved.ts).toLocaleString()} 未保存的时间线草稿`);
  } else if (tlSaved && tlSaved.stale) {
    /* 版本守卫：配置已在别处更新过，旧草稿不自动套上，亮出两个按钮让用户自己选 */
    const tdb = $('#btn-tldiscard'), trb = $('#btn-tlrestore');
    tdb.classList.remove('hidden'); trb.classList.remove('hidden');
    tdb.onclick = () => { tlDraft.clearItems(); tlDraft.clearModal(); toast('草稿已丢弃'); router(); };
    trb.onclick = () => { items = tlSaved.items; render(); markDirty(); tdb.classList.add('hidden'); trb.classList.add('hidden'); toast('已恢复旧草稿——时间线已在别处更新过，保存前请核对'); };
    toast(`时间线已在其他地方更新过，${new Date(tlSaved.ts).toLocaleString()} 的旧草稿没有自动恢复`, true);
  }
  $('#btn-tladd').onclick = () => openEditor(-1);
  $('#btn-tlsave').onclick = async () => {
    const btn = $('#btn-tlsave'); btn.disabled = true;
    try {
      const text = genTS(items);
      if (text === cfgText) throw new Error('配置未变化');
      const r = await saveWithLog(TIMELINE_PATH, text, sha, '更新时间线 [管理台]', { type: '时间线', action: '更新', target: '时间线配置' });
      sha = r.content.sha; cfgText = text;
      tlDraft.clearItems(); /* 已正式保存：清本地草稿 */
      toast('已保存，重新构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 碎碎念管理 ---------- */
const THOUGHTS_PATH = 'src/config/thoughtsConfig.ts';
routes.thoughts = async () => {
  view.innerHTML = '<div class="card"><h2>💭 碎碎念</h2><p class="hint">正在读取配置…</p></div>';
  let sha = null, cfgText = '';
  try {
    const data = await ghGetFile(THOUGHTS_PATH);
    sha = data.sha; cfgText = data.text;
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  const parseItems = (t) => {
    const m = t.match(/items\s*:\s*\[([\s\S]*?)\n\t\],\n\};/);
    if (!m) return null;
    try {
      const fn = new Function(`return [${m[1]}];`);
      return fn();
    } catch (e) { return null; }
  };
  let items = parseItems(cfgText);
  if (!items) { view.innerHTML = '<div class="card">解析碎碎念配置失败。</div>'; return; }
  /* 本地草稿接入（与时间线同款）：恢复未保存改动；此后每次改动自动落草稿 */
  const thDraft = makeListDraft('admin-edit-draft:thoughts', 'admin-edit-draft:thoughts-modal');
  const thBaseline = JSON.stringify(items);
  const thSaved = thDraft.loadItems(thBaseline, sha);
  if (thSaved && !thSaved.stale) items = thSaved.items;
  const markDirty = () => { $('#btn-thsave').disabled = false; thDraft.saveItems(items, thBaseline, sha); };
  const fmtDT = (iso) => {
    try {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch { return iso; }
  };
  const genTS = (list) => {
    const escS = (s) => (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const itemStr = (it) => {
      const parts = [];
      parts.push(`\t\t\ttitle: '${escS(it.title)}'`);
      parts.push(`\t\t\tcontent: '${escS(it.content)}'`);
      parts.push(`\t\t\tcreatedAt: '${escS(it.createdAt)}'`);
      if (it.updatedAt) parts.push(`\t\t\tupdatedAt: '${escS(it.updatedAt)}'`);
      if (it.enabled === false) parts.push(`\t\t\tenabled: false`);
      return `\t\t{\n${parts.join(',\n')}\n\t\t}`;
    };
    return cfgText.replace(/items:\s*\[[\s\S]*?\],\s*\n\};/, `items: [\n${list.map(itemStr).join(',\n')},\n\t],\n};`);
  };
  function render() {
    const box = $('#th-list');
    box.innerHTML = items.map((it, i) => `
      <div class="list-item" data-i="${i}">
        <span class="title">${esc(it.title)}</span>
        <p class="excerpt">${esc(it.content || '')}</p>
        <span class="meta">发布 ${esc(fmtDT(it.createdAt))}${it.updatedAt && it.updatedAt !== it.createdAt ? ' · 更新 ' + esc(fmtDT(it.updatedAt)) : ''}${it.enabled === false ? ' · 已隐藏' : ''}</span>
        <button class="btn btn-small" data-a="up">↑</button>
        <button class="btn btn-small" data-a="down">↓</button>
        <button class="btn btn-small" data-a="edit">编辑</button>
        <button class="btn btn-small" data-a="toggle">${it.enabled === false ? '显示' : '隐藏'}</button>
        <button class="btn btn-small" data-a="del">删除</button>
      </div>`).join('') || '<div class="card"><p class="hint">还没有碎碎念，点「＋ 新增」添加。</p></div>';
    box.querySelectorAll('.list-item').forEach((el) => {
      const i = +el.dataset.i;
      el.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [items[i-1], items[i]] = [items[i], items[i-1]]; markDirty(); render(); } };
      el.querySelector('[data-a=down]').onclick = () => { if (i < items.length - 1) { [items[i+1], items[i]] = [items[i], items[i+1]]; markDirty(); render(); } };
      el.querySelector('[data-a=toggle]').onclick = () => { items[i].enabled = items[i].enabled === false ? true : false; markDirty(); render(); };
      el.querySelector('[data-a=del]').onclick = () => { if (confirm(`删除「${items[i].title}」？`)) { items.splice(i, 1); markDirty(); render(); } };
      el.querySelector('[data-a=edit]').onclick = () => openEditor(i);
    });
  }
  function openEditor(idx) {
    const it = idx >= 0 ? items[idx] : { title: '', content: '' };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal card">
        <h3>${idx >= 0 ? '编辑' : '新增'}碎碎念</h3>
        <div class="field"><label>标题 *</label><input id="th-title" value="${esc(it.title || '')}"></div>
        <div class="field"><label>内容 *</label><textarea id="th-content" rows="5">${esc(it.content || '')}</textarea></div>
        ${idx >= 0 ? `<p class="hint">发布时间：${esc(fmtDT(it.createdAt))}${it.updatedAt && it.updatedAt !== it.createdAt ? '<br>上次更新：' + esc(fmtDT(it.updatedAt)) : ''}<br>保存时会自动记录更新时间。</p>` : '<p class="hint">保存时会自动记录发布时间。</p>'}
        <div class="toolbar"><span class="spacer"></span>
          <button class="btn btn-ghost" id="th-cancel">取消</button>
          <button class="btn" id="th-ok">确定</button></div>
      </div>`;
    document.body.appendChild(overlay);
    /* 弹窗草稿：写到一半退出/App 被杀也不丢；恢复仅限草稿属于当前这条时 */
    const thModalSaved = thDraft.loadModal(idx, idx >= 0 && items[idx] ? items[idx].title : null);
    if (thModalSaved) {
      const d = thModalSaved.data;
      const tEl = overlay.querySelector('#th-title'); if (tEl && d.title !== undefined) tEl.value = d.title;
      const cEl = overlay.querySelector('#th-content'); if (cEl && d.content !== undefined) cEl.value = d.content;
      toast(`已恢复 ${new Date(thModalSaved.ts).toLocaleString()} 未写完的碎碎念草稿`);
    }
    const thModalWrite = () => {
      if (!document.body.contains(overlay)) return; /* 弹窗已关：不写 */
      thDraft.saveModal({ idx, guardTitle: idx >= 0 && items[idx] ? items[idx].title : null, title: overlay.querySelector('#th-title').value, content: overlay.querySelector('#th-content').value });
    };
    let thModalTimer = null;
    const thModalSchedule = () => { if (thModalTimer) clearTimeout(thModalTimer); thModalTimer = setTimeout(thModalWrite, 400); };
    overlay.addEventListener('input', thModalSchedule);
    window.addEventListener('pagehide', thModalWrite);
    overlay.querySelector('#th-cancel').onclick = () => { thDraft.clearModal(); overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay) { thDraft.clearModal(); overlay.remove(); } };
    overlay.querySelector('#th-ok').onclick = () => {
      const title = overlay.querySelector('#th-title').value.trim();
      const content = overlay.querySelector('#th-content').value.trim();
      if (!title || !content) { toast('标题和内容必填', true); return; }
      const now = new Date().toISOString();
      if (idx >= 0) {
        items[idx] = { ...items[idx], title, content, updatedAt: now };
      } else {
        items.unshift({ title, content, createdAt: now });
      }
      thDraft.clearModal();
      overlay.remove();
      markDirty(); render();
    };
  }
  view.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-thadd">＋ 新增碎碎念</button>
      ${LV_SEG}
      <span class="spacer"></span>
      <button class="btn btn-ghost hidden" id="btn-thdiscard" type="button">🗑 丢弃草稿</button>
      <button class="btn btn-ghost hidden" id="btn-threstore" type="button">↩ 仍用旧草稿</button>
      <button class="btn" id="btn-thsave" disabled>💾 保存到仓库</button></div>
    <p class="hint">碎碎念显示在 /gallery/thoughts/ 星空页面。新增自动记录发布时间，编辑自动记录更新时间。保存后重新构建生效。</p>
    <div id="th-list"></div>`;
  render();
  syncLvSegs();
  if (thSaved && !thSaved.stale) {
    markDirty();
    const tdb = $('#btn-thdiscard');
    tdb.classList.remove('hidden');
    tdb.onclick = () => { thDraft.clearItems(); thDraft.clearModal(); toast('草稿已丢弃，恢复为仓库里的版本'); router(); };
    toast(`已恢复 ${new Date(thSaved.ts).toLocaleString()} 未保存的碎碎念草稿`);
  } else if (thSaved && thSaved.stale) {
    /* 版本守卫：配置已在别处更新过，旧草稿不自动套上，亮出两个按钮让用户自己选 */
    const tdb = $('#btn-thdiscard'), trb = $('#btn-threstore');
    tdb.classList.remove('hidden'); trb.classList.remove('hidden');
    tdb.onclick = () => { thDraft.clearItems(); thDraft.clearModal(); toast('草稿已丢弃'); router(); };
    trb.onclick = () => { items = thSaved.items; render(); markDirty(); tdb.classList.add('hidden'); trb.classList.add('hidden'); toast('已恢复旧草稿——碎碎念已在别处更新过，保存前请核对'); };
    toast(`碎碎念已在其他地方更新过，${new Date(thSaved.ts).toLocaleString()} 的旧草稿没有自动恢复`, true);
  }
  $('#btn-thadd').onclick = () => openEditor(-1);
  $('#btn-thsave').onclick = async () => {
    const btn = $('#btn-thsave'); btn.disabled = true;
    try {
      const text = genTS(items);
      if (text === cfgText) throw new Error('配置未变化');
      const r = await saveWithLog(THOUGHTS_PATH, text, sha, '更新碎碎念 [管理台]', { type: '碎碎念', action: '更新', target: '碎碎念配置' });
      sha = r.content.sha; cfgText = text;
      thDraft.clearItems(); /* 已正式保存：清本地草稿 */
      toast('已保存，重新构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 视频管理（R2 原画质直传，不转码不压缩） ---------- */
routes.videos = async () => {
  view.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-vupload">＋ 上传视频</button>
      <input type="file" id="f-vupload" accept="video/*" multiple class="hidden">
      <span class="spacer"></span><span class="hint" id="video-count"></span>
    </div>
    <p class="hint">原画质直传 R2，不转码、不压缩。建议 mp4（H.264）兼容性最好。单个文件建议 &lt; 100MB。</p>
    <div id="video-list"><div class="card"><p class="hint">正在读取…</p></div></div>`;
  const listEl = $('#video-list');
  async function load() {
    try {
      const r = await fetch('/api/r2-list?prefix=videos/&limit=100', { headers: { Authorization: `Bearer ${token()}` } });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const objs = (j.objects || []).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
      $('#video-count').textContent = `共 ${objs.length} 个`;
      listEl.innerHTML = objs.map((o, i) => {
        const name = o.key.split('/').pop();
        const mb = (o.size / 1048576).toFixed(1);
        const dt = o.uploaded ? new Date(o.uploaded).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
        return `<div class="list-item" data-i="${i}">
          <video class="video-thumb" src="${esc(o.url)}" preload="metadata" muted></video>
          <span class="feed-main"><span class="feed-title">${esc(name)}</span>
          <span class="feed-ex">${mb} MB · ${esc(dt)}</span></span>
          <button class="btn btn-small" data-a="play">▶ 预览</button>
          <button class="btn btn-small" data-a="copy">复制链接</button>
          <button class="btn btn-small btn-danger" data-a="del">删除</button>
        </div><div class="vpreview hidden"></div>`;
      }).join('') || '<div class="card">还没有视频，传一个吧 👆</div>';
      listEl.querySelectorAll('.list-item').forEach((row) => {
        const o = objs[+row.dataset.i];
        const pv = row.nextElementSibling;
        row.querySelector('[data-a=play]').onclick = () => {
          if (pv.innerHTML) { pv.classList.add('hidden'); pv.innerHTML = ''; return; }
          pv.innerHTML = `<div class="card"><video src="${esc(o.url)}" controls style="max-width:100%;max-height:400px"></video></div>`;
          pv.classList.remove('hidden');
        };
        row.querySelector('[data-a=copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(o.url); toast('链接已复制'); }
          catch (e) { prompt('复制链接：', o.url); }
        };
        row.querySelector('[data-a=del]').onclick = async () => {
          if (!confirm(`删除视频 ${o.key.split('/').pop()}？R2 上的文件会真正删除。`)) return;
          try {
            const r = await fetch('/api/r2-delete', { method: 'POST',
              headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ keys: [o.key] }) });
            const j = await r.json();
            if (j.error) throw new Error(j.error);
            toast('已删除'); oplogRecord('视频', '删除', o.key.split('/').pop(), 'R2 视频删除'); load();
          } catch (e) { toast(e.message, true); }
        };
      });
    } catch (e) { listEl.innerHTML = `<div class="card">读取失败：${esc(e.message)}</div>`; }
  }
  await load();
  $('#btn-vupload').onclick = () => $('#f-vupload').click();
  $('#f-vupload').onchange = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const dir = `videos/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    toast(`上传中（${files.length} 个，原画质）…`);
    try {
      const fd = new FormData();
      fd.append('dir', dir);
      for (const f of files) fd.append('files', f, f.name); // 不做任何转码，原样上传
      const r = await fetch('/api/r2-upload', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `上传失败: ${r.status}`);
      toast(`上传成功 ${j.urls.length} 个`);
      oplogRecord('视频', '上传', dir, `${j.urls.length} 个视频`);
      load();
    } catch (err) { toast(err.message, true); }
  };
};

/* ---------- 简介卡片管理 ---------- */
const PROFILE_PATH = 'src/config/profileConfig.ts';
routes.profile = async () => {
  view.innerHTML = '<div class="card"><h2>👤 简介</h2><p class="hint">正在读取仓库…</p></div>';
  let sha = null, src = '';
  try {
    const data = await ghGetFile(PROFILE_PATH);
    sha = data.sha; src = data.text;
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  const getStr = (k) => { const m = src.match(new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return m ? m[1].replace(/\\"/g, '"') : ''; };
  // 解析 links 数组
  const links = [];
  const lm = src.match(/links\s*:\s*\[/);
  if (lm) {
    const as = src.indexOf('[', lm.index);
    let depth = 0, i = as, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; }
      else if (c === '"' || c === "'") inStr = c;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (!depth) break; }
    }
    for (const b of topBlocks(src.slice(as + 1, i))) {
      const g = (k) => { const mm = b.match(new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return mm ? mm[1] : ''; };
      links.push({ name: g('name'), icon: g('icon'), url: g('url'), showName: /showName\s*:\s*true/.test(b) });
    }
  }
  const info = { avatar: getStr('avatar'), name: getStr('name'), bio: getStr('bio'),
    avatarUseAnimated: /avatarUseAnimated\s*:\s*true/.test(src) };
  const markDirty = () => { $('#btn-pfsave').disabled = false; };
  const linkForm = (l) => {
    const inp = (k, label, v, ph) => `<div class="field"><label>${label}</label><input type="text" data-k="${k}" value="${esc(v || '')}" placeholder="${ph || ''}"></div>`;
    return `<div class="card"><div class="grid2">${inp('name', '名称 *', l.name)}${inp('url', '链接 *', l.url, 'https:// 或 mailto:')}</div>
    <div class="grid2">${inp('icon', '图标', l.icon, 'fa7-brands:github')} 
    <div class="field"><label>显示名称</label><label class="pill${l.showName ? ' on' : ''}"><input type="checkbox" data-k="showName"${l.showName ? ' checked' : ''}>图标旁显示文字</label></div></div>
    <p class="hint">图标去 <a href="https://icones.js.org/" target="_blank">icones.js.org</a> 找代码，如 fa7-brands:github</p>
    <div class="toolbar"><span class="spacer"></span><button class="btn btn-small btn-ghost" data-a="cancel">取消</button><button class="btn btn-small" data-a="ok">确定</button></div></div>`;
  };
  function renderLinks() {
    const box = $('#pf-links');
    box.innerHTML = links.map((l, i) => `
      <div class="list-item" data-i="${i}">
        <span class="title">${esc(l.name || '(未命名)')}</span><span class="meta">${esc(l.url || '')}</span>
        <button class="btn btn-small" data-a="up">↑</button><button class="btn btn-small" data-a="down">↓</button>
        <button class="btn btn-small" data-a="edit">编辑</button><button class="btn btn-small btn-danger" data-a="del">删除</button>
      </div><div class="lform hidden"></div>`).join('');
    box.querySelectorAll('.list-item').forEach((row) => {
      const i = +row.dataset.i, l = links[i], f = row.nextElementSibling;
      row.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [links[i-1], links[i]] = [links[i], links[i-1]]; markDirty(); renderLinks(); } };
      row.querySelector('[data-a=down]').onclick = () => { if (i < links.length - 1) { [links[i+1], links[i]] = [links[i], links[i+1]]; markDirty(); renderLinks(); } };
      row.querySelector('[data-a=del]').onclick = () => { if (confirm(`删除链接「${l.name}」？`)) { links.splice(i, 1); markDirty(); renderLinks(); } };
      row.querySelector('[data-a=edit]').onclick = () => {
        f.innerHTML = linkForm(l); f.classList.remove('hidden');
        f.querySelector('[data-a=cancel]').onclick = () => { f.classList.add('hidden'); f.innerHTML = ''; };
        f.querySelector('[data-a=ok]').onclick = () => {
          const o = {};
          f.querySelectorAll('[data-k]').forEach((el) => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
          if (!o.name || !o.url) { toast('名称和链接必填', true); return; }
          Object.assign(l, o); markDirty(); renderLinks();
        };
      };
    });
  }
  view.innerHTML = `
    <div class="card"><h3>基本信息</h3>
      <div class="field"><label>名字</label><input type="text" id="pf-name" value="${esc(info.name)}"></div>
      <div class="field"><label>头像 <span class="hint">（对外固定地址，不可改）</span></label>
        <div class="avatar-row">
          <img src="/avatar.png" class="avatar-preview" onerror="this.style.display='none'">
          <div style="flex:1">
            <div class="mono">https://lanerc.me/avatar.png</div>
            <div class="mono">https://lanerc.me/avatar.avif</div>
          </div>
          <button class="btn btn-small" id="btn-avupload">替换文件</button>
          <input type="file" id="f-avupload" accept="image/*" class="hidden">
        </div>
        <p class="hint">传一次，两个地址同时换成新头像，只换 public/ 下文件内容，地址永不变，友链那边不会挂。</p>
        <label class="pill${info.avatarUseAnimated ? ' on' : ''}" style="margin-top:8px"><input type="checkbox" id="pf-use-animated"${info.avatarUseAnimated ? ' checked' : ''}>动图模式</label>
        <p class="hint">传 GIF 动图时打开：前台跳过图片优化器直接渲染，保证动起来。</p></div>
      <div class="field"><label>个人签名</label><textarea id="pf-bio" rows="2">${esc(info.bio)}</textarea></div>
    </div>
    <div class="toolbar"><button class="btn btn-small" id="btn-pfadd">＋ 添加链接</button><span class="spacer"></span>
      <button class="btn" id="btn-pfsave" disabled>💾 保存到仓库</button></div>
    <div id="pf-new"></div><div id="pf-links"></div>`;
  renderLinks();
  ['pf-name', 'pf-bio'].forEach((id) => { $('#' + id).oninput = markDirty; });
  $('#pf-use-animated').onchange = (e) => {
    e.target.closest('.pill').classList.toggle('on', e.target.checked);
    markDirty();
  };
  // 头像：一次上传，同时替换 public/avatar.png 和 public/avatar.avif（地址不变）
  $('#btn-avupload').onclick = () => $('#f-avupload').click();
  $('#f-avupload').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm(`用「${f.name}」替换头像？\npublic/avatar.png 和 public/avatar.avif 都会换成这张，\n对外地址 https://lanerc.me/avatar.png / .avif 不变。`)) return;
    toast('替换中…');
    try {
      const buf = await f.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      const b64 = btoa(bin);
      for (const repoPath of ['public/avatar.png', 'public/avatar.avif']) {
        let sha = null;
        try { sha = (await ghGetFile(repoPath)).sha; } catch (_) {}
        await saveWithLog(repoPath, b64, sha, `替换头像 ${repoPath} [管理台]`, { type: '图片', action: '替换', target: repoPath }, { isBase64: true });
      }
      toast('两个地址都已更新，构建后全网生效');
    } catch (err) { toast(err.message, true); }
  };
  $('#btn-pfadd').onclick = () => {
    const nw = $('#pf-new');
    if (nw.innerHTML) { nw.innerHTML = ''; return; }
    nw.innerHTML = linkForm({ name: '', url: '', icon: '', showName: false });
    nw.querySelector('[data-a=cancel]').onclick = () => { nw.innerHTML = ''; };
    nw.querySelector('[data-a=ok]').onclick = () => {
      const o = {};
      nw.querySelectorAll('[data-k]').forEach((el) => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      if (!o.name || !o.url) { toast('名称和链接必填', true); return; }
      links.push(o); nw.innerHTML = ''; markDirty(); renderLinks();
    };
  };
  $('#btn-pfsave').onclick = async () => {
    const btn = $('#btn-pfsave'); btn.disabled = true;
    try {
      const q = (s) => `"${String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      let text = src;
      // avatar 地址固定，不可改，只保存动图开关
      text = text.replace(/avatarUseAnimated\s*:\s*(true|false)/, `avatarUseAnimated: ${$('#pf-use-animated').checked ? 'true' : 'false'}`);
      text = text.replace(/name\s*:\s*"[^"]*"/, `name: ${q($('#pf-name').value.trim())}`);
      text = text.replace(/bio\s*:\s*"[^"]*"/, `bio: ${q($('#pf-bio').value.trim())}`);
      const linksTs = links.map((l) => `\t\t{\n\t\t\tname: ${q(l.name)},\n\t\t\ticon: ${q(l.icon)},\n\t\t\turl: ${q(l.url)},\n\t\t\tshowName: ${l.showName ? 'true' : 'false'},\n\t\t},`).join('\n');
      const lm2 = text.match(/links\s*:\s*\[/);
      const as = text.indexOf('[', lm2.index);
      let depth = 0, i = as, inStr = null;
      for (; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (c === inStr && text[i - 1] !== '\\') inStr = null; }
        else if (c === '"' || c === "'") inStr = c;
        else if (c === '[') depth++;
        else if (c === ']') { depth--; if (!depth) break; }
      }
      text = text.slice(0, as + 1) + '\n' + linksTs + '\n\t' + text.slice(i);
      const r = await saveWithLog(PROFILE_PATH, text, sha, '更新简介卡片 [管理台]', { type: '简介', action: '更新', target: '简介卡片' });
      sha = r.content.sha; src = text; toast('已保存，构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 横幅文字管理 ---------- */
const BANNER_PATH = 'src/config/backgroundWallpaper.ts';
routes.banner = async () => {
  view.innerHTML = '<div class="card"><h2>🖼️ 横幅</h2><p class="hint">正在读取仓库…</p></div>';
  let sha = null, src = '';
  try {
    const data = await ghGetFile(BANNER_PATH);
    sha = data.sha; src = data.text;
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  const getStr = (k) => { const m = src.match(new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return m ? m[1].replace(/\\"/g, '"') : ''; };
  const getBool = (k) => new RegExp(k + '\\s*:\\s*true').test(src);
  // 解析 subtitle 数组
  const subtitles = [];
  const sm = src.match(/subtitle\s*:\s*\[/);
  if (sm) {
    const as = src.indexOf('[', sm.index);
    let depth = 0, i = as, inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; }
      else if (c === '"' || c === "'") inStr = c;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (!depth) break; }
    }
    const inner = src.slice(as + 1, i);
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(inner))) subtitles.push(m[1].replace(/\\"/g, '"'));
  }
  const info = { title: getStr('title'), enable: getBool('enable') };
  const markDirty = () => { $('#btn-bnsave').disabled = false; };
  function renderSubs() {
    const box = $('#bn-subs');
    box.innerHTML = subtitles.map((s, i) => `
      <div class="list-item" data-i="${i}">
        <span class="title" style="flex:1">${esc(s)}</span>
        <button class="btn btn-small" data-a="up">↑</button><button class="btn btn-small" data-a="down">↓</button>
        <button class="btn btn-small" data-a="edit">编辑</button><button class="btn btn-small btn-danger" data-a="del">删除</button>
      </div><div class="sform hidden"></div>`).join('') || '<p class="hint">还没有轮换语句，加一条吧 👇</p>';
    box.querySelectorAll('.list-item').forEach((row) => {
      const i = +row.dataset.i, f = row.nextElementSibling;
      row.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [subtitles[i-1], subtitles[i]] = [subtitles[i], subtitles[i-1]]; markDirty(); renderSubs(); } };
      row.querySelector('[data-a=down]').onclick = () => { if (i < subtitles.length - 1) { [subtitles[i+1], subtitles[i]] = [subtitles[i], subtitles[i+1]]; markDirty(); renderSubs(); } };
      row.querySelector('[data-a=del]').onclick = () => { if (confirm('删除这条？')) { subtitles.splice(i, 1); markDirty(); renderSubs(); } };
      row.querySelector('[data-a=edit]').onclick = () => {
        f.innerHTML = `<div class="card"><div class="field"><input type="text" id="bn-edit" value="${esc(subtitles[i])}"></div>
          <div class="toolbar"><span class="spacer"></span><button class="btn btn-small btn-ghost" data-a="cancel">取消</button><button class="btn btn-small" data-a="ok">确定</button></div></div>`;
        f.classList.remove('hidden');
        f.querySelector('[data-a=cancel]').onclick = () => { f.classList.add('hidden'); f.innerHTML = ''; };
        f.querySelector('[data-a=ok]').onclick = () => {
          const v = f.querySelector('#bn-edit').value.trim();
          if (!v) { toast('内容不能为空', true); return; }
          subtitles[i] = v; markDirty(); renderSubs();
        };
      };
    });
  }
  view.innerHTML = `
    <div class="card"><h3>主标题</h3>
      <div class="field"><input type="text" id="bn-title" value="${esc(info.title)}" placeholder="Lovely Life"></div>
      <p class="hint">支持中文、日文、emoji 等各种语言，直接写就行。</p>
    </div>
    <div class="toolbar"><button class="btn btn-small" id="btn-bnadd">＋ 添加轮换语句</button><span class="spacer"></span>
      <button class="btn" id="btn-bnsave" disabled>💾 保存到仓库</button></div>
    <div id="bn-new"></div>
    <div class="card"><h3>轮换语句（按顺序播放）</h3><div id="bn-subs"></div></div>`;
  renderSubs();
  $('#bn-title').oninput = markDirty;
  $('#btn-bnadd').onclick = () => {
    const nw = $('#bn-new');
    if (nw.innerHTML) { nw.innerHTML = ''; return; }
    nw.innerHTML = `<div class="card"><div class="field"><input type="text" id="bn-newtext" placeholder="写一句新的轮换语句…"></div>
      <div class="toolbar"><span class="spacer"></span><button class="btn btn-small btn-ghost" id="bn-cancel">取消</button><button class="btn btn-small" id="bn-ok">确定</button></div></div>`;
    $('#bn-cancel').onclick = () => { nw.innerHTML = ''; };
    $('#bn-ok').onclick = () => {
      const v = $('#bn-newtext').value.trim();
      if (!v) { toast('内容不能为空', true); return; }
      subtitles.push(v); nw.innerHTML = ''; markDirty(); renderSubs();
    };
  };
  $('#btn-bnsave').onclick = async () => {
    const btn = $('#btn-bnsave'); btn.disabled = true;
    try {
      const q = (s) => `"${String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      let text = src;
      // 只替换 homeText 块内的 title（避免误伤别处的 title）
      const ht = text.match(/homeText\s*:\s*\{/);
      if (!ht) throw new Error('找不到 homeText 配置');
      const hs = ht.index;
      // title
      const tm = text.slice(hs).match(/title\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (tm) {
        const abs = hs + tm.index;
        text = text.slice(0, abs) + `title: ${q($('#bn-title').value.trim())}` + text.slice(abs + tm[0].length);
      }
      // subtitle 数组
      const sm2 = text.slice(hs).match(/subtitle\s*:\s*\[/);
      if (sm2) {
        const as = hs + sm2.index + sm2[0].length - 1;
        let depth = 0, i = as, inStr = null;
        for (; i < text.length; i++) {
          const c = text[i];
          if (inStr) { if (c === inStr && text[i - 1] !== '\\') inStr = null; }
          else if (c === '"' || c === "'") inStr = c;
          else if (c === '[') depth++;
          else if (c === ']') { depth--; if (!depth) break; }
        }
        const arrTs = subtitles.map((s) => `\t\t\t\t${q(s)},`).join('\n');
        text = text.slice(0, as + 1) + '\n' + arrTs + '\n\t\t\t' + text.slice(i);
      }
      const r = await saveWithLog(BANNER_PATH, text, sha, '更新横幅文字 [管理台]', { type: '横幅', action: '更新', target: '横幅文字' });
      sha = r.content.sha; src = text; toast('已保存，构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 总结报告（月度/季度/年度，控制台内部功能） ----------
 * 时间表（规格 2026-10-24）：从 2026-10-15 起算；月度每月底弹；季度 3/6/9/1 月底弹
 * （Q4 放次年 1 月，避开年度）；年度每年 12 月 30 号弹。弹窗只在主页面（dashboard）
 * 触发，挂着直到点叉确认，确认过的周期不再弹；叉掉的报告不丢失，写作页（stats）的
 * 报告区块里有全部往期存档，任一往期可点开看。
 * 数据：控制台操作日志（仓库文件 + 本地 pending 合并）+ 历史回填（见下节）；
 * 评语是固定模板句按数据自动挑；视角第二人称“你”；版式参考小红书周报
 * （浅色底、红色点缀、卡片 + 大数字 + 柱状图 + 亮点 + 实在话）。
 */
const REPORT_START = new Date(2026, 9, 15);
const REPORT_DISMISSED_KEY = 'admin_reports_dismissed';
const REPORT_GALLERY_KEY = 'admin_report_gallery';
/* 报告背景池：控制台自带的波奇图（星空海滨站那张不是波奇，不进池）+ 用户上传的图 */
const REPORT_BOCHI = ['login-art.jpg', 'login-art-sketch.png'];
const REPORT_CONTENT_TYPES = ['文章', '动态', '碎碎念'];
function reportPad(n) { return String(n).padStart(2, '0'); }
function reportMonthKey(d) { return `${d.getFullYear()}-${reportPad(d.getMonth() + 1)}`; }
function reportIsLastDay(d) { return d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
/* 周期范围：month 'YYYY-MM' / quarter 'YYYY-Qn' / annual 'YYYY' */
function reportRange(type, key) {
  if (type === 'month') {
    const [y, m] = key.split('-').map(Number);
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999), label: `${y} 年 ${m} 月` };
  }
  if (type === 'quarter') {
    const [y, q] = key.split('-Q').map(Number);
    const m0 = (q - 1) * 3;
    return { start: new Date(y, m0, 1), end: new Date(y, m0 + 3, 0, 23, 59, 59, 999), label: `${y} 年 Q${q}` };
  }
  const y = Number(key);
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59, 999), label: `${y} 年` };
}
function reportTypeWord(type) { return type === 'month' ? '月' : type === 'quarter' ? '季度' : '年'; }
/* 今天该弹哪些周期（未过滤确认状态） */
function reportDuePeriods(today) {
  const out = [];
  if (today < REPORT_START) return out;
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  if (m === 11 && d === 30) out.push({ type: 'annual', key: String(y), label: `${y} 年年度总结` });
  if (reportIsLastDay(today)) {
    if (m === 2) out.push({ type: 'quarter', key: `${y}-Q1`, label: `${y} 年 Q1 总结` });
    else if (m === 5) out.push({ type: 'quarter', key: `${y}-Q2`, label: `${y} 年 Q2 总结` });
    else if (m === 8) out.push({ type: 'quarter', key: `${y}-Q3`, label: `${y} 年 Q3 总结` });
    else if (m === 0) out.push({ type: 'quarter', key: `${y - 1}-Q4`, label: `${y - 1} 年 Q4 总结` });
    out.push({ type: 'month', key: reportMonthKey(today), label: `${y} 年 ${m + 1} 月总结` });
  }
  return out;
}
function reportDismissedMap() {
  try { return JSON.parse(localStorage.getItem(REPORT_DISMISSED_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function reportDismiss(type, key) {
  const map = reportDismissedMap();
  map[`${type}:${key}`] = true;
  try { localStorage.setItem(REPORT_DISMISSED_KEY, JSON.stringify(map)); } catch (e) {}
}
function reportIsDismissed(type, key) { return !!reportDismissedMap()[`${type}:${key}`]; }
function reportGallery() {
  try { const v = JSON.parse(localStorage.getItem(REPORT_GALLERY_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function reportBgPool() { return [...REPORT_BOCHI, ...reportGallery()]; }
function reportPickBg() {
  const pool = reportBgPool();
  return pool[Math.floor(Math.random() * pool.length)] || REPORT_BOCHI[0];
}
/* 合并后的日志条目（仓库缓存 + 本地 pending，去重，按时间升序） */
function reportAllEntries() {
  const repo = Array.isArray(window._oplogEntries) ? window._oplogEntries : [];
  return oplogDedup([...repo, ...oplogLoadPending()]).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}
async function reportLoadEntries() {
  try {
    const data = await ghGetFile(OPLOG_PATH);
    window._oplogText = data.text;
    const parsed = JSON.parse(data.text);
    window._oplogEntries = Array.isArray(parsed) ? parsed : [];
  } catch (e) { /* 仓库无日志文件或离线：用缓存 + pending，报告页会标示例数据 */ }
  return reportAllEntries();
}
/* ---------- 历史回填：2026-10-15 到 oplog 起记之前，用 commit 历史近似补齐 ----------
 * - 入口：reportLoadMergedEntries()，报告区块与到期弹窗共用；只读 GET，失败只降级
 *   （回填失败 → 仅显示 oplog，并提示），绝不影响已有数据。
 * - 窗口：since = 2026-10-15；until = 最早一条 oplog 之前（严格取 <，杜绝与 oplog
 *   重叠双倍计数）；oplog 为空时 until = 现在，首次保存后窗口自动收缩。
 * - 过滤：自动化提交按作者/message 表排除（见下两张表，后续可加）；拉到 commit
 *   详情后文件数为 0 的空提交（定时构建触发类）也排除。
 * - 分类：commit 详情的 changed files 按路径归类（文章 src/content/posts、动态
 *   src/content/dynamic、友链/时间线/碎碎念各自配置，其余 = 其他）；条目标记
 *   source:'backfill'，UI 明确标注“回填近似数据”（commit 粒度 ≠ 操作粒度）。
 * - 详情按 sha 缓存进 localStorage，只拉一次；列表分页拉，条数有上限。
 */
const REPORT_BACKFILL_START_ISO = '2026-10-15T00:00:00Z';
const REPORT_BACKFILL_CACHE_KEY = 'admin_report_backfill_details';
const REPORT_BACKFILL_MAX_COMMITS = 200;
/* 自动化提交过滤表一：作者登录名（Actions bot / 依赖 bot 等） */
const REPORT_BACKFILL_EXCLUDE_AUTHORS = ['github-actions', 'github-actions[bot]', 'dependabot[bot]', 'renovate[bot]'];
/* 自动化提交过滤表二：commit message 特征（定时构建、数据脚本等；命中即排除） */
const REPORT_BACKFILL_EXCLUDE_MESSAGES = [
  /rebuild/i,
  /trigger.*build/i,
  /^(chore|ci)(\(.+\))?:\s*(daily|auto|scheduled)/i,
  /fetch-(umami|friend|github|steam)|gen-post-meta/i,
  /\[automated\]/i,
];
/* 只读 GET（回填专用）：不走 gh()，失败不触发登出，回填是增强项不该把人踢下线 */
async function ghGetQuiet(path) {
  const res = await fetch(GH_API + path + (path.includes('?') ? '&' : '?') + '_t=' + Date.now(), {
    cache: 'no-store', /* 同 gh()：绕过浏览器对 GitHub GET 的 60 秒缓存 */
    headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${token()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API 错误: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}
function reportBackfillCacheLoad() {
  try { const v = JSON.parse(localStorage.getItem(REPORT_BACKFILL_CACHE_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch (e) { return {}; }
}
function reportBackfillCacheSave(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete cache[k]);
    localStorage.setItem(REPORT_BACKFILL_CACHE_KEY, JSON.stringify(cache));
  } catch (e) { /* localStorage 满：放弃缓存，下次重拉，不影响功能 */ }
}
function reportBackfillIsAutomated(c) {
  const login = (c.author && c.author.login) || (c.committer && c.committer.login) || '';
  if (REPORT_BACKFILL_EXCLUDE_AUTHORS.includes(login)) return true;
  const msg = (c.commit && c.commit.message) || '';
  return REPORT_BACKFILL_EXCLUDE_MESSAGES.some((re) => re.test(msg));
}
/* 单文件归类：返回 {type, action, target} 或 null（null = 不属于已知分类） */
function reportBackfillClassifyFile(filename, status) {
  if (/^src\/content\/posts\//.test(filename)) {
    return { type: '文章', action: status === 'added' ? '新建' : '更新', target: filename.split('/')[3] || filename };
  }
  if (/^src\/content\/dynamic\//.test(filename)) {
    return { type: '动态', action: status === 'added' ? '新建' : '更新', target: filename.split('/').pop() || filename };
  }
  if (filename === 'src/config/friendsConfig.ts') return { type: '友链', action: '更新', target: '友链配置' };
  if (filename === 'src/config/timelineConfig.ts') return { type: '时间线', action: '更新', target: '时间线配置' };
  if (filename === 'src/config/thoughtsConfig.ts') return { type: '碎碎念', action: '更新', target: '碎碎念配置' };
  return null;
}
/* 一个 commit → 若干条回填记录（同一篇文章的多个文件只算一次；全不属于已知分类时记 1 条“其他”） */
function reportBackfillClassifyCommit(commit, files) {
  const rawTs = (commit.commit && ((commit.commit.committer || {}).date || (commit.commit.author || {}).date)) || '';
  /* 统一成 toISOString 格式，与 oplog 条目同格式，去重键才对得上 */
  const ts = rawTs ? new Date(rawTs).toISOString() : '';
  const entries = [];
  const seenPosts = new Set();
  for (const f of files) {
    const c = reportBackfillClassifyFile(f.filename, f.status);
    if (!c) continue;
    if (c.type === '文章') {
      if (seenPosts.has(c.target)) continue;
      seenPosts.add(c.target);
    }
    entries.push({ ts, type: c.type, action: c.action, target: c.target, detail: '', source: 'backfill' });
  }
  if (!entries.length && files.length) {
    entries.push({ ts, type: '其他', action: '更新', target: files[0].filename, detail: '', source: 'backfill' });
  }
  return entries;
}
async function reportFetchBackfill(oplogEntries) {
  const earliest = oplogEntries && oplogEntries.length ? oplogEntries[0].ts : null;
  /* until 再往前让 1 秒 + 末尾严格过滤，双保险防与 oplog 重叠 */
  const until = earliest ? new Date(new Date(earliest).getTime() - 1000).toISOString() : new Date().toISOString();
  const base = `/repos/${CFG.owner}/${CFG.repo}/commits?sha=${encodeURIComponent(CFG.branch)}&since=${encodeURIComponent(REPORT_BACKFILL_START_ISO)}&until=${encodeURIComponent(until)}&per_page=100`;
  const commits = [];
  for (let page = 1; page <= 10; page++) {
    const list = await ghGetQuiet(`${base}&page=${page}`);
    if (!Array.isArray(list) || !list.length) break;
    commits.push(...list);
    if (list.length < 100 || commits.length >= REPORT_BACKFILL_MAX_COMMITS) break;
    const last = list[list.length - 1];
    const lastDate = (last.commit && ((last.commit.committer || {}).date || (last.commit.author || {}).date)) || '';
    if (lastDate && lastDate < REPORT_BACKFILL_START_ISO) break;
  }
  const cache = reportBackfillCacheLoad();
  const entries = [];
  const todo = [];
  for (const c of commits.slice(0, REPORT_BACKFILL_MAX_COMMITS)) {
    if (reportBackfillIsAutomated(c)) continue;
    if (Array.isArray(cache[c.sha])) entries.push(...reportBackfillClassifyCommit(c, cache[c.sha]));
    else todo.push(c);
  }
  /* 未缓存的详情分批拉（每批 5 个，保持人类节奏）；失败跳过该 commit，不编造数据 */
  for (let i = 0; i < todo.length; i += 5) {
    const results = await Promise.all(todo.slice(i, i + 5).map(async (c) => {
      try {
        const detail = await ghGetQuiet(`/repos/${CFG.owner}/${CFG.repo}/commits/${c.sha}`);
        return { c, files: (detail.files || []).map((f) => ({ filename: f.filename, status: f.status })) };
      } catch (e) { return { c, files: null }; }
    }));
    for (const r of results) {
      if (!r.files) continue;
      cache[r.c.sha] = r.files;
      if (!r.files.length) continue; // 空提交（定时构建触发类）排除
      entries.push(...reportBackfillClassifyCommit(r.c, r.files));
    }
    reportBackfillCacheSave(cache);
  }
  /* 严格窗口：回填条目必须早于最早一条 oplog */
  const filtered = earliest ? entries.filter((e) => e.ts && e.ts < earliest) : entries;
  return { entries: filtered };
}
/* 报告数据源：oplog + 回填合并（按 ts+type+action+target 去重，升序） */
async function reportLoadMergedEntries() {
  const oplog = await reportLoadEntries();
  let backfill = { entries: [], failed: false };
  try { backfill = { ...(await reportFetchBackfill(oplog)), failed: false }; }
  catch (e) { backfill = { entries: [], failed: true }; }
  /* oplog 在前：同键时保留精确的 oplog 条目，回填条目被去重掉 */
  const merged = oplogDedup([...oplog, ...backfill.entries]).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return { entries: merged, backfillCount: backfill.entries.length, backfillFailed: backfill.failed };
}
/* 空日志时的示例数据（明确标注，仅用于跑通页面） */
function reportDemoEntries() {
  const day = (d, type, action, target) => ({ ts: `2026-10-${d}T12:00:00+08:00`, type, action, target, detail: '' });
  return [
    day('17', '友链', '更新', '友链配置'), day('18', '友链', '更新', '友链配置'),
    day('19', '友链', '更新', '友链配置'), day('19', '动态', '新建', 'src/content/dynamic/2026-10-19.md'),
    day('23', '时间线', '更新', '时间线配置'), day('23', '碎碎念', '更新', '碎碎念配置'),
    day('24', '时间线', '更新', '时间线配置'), day('24', '碎碎念', '更新', '碎碎念配置'),
    day('24', '导航', '更新', '控制台导航栏'), day('24', '公告', '更新', '网站公告'),
  ];
}
function reportAggregate(entries, range) {
  const inRange = entries.filter((e) => {
    const t = new Date(e.ts);
    return t >= range.start && t <= range.end;
  });
  const posts = inRange.filter((e) => REPORT_CONTENT_TYPES.includes(e.type)).length;
  const friends = inRange.filter((e) => e.type === '友链').length;
  const days = new Set(inRange.map((e) => String(e.ts).slice(0, 10)));
  const byDay = {};
  inRange.forEach((e) => { const d = String(e.ts).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
  const byType = {};
  inRange.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + 1; });
  const daily = [];
  for (let d = new Date(range.start); d <= range.end; d.setDate(d.getDate() + 1)) {
    const k = `${d.getFullYear()}-${reportPad(d.getMonth() + 1)}-${reportPad(d.getDate())}`;
    daily.push({ date: k, count: byDay[k] || 0 });
  }
  return { total: inRange.length, posts, friends, activeDays: days.size, daily, byType, latest: inRange.slice(-5).reverse(), list: inRange };
}
/* 固定模板评语：按数据阈值自动挑，不现写 */
function reportReview(stats, word) {
  const s = [];
  if (stats.posts >= 5) s.push(`你这个${word}高产，继续保持！`);
  else if (stats.posts === 0) s.push(`你这个${word}没发东西，偷懒了？`);
  if (stats.total >= 20) s.push(`你这个${word}折腾得很勤快。`);
  else if (stats.total > 0 && stats.total < 5) s.push(`你这个${word}比较安静。`);
  if (stats.friends >= 3) s.push('朋友圈又扩大了。');
  return s.length ? s.join(' ') : `你这个${word}稳步推进中。`;
}
function reportPeriodOptions(entries, type) {
  const keys = new Set();
  entries.forEach((e) => {
    const d = new Date(e.ts);
    if (type === 'month') keys.add(reportMonthKey(d));
    else if (type === 'quarter') keys.add(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
    else keys.add(String(d.getFullYear()));
  });
  const now = new Date();
  if (type === 'month') keys.add(reportMonthKey(now));
  else if (type === 'quarter') keys.add(`${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`);
  else keys.add(String(now.getFullYear()));
  return [...keys].sort().reverse();
}
function reportRenderBody(stats, range, word, demo, backfillCount) {
  /* 柱状图：月内每天都画；季度/年度按月聚合 */
  let bars = stats.daily;
  if (word !== '月') {
    const byMonth = {};
    stats.daily.forEach((d) => { const k = d.date.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + d.count; });
    bars = Object.keys(byMonth).sort().map((k) => ({ date: k, count: byMonth[k] }));
  }
  const maxBar = Math.max(1, ...bars.map((b) => b.count));
  const topType = Object.entries(stats.byType).sort((a, b) => b[1] - a[1])[0];
  const busyDay = stats.daily.slice().sort((a, b) => b.count - a.count)[0];
  const bg = reportPickBg();
  return `<div class="report-page" style="background-image:url('${esc(bg)}')">
    <div class="report-veil">
      ${demo ? '<p class="report-demo">暂无操作记录，以下为示例数据</p>' : ''}
      ${backfillCount ? `<p class="report-backfill">其中 ${backfillCount} 条为 commit 回填近似数据（commit 粒度不等于操作粒度，仅供参考）</p>` : ''}
      <h2 class="report-title">✨ 你的 ${esc(range.label)}小结 ✨</h2>
      <p class="report-greet">${esc(reportReview(stats, word))}</p>
      <div class="report-cards">
        <div class="report-card"><div class="report-num">${stats.total}</div><div class="report-label">总操作</div></div>
        <div class="report-card"><div class="report-num">${stats.posts}</div><div class="report-label">文章/动态/碎碎念</div></div>
        <div class="report-card"><div class="report-num">${stats.friends}</div><div class="report-label">友链操作</div></div>
        <div class="report-card"><div class="report-num">${stats.activeDays}</div><div class="report-label">活跃天数</div></div>
      </div>
      <div class="report-section">
        <h3>📈 ${word === '月' ? '每日' : '每月'}操作量</h3>
        <div class="report-bars">${bars.map((b) => `<div class="report-bar-wrap"><span class="report-bar-val">${b.count || ''}</span><div class="report-bar" style="height:${Math.max(2, Math.round((b.count / maxBar) * 90))}px"></div><span class="report-bar-date">${esc(b.date.slice(5))}</span></div>`).join('')}</div>
      </div>
      <div class="report-section">
        <h3>🌟 本周期亮点</h3>
        ${topType ? `<p>📌 你最常折腾的是「${esc(topType[0])}」，共 ${topType[1]} 次</p>` : '<p>📌 本周期还没有操作记录</p>'}
        ${busyDay && busyDay.count ? `<p>🔥 最忙的一天是 ${esc(busyDay.date)}，${busyDay.count} 次操作</p>` : ''}
        ${stats.latest.length ? `<p>🕘 最近一次：${esc(stats.latest[0].type)}${esc(stats.latest[0].action)}「${esc(stats.latest[0].target)}」</p>` : ''}
      </div>
      <div class="report-section report-review">
        <h3>💭 说点实在的</h3>
        <p>${esc(reportReview(stats, word))}</p>
        <p class="hint">数据来源：控制台操作日志（仓库 + 本地 pending 合并）。日志随每次保存同 commit 写入，不多触发构建。</p>
      </div>
    </div>
  </div>`;
}
/* 总结报告区块：渲染进 stats（写作）页尾的容器；切换类型/周期/往期都在区块内就地重渲 */
async function renderReportSection(wrap, initType, initKey) {
  let type = ['month', 'quarter', 'annual'].includes(initType) ? initType : 'month';
  let key = initKey || '';
  wrap.innerHTML = '<div class="card"><h2>📊 总结报告</h2><p class="hint">正在读取操作日志与历史回填…</p></div>';
  let entries = [], backfillFailed = false;
  try {
    const r = await reportLoadMergedEntries();
    entries = r.entries; backfillFailed = r.backfillFailed;
  } catch (e) {
    entries = reportAllEntries(); backfillFailed = true;
  }
  const render = () => {
    if (!key) {
      const now = new Date();
      key = type === 'month' ? reportMonthKey(now) : type === 'quarter' ? `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}` : String(now.getFullYear());
    }
    const range = reportRange(type, key);
    const demo = !entries.length;
    /* 完全无数据才用示例数据并标注；有回填/oplog 时一律真实数据 */
    const shown = demo ? reportDemoEntries() : entries;
    const stats = reportAggregate(shown, range);
    const word = reportTypeWord(type);
    const options = reportPeriodOptions(shown, type);
    const past = options.filter((k) => k !== key);
    const backfillInRange = entries.filter((e) => e.source === 'backfill' && new Date(e.ts) >= range.start && new Date(e.ts) <= range.end).length;
    wrap.innerHTML = `<div class="toolbar">
        <button class="btn${type === 'month' ? '' : ' btn-ghost'}" data-t="month">月度</button>
        <button class="btn${type === 'quarter' ? '' : ' btn-ghost'}" data-t="quarter">季度</button>
        <button class="btn${type === 'annual' ? '' : ' btn-ghost'}" data-t="annual">年度</button>
        <select class="report-select" data-role="period">${options.map((k) => `<option value="${esc(k)}"${k === key ? ' selected' : ''}>${esc(reportRange(type, k).label)}</option>`).join('')}</select>
        <span class="spacer"></span><span class="hint">月度每月底、季度 3/6/9/1 月底、年度 12 月 30 号在主页面弹窗；平时从这里看往期</span>
      </div>
      ${reportRenderBody(stats, range, word, demo, backfillInRange)}
      ${backfillFailed ? '<div class="card"><p class="hint">历史回填没拉到（网络或 GitHub API 异常），以上仅为操作日志数据；刷新页面会再试一次。</p></div>' : ''}
      ${past.length ? `<div class="card"><h3>往期报告</h3><div class="toolbar">${past.map((k) => `<button class="btn btn-small" data-p="${esc(k)}">${esc(reportRange(type, k).label)}</button>`).join('')}</div></div>` : ''}`;
    wrap.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { type = b.dataset.t; key = ''; render(); }; });
    const sel = wrap.querySelector('[data-role="period"]');
    if (sel) sel.onchange = (e) => { key = e.target.value; render(); };
    wrap.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { key = b.dataset.p; render(); }; });
  };
  render();
}
/* 旧报告路由：重定向到写作页的报告区块（深链 #/stats/report:<type>:<key>），不留两个入口 */
routes.reports = (arg) => {
  location.hash = '#/stats/report' + (arg ? ':' + arg : '');
};
/* 到期弹窗：只在主页面（dashboard）触发（900ms 后复查一次当前页，防切页误弹）；同会话只处理一次 */
async function maybeShowReportPopup() {
  const cur = location.hash.replace('#/', '') || 'dashboard';
  if (!token() || cur !== 'dashboard' || window._reportPopupDone) return;
  const due = reportDuePeriods(new Date()).filter((p) => !reportIsDismissed(p.type, p.key));
  if (!due.length) return;
  window._reportPopupDone = true; // 本会话内只弹一轮（多周期同框处理）
  let entries = [];
  try { const r = await reportLoadMergedEntries(); entries = r.entries; } catch (e) { entries = reportAllEntries(); }
  /* 弹窗只用真实数据：没有日志就是 0 次操作，不套示例数据 */
  const overlay = document.createElement('div');
  overlay.className = 'modal-mask';
  const rows = (list) => list.map((p) => {
    const stats = reportAggregate(entries, reportRange(p.type, p.key));
    return `<div class="report-popup-row" data-k="${p.type}:${p.key}">
      <div><b>${esc(p.label)}</b> · ${stats.total} 次操作 · ${stats.posts} 篇内容 · ${stats.friends} 次友链</div>
      <div class="hint">${esc(reportReview(stats, reportTypeWord(p.type)))}</div>
      <div class="modal-ops">
        <button class="btn btn-small" data-view="${p.type}:${p.key}">查看完整报告</button>
        <button class="btn btn-small btn-ghost" data-x="${p.type}:${p.key}">× 确认</button>
      </div>
    </div>`;
  }).join('');
  overlay.innerHTML = `<div class="modal-card report-modal">
    <h3>📊 总结报告到了</h3>
    <p class="hint">下面这些周期的报告已生成，确认后不再重复弹；随时可以从「写作」页的报告区块查看往期。</p>
    ${rows(due)}
    <div class="modal-ops"><button class="btn btn-small" id="report-all-ok">全部确认</button></div>
  </div>`;
  const closeIfEmpty = () => { if (!overlay.querySelector('.report-popup-row')) overlay.remove(); };
  overlay.querySelectorAll('[data-x]').forEach((b) => {
    b.onclick = () => {
      const [t, ...rest] = b.dataset.x.split(':');
      reportDismiss(t, rest.join(':'));
      b.closest('.report-popup-row').remove();
      closeIfEmpty();
    };
  });
  overlay.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => { overlay.remove(); location.hash = '#/stats/report:' + b.dataset.view; };
  });
  overlay.querySelector('#report-all-ok').onclick = () => {
    due.forEach((p) => reportDismiss(p.type, p.key));
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { /* 点遮罩不关闭：必须点叉确认 */ } });
  document.body.appendChild(overlay);
}

/* ---------- 2026-10-25 新增：历史版本 / 全文搜索 / 媒体库 / 标签管理 ---------- */
function bigModal(title, sub) {
  const m = document.createElement('div');
  m.className = 'modal-mask';
  m.innerHTML = `<div class="modal-card modal-wide">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-small" data-x type="button">✕ 关闭</button></div>
    ${sub ? `<p class="hint">${esc(sub)}</p>` : ''}
    <div class="modal-body"></div></div>`;
  view.appendChild(m); /* 挂进 view：切换栏目时跟其它弹窗一样自动清掉，不残留 */
  const close = () => m.remove();
  m.querySelector('[data-x]').onclick = close;
  m.addEventListener('mousedown', (ev) => { if (ev.target === m) close(); });
  return { mask: m, body: m.querySelector('.modal-body'), close };
}
/* 逐行 diff（LCS）：返回带 +/-/空格 前缀的行数组；文件太大时返回 null */
function diffRows(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 9000000) return null;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ t: '-', s: a[i] }); i++; }
    else { rows.push({ t: '+', s: b[j] }); j++; }
  }
  while (i < n) rows.push({ t: '-', s: a[i++] });
  while (j < m) rows.push({ t: '+', s: b[j++] });
  return rows;
}
function diffHtml(oldText, newText) {
  const rows = diffRows(oldText.split('\n'), newText.split('\n'));
  if (!rows) return '<p class="hint">文件太大，跳过逐行对比。</p>';
  if (!rows.some((r) => r.t !== ' ')) return '<p class="hint">两个版本内容完全一致。</p>';
  let html = '', folding = false;
  rows.forEach((r, idx) => {
    const nearChange = rows.some((q, k) => q.t !== ' ' && Math.abs(k - idx) <= 2);
    if (r.t === ' ' && !nearChange) {
      if (!folding) { html += '<div class="diff-fold">⋯ 未改动 ⋯</div>'; folding = true; }
      return;
    }
    folding = false;
    html += `<div class="diff-row${r.t === '+' ? ' diff-add' : r.t === '-' ? ' diff-del' : ''}"><span class="diff-sign">${r.t}</span><span>${esc(r.s) || ' '}</span></div>`;
  });
  return `<div class="diff-box">${html}</div>`;
}
/* 🕘 历史版本：列出某文件的提交记录，可看原文、与当前版对比、一键恢复（恢复=新提交） */
async function openFileHistory(path, onRestored) {
  const { body, close } = bigModal('🕘 历史版本', path);
  body.innerHTML = '<p class="hint">加载提交记录中…</p>';
  let commits;
  try {
    commits = await gh(`/repos/${CFG.owner}/${CFG.repo}/commits?path=${encodeURIComponent(path)}&per_page=30`);
  } catch (e) { body.innerHTML = `<p class="hint">加载失败：${esc(e.message)}</p>`; return; }
  if (!Array.isArray(commits) || !commits.length) { body.innerHTML = '<p class="hint">这个文件还没有提交记录。</p>'; return; }
  body.innerHTML = `<div class="hist-list">${commits.map((c, i) => {
    const d = new Date(c.commit.committer.date);
    const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const msg = (c.commit.message || '').split('\n')[0];
    return `<div class="list-item"><span class="title">${esc(when)}${i === 0 ? ' <span class="meta">（当前）</span>' : ''}</span><span class="meta">${esc(msg)}</span><span class="spacer"></span>
      <button class="mini-btn" data-h="view" data-i="${i}">查看</button>
      <button class="mini-btn" data-h="diff" data-i="${i}">与当前对比</button>
      ${i === 0 ? '' : `<button class="mini-btn warn" data-h="restore" data-i="${i}">恢复此版</button>`}</div>`;
  }).join('')}</div><div id="hist-detail"></div>`;
  const detail = body.querySelector('#hist-detail');
  const textCache = {};
  const getVersionText = async (i) => {
    if (textCache[i] !== undefined) return textCache[i];
    const d = await gh(`/repos/${CFG.owner}/${CFG.repo}/contents/${path}?ref=${commits[i].sha}`);
    textCache[i] = b64decodeUnicode(d.content.replace(/\n/g, ''));
    return textCache[i];
  };
  body.querySelectorAll('[data-h]').forEach((btn) => {
    btn.onclick = async () => {
      const i = +btn.dataset.i, act = btn.dataset.h;
      const d = new Date(commits[i].commit.committer.date);
      const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      detail.innerHTML = '<p class="hint">读取该版本中…</p>';
      try {
        const verText = await getVersionText(i);
        if (act === 'view') {
          detail.innerHTML = `<h4>${when} 的版本原文</h4><pre class="hist-pre">${esc(verText)}</pre>`;
        } else if (act === 'diff') {
          const cur = await ghGetFile(path);
          detail.innerHTML = `<h4>${when} 版 → 当前版（- 删除 / + 新增）</h4>${diffHtml(verText, cur.text)}`;
        } else if (act === 'restore') {
          if (!confirm(`把这个文件恢复到 ${when} 的版本？\n恢复会产生一个新提交，当前内容仍能在历史里找回。`)) { detail.innerHTML = ''; return; }
          const cur = await ghGetFile(path);
          await saveWithLog(path, verText, cur.sha, `恢复 ${path} 到 ${when} 的版本 [管理台]`, { type: '历史', action: '恢复', target: path });
          toast('已恢复到该版本（新提交）');
          close();
          if (onRestored) onRestored();
        }
      } catch (e) { detail.innerHTML = `<p class="hint">操作失败：${esc(e.message)}</p>`; }
    };
  });
}
/* 读一个集合的全部文档（搜索索引 / 标签管理共用） */
async function loadCollectionDocs(key) {
  const col = CFG.collections[key];
  const entries = await ghGetFile(col.path);
  const list = (Array.isArray(entries) ? entries : []).filter((e) => col.mode === 'dir' ? e.type === 'dir' : e.name.endsWith('.md'));
  const docs = [];
  const run = async (e) => {
    try {
      let data, path;
      if (col.mode === 'dir') {
        const files = await ghGetFile(`${col.path}/${e.name}`);
        const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
        if (!md) return;
        path = `${col.path}/${e.name}/${md.name}`;
        data = await ghGetFile(path);
      } else {
        path = `${col.path}/${e.name}`;
        data = await ghGetFile(path);
      }
      const { fm, body } = parseFrontmatter(data.text);
      docs.push({ key, label: col.label, name: e.name, path, fm, body });
    } catch (err) { /* 单篇失败不影响整体 */ }
  };
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(run));
  return docs;
}
/* 🔍 全文搜索：索引只建一次（标题+正文都在浏览器内存里），之后输入即搜 */
let _searchIndex = null;
async function buildSearchIndex(onProgress) {
  const items = [];
  const keys = Object.keys(CFG.collections);
  let doneKeys = 0;
  for (const key of keys) {
    const docs = await loadCollectionDocs(key);
    docs.forEach((d) => items.push({
      key, label: d.label, name: d.name,
      title: d.fm.title || d.name,
      date: String(d.fm.published || '').slice(0, 10),
      text: (d.fm.title || '') + '\n' + d.body,
    }));
    doneKeys++;
    if (onProgress) onProgress(doneKeys, keys.length);
  }
  _searchIndex = { items, at: Date.now() };
  return _searchIndex;
}
routes.search = async () => {
  view.innerHTML = `<div class="card"><h2>🔍 全文搜索 <span class="sub">搜标题和正文，点结果直接进编辑器</span></h2>
    <div class="toolbar"><input type="text" id="q" placeholder="输入关键词，空格分隔多个词…" style="flex:1;min-width:200px">
    <button class="btn btn-ghost btn-small" id="q-rebuild" type="button">↻ 重建索引</button></div>
    <p class="hint" id="q-status"></p><div id="q-results"></div></div>`;
  const input = $('#q'), status = $('#q-status'), results = $('#q-results');
  const ensureIndex = async () => {
    if (_searchIndex) { status.textContent = `索引就绪：共 ${_searchIndex.items.length} 篇（文章/动态/项目/单页）`; return; }
    status.textContent = '正在建立索引（要把全部文章读一遍，稍等）…';
    await buildSearchIndex((d, t) => { status.textContent = `正在建立索引… ${d}/${t} 个栏目`; });
    status.textContent = `索引就绪：共 ${_searchIndex.items.length} 篇（文章/动态/项目/单页）`;
  };
  const snippet = (text, term) => {
    const idx = text.toLowerCase().indexOf(term);
    if (idx < 0) return esc(text.slice(0, 90)) + '…';
    const s = Math.max(0, idx - 36), e = Math.min(text.length, idx + term.length + 54);
    return (s > 0 ? '…' : '') + esc(text.slice(s, idx)) + '<mark>' + esc(text.slice(idx, idx + term.length)) + '</mark>' + esc(text.slice(idx + term.length, e)) + (e < text.length ? '…' : '');
  };
  const doSearch = () => {
    if (!_searchIndex) return;
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) { results.innerHTML = ''; return; }
    const hits = [];
    for (const it of _searchIndex.items) {
      const hay = it.text.toLowerCase(), titleHay = it.title.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      let score = 0;
      terms.forEach((t) => { if (titleHay.includes(t)) score += 10; score += Math.min(5, hay.split(t).length - 1); });
      hits.push({ it, score });
    }
    hits.sort((a, b) => b.score - a.score);
    results.innerHTML = hits.slice(0, 60).map(({ it }) => `
      <div class="list-item sr-item" data-k="${esc(it.key)}" data-n="${esc(it.name)}">
        <div class="sr-head"><span class="sr-chip">${esc(it.label)}</span><span class="title">${esc(it.title)} <span class="meta">${esc(it.date)}</span></span></div>
        <div class="sr-snip">${snippet(it.text.replace(/\s+/g, ' '), terms[0])}</div>
      </div>`).join('') || '<p class="hint">没搜到。换个词试试？</p>';
    results.querySelectorAll('.sr-item').forEach((el) => {
      el.onclick = () => { location.hash = `#/edit/${el.dataset.k}/${el.dataset.n}`; };
    });
  };
  input.addEventListener('input', doSearch);
  $('#q-rebuild').onclick = async () => { _searchIndex = null; await ensureIndex(); doSearch(); };
  await ensureIndex();
  input.focus();
};
/* 🗂 媒体库：浏览 R2 里已上传的文件（列表接口现成），复制链接 / 打开 / 删除（删前查引用） */
async function r2ListPage(prefix, cursor) {
  const qs = new URLSearchParams({ prefix: prefix || '', limit: '200' });
  if (cursor) qs.set('cursor', cursor);
  const res = await fetch('/api/r2-list?' + qs, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `列表失败: ${res.status}`); }
  return res.json();
}
async function r2ListAll(prefix) {
  const out = [];
  let cursor = null;
  do {
    const r = await r2ListPage(prefix, cursor);
    out.push(...(r.objects || []));
    cursor = r.truncated ? r.cursor : null;
  } while (cursor);
  return out;
}
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
/* 🗂 通用「从媒体库选图」选择器：列 R2 里的图片，点选回调完整 URL（结果按会话缓存，弹窗里可刷新） */
let _mlPickerCache = null;
async function openMediaPicker(onPick) {
  const old = document.querySelector('.mlp-mask');
  if (old) old.remove();
  const mask = document.createElement('div');
  mask.className = 'modal-mask mlp-mask';
  mask.innerHTML = `<div class="modal-card mlp-card">
    <div class="mlp-head"><h3>🗂 从媒体库选图</h3><span class="hint" id="mlp-count">加载中…</span>
    <input type="text" id="mlp-q" placeholder="按文件名筛选…">
    <button class="btn btn-small btn-ghost" id="mlp-refresh" type="button">↻ 刷新</button>
    <button class="btn btn-small btn-ghost" id="mlp-close" type="button">✕ 关闭</button></div>
    <div class="img-grid mlp-grid" id="mlp-grid"><p class="hint">正在读取媒体库…</p></div></div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('#mlp-close').onclick = close;
  mask.querySelector('#mlp-refresh').onclick = () => { _mlPickerCache = null; close(); openMediaPicker(onPick); };
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  let objs = _mlPickerCache;
  if (!objs) {
    try {
      objs = (await r2ListAll('')).filter((o) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(o.key));
      objs.sort((a, b) => String(b.uploaded || '').localeCompare(String(a.uploaded || '')));
      _mlPickerCache = objs;
    } catch (e) {
      const g = mask.querySelector('#mlp-grid');
      if (g) g.innerHTML = `<p class="hint">媒体库读取失败：${esc(e.message)}</p>`;
      return;
    }
  }
  const grid = mask.querySelector('#mlp-grid'), cnt = mask.querySelector('#mlp-count'), q = mask.querySelector('#mlp-q');
  if (!grid) return;
  function render() {
    const t = q.value.trim().toLowerCase();
    const all = objs.filter((o) => !t || o.key.toLowerCase().includes(t));
    const list = all.slice(0, 180);
    cnt.textContent = `共 ${objs.length} 张` + (t ? `，匹配 ${all.length} 张` : '') + (all.length > 180 ? '（只显示前 180 张）' : '');
    grid.innerHTML = '';
    list.forEach((o) => {
      const c = document.createElement('div');
      c.className = 'img-cell mlp-cell';
      c.innerHTML = `<img loading="lazy" src="${esc(o.url)}" alt=""><div class="url" title="${esc(o.key)}">${esc(o.key.split('/').pop())}</div>`;
      c.onclick = () => { close(); onPick(o.url); };
      grid.appendChild(c);
    });
    if (!list.length) grid.innerHTML = '<p class="hint">没有匹配的图片</p>';
  }
  q.addEventListener('input', render);
  render();
}
/* 🗂 选媒体库图片 → 读成文件塞进指定的 file input 并触发 change，复用各槽位原有的上传/替换逻辑 */
async function pickMediaIntoFileInput(inputEl) {
  if (!inputEl) { toast('找不到对应的上传槽位', true); return; }
  openMediaPicker(async (url) => {
    try {
      toast('正在读取所选图片…');
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const name = (url.split('/').pop() || 'image').split('?')[0] || 'image';
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) { toast('读取这张图失败（可能跨域限制），可以先下载到本地再上传', true); }
  });
}

/* 🎨 主题：切换博客默认壁纸模式；每个模式的图片设置在图片页 */
routes.theme = async () => {
  view.innerHTML = '<p class="hint">加载中…</p>';
  const P_SITE = 'src/config/siteConfig.ts';
  const P_BGW = 'src/config/backgroundWallpaper.ts';
  const P_FX = 'src/config/effectsConfig.ts';
  /* 在对象的某个块内读/写某个 key：先按 key 名定位块的左花括号，再数花括号找块尾，只动块内第一处匹配 */
  function blockOf(text, keyRe) {
    const m = text.match(keyRe);
    if (!m) return null;
    const open = text.indexOf('{', m.index);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) return { open, end: i }; }
    }
    return null;
  }
  function getIn(text, block, re) {
    if (!block) return null;
    const m = text.slice(block.open, block.end).match(re);
    return m ? m[1] : null;
  }
  function setIn(text, block, re, replacement) {
    if (!block) return null;
    const inner = text.slice(block.open, block.end + 1);
    if (!re.test(inner)) return null;
    const next = inner.replace(re, replacement);
    return text.slice(0, block.open) + next + text.slice(block.end + 1);
  }
  function parseSite(t) {
    const tc = blockOf(t, /themeColor\s*:/);
    const card = blockOf(t, /^\tcard\s*:/m);
    const pl = blockOf(t, /postListLayout\s*:/);
    const hue = getIn(t, tc, /hue\s*:\s*(\d+)/);
    const border = getIn(t, card, /border\s*:\s*(true|false)/);
    const follow = getIn(t, card, /followTheme\s*:\s*(true|false)/);
    const layout = getIn(t, pl, /defaultMode\s*:\s*"(\w+)"/);
    const layoutM = getIn(t, pl, /mobileDefaultMode\s*:\s*"(\w+)"/);
    if (hue === null || border === null || follow === null || layout === null) return null;
    return { hue: Number(hue), cardBorder: border === 'true', cardFollow: follow === 'true', layout, layoutMobile: layoutM || layout };
  }
  function parseBgw(t) {
    const mm = t.match(/^\tmode\s*:\s*"(\w+)"/m);
    const ht = blockOf(t, /homeText\s*:/);
    const cr = blockOf(t, /carousel\s*:/);
    const wv = blockOf(t, /waves\s*:/);
    const gr = blockOf(t, /gradient\s*:/);
    const homeTitle = getIn(t, ht, /enable\s*:\s*(true|false)/);
    const linksEnable = getIn(t, ht, /linksEnable\s*:\s*(true|false)/);
    let bannerLinks = [];
    {
      const seg = t.slice(ht.open, ht.end);
      const lm = seg.match(/links\s*:\s*\[/);
      if (lm) {
        const aStart = lm.index + lm[0].length - 1;
        let depth = 0, aEnd = -1;
        for (let i = aStart; i < seg.length; i++) {
          if (seg[i] === '[') depth++;
          else if (seg[i] === ']') { depth--; if (depth === 0) { aEnd = i; break; } }
        }
        if (aEnd > aStart) {
          const body = seg.slice(aStart + 1, aEnd);
          for (const om of body.matchAll(/\{([\s\S]*?)\}/g)) {
            const o = om[1];
            const pick = (k) => { const m = o.match(new RegExp(k + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return m ? JSON.parse('"' + m[1] + '"') : ''; };
            const sn = o.match(/showName\s*:\s*(true|false)/);
            const en = o.match(/enable\s*:\s*(true|false)/);
            bannerLinks.push({ name: pick('name'), icon: pick('icon'), url: pick('url'), showName: sn ? sn[1] === 'true' : false, enable: en ? en[1] === 'true' : true });
          }
        }
      }
    }
    const carousel = getIn(t, cr, /enable\s*:\s*(true|false)/);
    const wD = getIn(t, wv, /desktop\s*:\s*(true|false)/);
    const wM = getIn(t, wv, /mobile\s*:\s*(true|false)/);
    const gD = getIn(t, gr, /desktop\s*:\s*(true|false)/);
    const gM = getIn(t, gr, /mobile\s*:\s*(true|false)/);
    if (!mm || homeTitle === null || carousel === null || wD === null || gD === null || linksEnable === null) return null;
    return { mode: mm[1], homeTitle: homeTitle === 'true', carousel: carousel === 'true', waves: wD === 'true' && wM !== 'false', gradient: gD === 'true' && gM !== 'false', bannerEnable: linksEnable === 'true', bannerLinks };
  }
  function parseFx(t) {
    const keys = ['sakura', 'snow', 'firefly', 'notes', 'rain', 'meteor', 'bubbles', 'hearts', 'leaves', 'click'];
    const out = {};
    for (const k of keys) {
      const v = getIn(t, blockOf(t, new RegExp(k + 'Config\\s*:')), /enable\s*:\s*(true|false)/);
      if (v === null) return null;
      out[k] = v === 'true';
    }
    return out;
  }
  function applySite(t, s) {
    let out = t;
    out = setIn(out, blockOf(out, /themeColor\s*:/), /hue\s*:\s*\d+/, `hue: ${s.hue}`);
    if (out === null) return null;
    let card = blockOf(out, /^\tcard\s*:/m);
    out = setIn(out, card, /border\s*:\s*(?:true|false)/, `border: ${s.cardBorder}`);
    if (out === null) return null;
    card = blockOf(out, /^\tcard\s*:/m);
    out = setIn(out, card, /followTheme\s*:\s*(?:true|false)/, `followTheme: ${s.cardFollow}`);
    if (out === null) return null;
    let pl = blockOf(out, /postListLayout\s*:/);
    out = setIn(out, pl, /defaultMode\s*:\s*"\w+"/, `defaultMode: "${s.layout}"`);
    if (out === null) return null;
    pl = blockOf(out, /postListLayout\s*:/);
    out = setIn(out, pl, /mobileDefaultMode\s*:\s*"\w+"/, `mobileDefaultMode: "${s.layoutMobile}"`);
    return out;
  }
  function applyBgw(t, s) {
    let out = t.replace(/^\tmode\s*:\s*"\w+"/m, `\tmode: "${s.mode}"`);
    out = setIn(out, blockOf(out, /homeText\s*:/), /enable\s*:\s*(?:true|false)/, `enable: ${s.homeTitle}`);
    if (out === null) return null;
    out = setIn(out, blockOf(out, /homeText\s*:/), /linksEnable\s*:\s*(?:true|false)/, `linksEnable: ${s.bannerEnable}`);
    if (out === null) return null;
    {
      const ht2 = blockOf(out, /homeText\s*:/);
      const seg = out.slice(ht2.open, ht2.end);
      const lm = seg.match(/links\s*:\s*\[/);
      if (!lm) return null;
      const aStart = lm.index + lm[0].length - 1;
      let depth = 0, aEnd = -1;
      for (let i = aStart; i < seg.length; i++) {
        if (seg[i] === '[') depth++;
        else if (seg[i] === ']') { depth--; if (depth === 0) { aEnd = i; break; } }
      }
      if (aEnd < 0) return null;
      const items = (s.bannerLinks || []).map((l) =>
        '\t\t\t\t{\n' +
        `\t\t\t\t\tname: ${JSON.stringify(l.name || '')},\n` +
        `\t\t\t\t\ticon: ${JSON.stringify(l.icon || '')},\n` +
        `\t\t\t\t\turl: ${JSON.stringify(l.url || '')},\n` +
        (l.enable === false ? '\t\t\t\t\tenable: false,\n' : '') +
        (l.showName ? '\t\t\t\t\tshowName: true,\n' : '') +
        '\t\t\t\t},\n').join('');
      const newSeg = seg.slice(0, aStart) + '[\n' + items + '\t\t\t]' + seg.slice(aEnd + 1);
      out = out.slice(0, ht2.open) + newSeg + out.slice(ht2.end);
    }
    out = setIn(out, blockOf(out, /carousel\s*:/), /enable\s*:\s*(?:true|false)/, `enable: ${s.carousel}`);
    if (out === null) return null;
    let wv = blockOf(out, /waves\s*:/);
    out = setIn(out, wv, /desktop\s*:\s*(?:true|false)/, `desktop: ${s.waves}`);
    if (out === null) return null;
    wv = blockOf(out, /waves\s*:/);
    out = setIn(out, wv, /mobile\s*:\s*(?:true|false)/, `mobile: ${s.waves}`);
    if (out === null) return null;
    let gr = blockOf(out, /gradient\s*:/);
    out = setIn(out, gr, /desktop\s*:\s*(?:true|false)/, `desktop: ${s.gradient}`);
    if (out === null) return null;
    gr = blockOf(out, /gradient\s*:/);
    out = setIn(out, gr, /mobile\s*:\s*(?:true|false)/, `mobile: ${s.gradient}`);
    return out;
  }
  function applyFx(t, s) {
    let out = t;
    for (const k of ['sakura', 'snow', 'firefly', 'notes', 'rain', 'meteor', 'bubbles', 'hearts', 'leaves', 'click']) {
      out = setIn(out, blockOf(out, new RegExp(k + 'Config\\s*:')), /enable\s*:\s*(?:true|false)/, `enable: ${s[k]}`);
      if (out === null) return null;
    }
    return out;
  }
  let siteT, bgwT, fxT;
  try {
    [siteT, bgwT, fxT] = await Promise.all([
      ghGetFile(P_SITE).then((d) => d.text),
      ghGetFile(P_BGW).then((d) => d.text),
      ghGetFile(P_FX).then((d) => d.text),
    ]);
  } catch (e) { view.innerHTML = `<p class="hint">读取失败：${esc(e.message)}</p>`; return; }
  const pSite = parseSite(siteT), pBgw = parseBgw(bgwT), pFx = parseFx(fxT);
  if (!pSite || !pBgw || !pFx) { view.innerHTML = '<p class="hint">配置文件格式对不上（某个默认值没找到），已中止，没有改动任何文件。</p>'; return; }
  let st = { ...pSite, ...pBgw, ...pFx };
  let orig = JSON.stringify(st);
  const MODES = [
    { id: 'banner', icon: '🖼️', name: '横幅模式', desc: '顶部一条横幅，内容在下方滚动（现在用的就是它）' },
    { id: 'fullscreen', icon: '🌄', name: '全屏模式', desc: '壁纸铺满整个页面当背景' },
    { id: 'overlay', icon: '🫧', name: '透明覆盖', desc: '壁纸在内容上方半透明覆盖' },
    { id: 'none', icon: '⬜', name: '纯色模式', desc: '不显示壁纸，只用纯色背景' },
  ];
  const dirty = () => JSON.stringify(st) !== orig;
  function pill(key, label) {
    return `<label class="pill${st[key] ? ' on' : ''}"><input type="checkbox" data-k="${key}"${st[key] ? ' checked' : ''}>${label}</label>`;
  }
  const BL_ICON_MAP = {
    github: 'fa7-brands:github', telegram: 'fa7-brands:telegram', tg: 'fa7-brands:telegram', '电报': 'fa7-brands:telegram',
    discord: 'fa7-brands:discord', email: 'fa7-solid:envelope', mail: 'fa7-solid:envelope', '邮箱': 'fa7-solid:envelope', '邮件': 'fa7-solid:envelope',
    rss: 'fa7-solid:rss', '订阅': 'fa7-solid:rss', atom: 'fa7-solid:atom',
    bilibili: 'fa7-brands:bilibili', '哔哩哔哩': 'fa7-brands:bilibili', 'b站': 'fa7-brands:bilibili',
    youtube: 'fa7-brands:youtube', twitter: 'fa7-brands:x-twitter', x: 'fa7-brands:x-twitter',
    instagram: 'fa7-brands:instagram', facebook: 'fa7-brands:facebook', linkedin: 'fa7-brands:linkedin',
    steam: 'fa7-brands:steam', twitch: 'fa7-brands:twitch', qq: 'fa7-brands:qq',
    '微信': 'fa7-brands:weixin', wechat: 'fa7-brands:weixin', '微博': 'fa7-brands:weibo', weibo: 'fa7-brands:weibo',
  };
  const blAutoIcon = {};
  function guessIcon(name) { return BL_ICON_MAP[String(name || '').trim().toLowerCase()] || ''; }
  function blRow(l, i) {
    return `<div class="toolbar" style="gap:6px;margin-bottom:6px">
      <label class="pill${l.enable ? ' on' : ''}" title="这一条单独的开关"><input type="checkbox" data-bl="${i}:enable"${l.enable ? ' checked' : ''}>显示</label>
      <input type="text" data-bl="${i}:name" value="${esc(l.name)}" placeholder="名称" style="width:110px">
      <input type="text" data-bl="${i}:icon" value="${esc(l.icon)}" placeholder="图标代码" style="width:185px">
      <input type="text" data-bl="${i}:url" value="${esc(l.url)}" placeholder="链接" style="flex:1;min-width:150px">
      <select data-bl="${i}:showName"><option value="0"${l.showName ? '' : ' selected'}>只图标</option><option value="1"${l.showName ? ' selected' : ''}>图标+文字</option></select>
      <button type="button" class="btn btn-small btn-ghost" data-bl-del="${i}">删除</button>
    </div>`;
  }
  function seg(key, val, label) {
    return `<button type="button" class="btn btn-small${st[key] === val ? '' : ' btn-ghost'}" data-seg="${key}:${val}">${label}</button>`;
  }
  function render() {
    view.innerHTML = `
    <div class="card">
      <h2>🎨 外观默认值 <span class="sub">访客第一次打开博客时显示设置面板里的初始值；访客自己改过之后以访客的为准</span></h2>
      <div class="field"><label>主题色相（0–360，现在 ${st.hue}）</label>
        <div class="hue-bar"></div>
        <div class="toolbar"><input type="range" id="th-hue" min="0" max="360" step="1" value="${st.hue}" style="flex:1">
        <input type="number" id="th-hue-num" min="0" max="360" value="${st.hue}" style="width:84px"></div>
      </div>
      <div class="field"><label>文章布局（桌面默认）</label><div class="pills">${seg('layout', 'list', '☰ 列表')}${seg('layout', 'grid', '⊞ 网格')}</div></div>
      <div class="field"><label>文章布局（移动端默认）</label><div class="pills">${seg('layoutMobile', 'list', '☰ 列表')}${seg('layoutMobile', 'grid', '⊞ 网格')}</div></div>
      <div class="field"><label>卡片样式</label><div class="pills">${pill('cardBorder', '卡片边框和阴影')}${pill('cardFollow', '卡片跟随主题色')}</div></div>
    </div>
    <div class="card">
      <h2>🖼 默认壁纸模式 <span class="sub">访客也能在博客的调色板面板里自己切换</span></h2>
      <div class="theme-modes">
        ${MODES.map((m) => `
        <div class="theme-mode ${st.mode === m.id ? 'sel' : ''}" data-mode="${m.id}">
          <div class="tm-icon">${m.icon}</div>
          <div class="tm-name">${m.name}${pBgw.mode === m.id ? ' <span class="tag">当前默认</span>' : ''}</div>
          <div class="tm-desc">${m.desc}</div>
          ${m.id !== 'none' ? `<button class="btn btn-small" data-img="${m.id}">🖼 图片设置</button>` : '<span class="hint">纯色模式没有壁纸图</span>'}
        </div>`).join('')}
      </div>
      <div class="field" style="margin-top:14px"><label>壁纸设置</label><div class="pills">${pill('homeTitle', '首页壁纸标题')}${pill('carousel', '壁纸轮播')}${pill('waves', '水波纹动画')}${pill('gradient', '渐变过渡')}</div>
      <p class="hint">水波纹 / 渐变过渡这两个开关同时管桌面端和移动端的默认值；各模式用哪些图、单独轮不轮播，去「图片设置」里管。</p></div>
    </div>
    <div class="card">
      <h2>🔗 横幅联系方式 <span class="sub">显示在首页横幅大标题下方的一排小图标；侧边栏资料卡里的联系方式是另一处，不受这里影响</span></h2>
      <div class="pills">${pill('bannerEnable', '在横幅显示联系方式')}</div>
      <div style="margin-top:10px">${st.bannerLinks.map((l, i) => blRow(l, i)).join('')}</div>
      <button type="button" class="btn btn-small btn-ghost" id="bl-add">＋ 添加一个</button>
      <p class="hint">两个开关：上面的是总开关（整排显不显示），每条前面的是单条开关（先加着、暂时不想露面就关掉，不用删）。名称填 GitHub、Telegram、Discord、Bilibili 这类常见平台时，图标代码会根据名称自动带出来（带错了直接改，改过就不再覆盖）；其它图标填 Iconify 代码，如 fa7-solid:envelope；链接 http 开头是外部站、mailto: 是邮箱、/ 开头是站内页。名称在鼠标悬停时显示。</p>
    </div>
    <div class="card">
      <h2>🌸 特效默认值</h2>
      <div class="pills">${pill('sakura', '樱花特效')}${pill('snow', '雪花特效')}${pill('firefly', '萤火虫特效')}${pill('notes', '音符特效')}${pill('rain', '雨滴特效')}${pill('meteor', '流星特效')}${pill('bubbles', '泡泡特效')}${pill('hearts', '爱心特效')}${pill('leaves', '落叶特效')}${pill('click', '点击特效')}</div>
    </div>
    <div class="card">
      <div class="toolbar">
        <button class="btn" id="theme-save" ${dirty() ? '' : 'disabled'}>💾 保存到仓库</button>
        <span class="hint">一次保存 = 一次提交（最多动 siteConfig / backgroundWallpaper / effectsConfig 三个文件，没改的不动）；重新构建后生效。</span>
      </div>
    </div>`;
    view.querySelectorAll('[data-k]').forEach((cb) => {
      cb.onchange = () => { st[cb.dataset.k] = cb.checked; render(); };
    });
    view.querySelectorAll('[data-seg]').forEach((b) => {
      b.onclick = () => { const [k, v] = b.dataset.seg.split(':'); st[k] = v; render(); };
    });
    view.querySelectorAll('[data-bl]').forEach((inp) => {
      const upd = () => {
        const parts = inp.dataset.bl.split(':');
        const item = st.bannerLinks[Number(parts[0])];
        if (!item) return;
        if (inp.type === 'checkbox') {
          item[parts[1]] = inp.checked;
          const lab = inp.closest('label');
          if (lab) lab.classList.toggle('on', inp.checked);
        } else {
          item[parts[1]] = inp.tagName === 'SELECT' ? inp.value === '1' : inp.value;
        }
        if (parts[1] === 'icon') delete blAutoIcon[parts[0]];
        if (parts[1] === 'name') {
          const guess = guessIcon(inp.value);
          const iconInp = view.querySelector(`[data-bl="${parts[0]}:icon"]`);
          if (guess && iconInp) {
            const cur = item.icon || '';
            if (cur === '' || cur === 'fa7-solid:link' || cur === blAutoIcon[parts[0]]) {
              item.icon = guess;
              blAutoIcon[parts[0]] = guess;
              iconInp.value = guess;
            }
          }
        }
        const sb = $('#theme-save');
        if (sb) sb.disabled = !dirty();
      };
      inp.oninput = upd;
      inp.onchange = upd;
    });
    view.querySelectorAll('[data-bl-del]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.blDel);
        const nm = (st.bannerLinks[i] && st.bannerLinks[i].name) || '未命名';
        if (!confirm(`删除联系方式「${nm}」？`)) return;
        st.bannerLinks.splice(i, 1);
        render();
      };
    });
    const blAdd = $('#bl-add');
    if (blAdd) blAdd.onclick = () => { st.bannerLinks.push({ name: '', icon: 'fa7-solid:link', url: '', showName: false, enable: true }); render(); };
    view.querySelectorAll('.theme-mode').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('[data-img]')) return;
        st.mode = card.dataset.mode;
        render();
      };
    });
    view.querySelectorAll('[data-img]').forEach((b) => {
      b.onclick = () => { location.hash = '#/images/wp-' + b.dataset.img; };
    });
    const hueR = $('#th-hue'), hueN = $('#th-hue-num');
    const syncHue = (v) => {
      st.hue = Math.max(0, Math.min(360, Number(v) || 0));
      if (hueR) hueR.value = st.hue;
      if (hueN) hueN.value = st.hue;
      const sb = $('#theme-save');
      if (sb) sb.disabled = !dirty();
      const lbl = view.querySelector('.field label');
      if (lbl) lbl.textContent = `主题色相（0–360，现在 ${st.hue}）`;
    };
    if (hueR) hueR.oninput = () => syncHue(hueR.value);
    if (hueN) hueN.onchange = () => syncHue(hueN.value);
    const saveBtn = $('#theme-save');
    if (saveBtn) saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      try {
        const [fSite, fBgw, fFx] = await Promise.all([ghGetFile(P_SITE), ghGetFile(P_BGW), ghGetFile(P_FX)]);
        const nSite = applySite(fSite.text, st);
        const nBgw = applyBgw(fBgw.text, st);
        const nFx = applyFx(fFx.text, st);
        if (nSite === null || nBgw === null || nFx === null) throw new Error('配置文件格式对不上，已中止，没有改动任何文件');
        const files = [];
        if (nSite !== fSite.text) files.push({ path: P_SITE, content: nSite, encoding: 'utf-8' });
        if (nBgw !== fBgw.text) files.push({ path: P_BGW, content: nBgw, encoding: 'utf-8' });
        if (nFx !== fFx.text) files.push({ path: P_FX, content: nFx, encoding: 'utf-8' });
        if (!files.length) throw new Error('没有实际改动');
        /* 操作日志与配置文件同 1 个 commit（同 saveWithLog 的做法） */
        try {
          const curText = await oplogCurrentText();
          let entries = [];
          try { entries = JSON.parse(curText); } catch (e) { entries = []; }
          if (!Array.isArray(entries)) entries = [];
          const entry = { ts: new Date().toISOString(), type: '配置', action: '更新', target: '主题默认值（外观/壁纸/特效/横幅联系方式）', detail: '' };
          const merged = oplogDedup([...entries, ...oplogLoadPending(), entry]).slice(-OPLOG_MAX_ENTRIES);
          const oplogText = JSON.stringify(merged, null, 2) + '\n';
          files.push({ path: OPLOG_PATH, content: oplogText, encoding: 'utf-8' });
          await ghCommitMulti(files, '主题：显示设置默认值更新（外观/壁纸/特效/横幅联系方式）[管理台]');
          window._oplogText = oplogText;
          window._oplogEntries = merged;
          oplogSavePending([]);
        } catch (e2) {
          await ghCommitMulti(files, '主题：显示设置默认值更新（外观/壁纸/特效/横幅联系方式）[管理台]');
        }
        orig = JSON.stringify(st);
        pBgw.mode = st.mode;
        toast('主题默认值已保存 ✅ 重新构建后生效');
        render();
      } catch (e) {
        toast(e.message, true);
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 保存到仓库';
      }
    };
  }
  render();
};
routes.medialib = async () => {
  view.innerHTML = `<div class="card"><h2>🗂 媒体库 <span class="sub">R2 桶里已上传的文件</span></h2>
    <div class="toolbar" id="ml-chips"></div>
    <div class="toolbar"><input type="text" id="ml-filter" placeholder="按文件名筛选…" style="flex:1;min-width:180px"><span class="hint" id="ml-count"></span></div>
    <div class="img-grid" id="ml-grid"></div><p class="hint" id="ml-status">加载中…</p></div>`;
  const grid = $('#ml-grid'), status = $('#ml-status'), count = $('#ml-count');
  const CHIPS = [['', '全部'], ['posts/', '文章图'], ['dynamic/', '动态图'], ['projects/', '项目图'], ['admin/', '控制台'], ['videos/', '视频'], ['music/', '音乐']];
  let prefix = '', objects = [], filterText = '';
  const chipsEl = $('#ml-chips');
  chipsEl.innerHTML = CHIPS.map(([p, label]) => `<button class="btn btn-small${p === '' ? '' : ' btn-ghost'}" data-p="${esc(p)}" type="button">${esc(label)}</button>`).join('');
  chipsEl.querySelectorAll('[data-p]').forEach((b) => {
    b.onclick = () => { prefix = b.dataset.p; chipsEl.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('btn-ghost', x !== b)); render(); };
  });
  $('#ml-filter').addEventListener('input', (e) => { filterText = e.target.value.trim().toLowerCase(); render(); });
  const isImg = (k) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(k);
  function render() {
    const list = objects.filter((o) => o.key.startsWith(prefix) && (!filterText || o.key.toLowerCase().includes(filterText)));
    count.textContent = `共 ${list.length} 个文件`;
    grid.innerHTML = '';
    list.forEach((o) => {
      const cell = document.createElement('div');
      cell.className = 'img-cell';
      const fileName = o.key.split('/').pop();
      cell.innerHTML = `${isImg(o.key)
        ? `<img loading="lazy" src="${esc(o.url)}" alt="">`
        : `<div class="ml-file-icon">${esc((fileName.split('.').pop() || 'file').toUpperCase().slice(0, 5))}</div>`}
        <div class="url" title="${esc(o.key)}">${esc(fileName)}</div>
        <div class="meta">${fmtSize(o.size)} · ${esc(String(o.uploaded || '').slice(0, 10))}</div>
        <div class="ops">
          <button class="mini-btn" data-a="copy">复制链接</button>
          <button class="mini-btn" data-a="open">打开</button>
          <button class="mini-btn danger" data-a="del">删除</button>
        </div>`;
      cell.querySelector('[data-a=copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(o.url); toast('链接已复制'); }
        catch (e) { prompt('复制这条链接：', o.url); }
      };
      cell.querySelector('[data-a=open]').onclick = () => window.open(o.url, '_blank', 'noopener');
      cell.querySelector('[data-a=del]').onclick = async () => {
        /* 删前查引用：拿全文索引扫一遍，哪些文章/动态在用这张图 */
        let refs = [];
        try {
          toast('正在检查引用…');
          if (!_searchIndex) await buildSearchIndex();
          refs = _searchIndex.items.filter((it) => it.text.includes(o.key) || (o.url && it.text.includes(o.url)));
        } catch (e) { /* 索引失败：照常走确认，只是不带引用信息 */ }
        const refMsg = refs.length
          ? `\n⚠️ 有 ${refs.length} 篇在引用它：${refs.slice(0, 3).map((r) => `《${r.title}》`).join('、')}${refs.length > 3 ? ' 等' : ''}。删了它们会裂图！`
          : '\n未发现文章/动态引用它（配置类引用不在检查范围）。';
        if (!confirm(`确定删除 R2 文件？\n${o.key}${refMsg}`)) return;
        try {
          const res = await fetch('/api/r2-delete', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: [o.key] }),
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(b.error || `删除失败: ${res.status}`);
          if (!b.deleted) throw new Error('服务端没有删除这个文件（可能路径受限）');
          objects = objects.filter((x) => x.key !== o.key);
          render();
          toast('已删除');
        } catch (e) { toast(e.message, true); }
      };
      grid.appendChild(cell);
    });
    if (!list.length) grid.innerHTML = '<p class="hint">这个范围里没有文件。</p>';
  }
  try {
    objects = await r2ListAll('');
    status.textContent = '删除前会自动检查文章/动态里的引用；配置（壁纸、封面等）里的引用不在检查范围，删之前心里有数。';
    render();
  } catch (e) { status.textContent = '加载失败：' + e.message; }
};
/* 🏷 标签管理：跨文章聚合标签/分类，改名/合并/删除一次 commit 全部改好 */
routes.tags = async () => {
  view.innerHTML = '<div class="card"><h2>🏷 加载中…（要把全部文章读一遍）</h2></div>';
  let docs;
  try {
    const [posts, projects] = await Promise.all([loadCollectionDocs('posts'), loadCollectionDocs('projects')]);
    docs = [...posts, ...projects];
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  const tagMap = new Map(), catMap = new Map();
  docs.forEach((d, di) => {
    const tags = Array.isArray(d.fm.tags) ? d.fm.tags : (d.fm.tags ? [d.fm.tags] : []);
    tags.forEach((t) => { const k = String(t); if (!tagMap.has(k)) tagMap.set(k, new Set()); tagMap.get(k).add(di); });
    if (d.fm.category) { const k = String(d.fm.category); if (!catMap.has(k)) catMap.set(k, new Set()); catMap.get(k).add(di); }
  });
  const sortEntries = (map) => [...map.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  async function applyChange(field, from, to) {
    const affected = docs.filter((d) => field === 'tags'
      ? (Array.isArray(d.fm.tags) ? d.fm.tags : []).map(String).includes(from)
      : String(d.fm.category || '') === from);
    if (!affected.length) { toast('没有文章用到它'); return; }
    const label = field === 'tags' ? '标签' : '分类';
    const what = to ? `把${label}「${from}」${tagMap.has(to) || catMap.has(to) ? '合并' : '改名'}为「${to}」` : `从所有文章删除${label}「${from}」`;
    if (!confirm(`${what}，共 ${affected.length} 篇，一次提交全部改好。继续？`)) return;
    const files = affected.map((d) => {
      const fm = { ...d.fm };
      if (field === 'tags') {
        const seen = new Set(), out = [];
        (Array.isArray(d.fm.tags) ? d.fm.tags : []).map(String).forEach((t) => {
          const nt = t === from ? to : t;
          if (nt && !seen.has(nt)) { seen.add(nt); out.push(nt); }
        });
        fm.tags = out;
      } else if (to) fm.category = to;
      else delete fm.category;
      return { path: d.path, content: serializeFrontmatter(fm, d.body) };
    });
    try {
      toast(`正在提交（${files.length} 篇合成 1 个 commit）…`);
      await ghCommitMulti(files, `${label}${to ? `「${from}」→「${to}」` : `删除「${from}」`}（${files.length} 篇）[管理台]`);
      oplogRecord('标签', to ? '改名' : '删除', `${from}${to ? ' → ' + to : ''}`, `${files.length} 篇`);
      toast('已全部改好（Pages 重新构建后生效）');
      routes.tags();
    } catch (e) { toast(e.message, true); }
  }
  const rowHtml = (field, name, set) => `
    <div class="list-item"><span class="title">${field === 'tags' ? '🏷' : '🗂'} ${esc(name)}</span>
      <span class="meta">${set.size} 篇</span><span class="spacer"></span>
      <button class="mini-btn" data-f="${field}" data-a="rename" data-n="${esc(name)}">改名</button>
      <button class="mini-btn" data-f="${field}" data-a="merge" data-n="${esc(name)}">合并到…</button>
      <button class="mini-btn danger" data-f="${field}" data-a="del" data-n="${esc(name)}">删除</button></div>`;
  view.innerHTML = `
    <div class="card"><h2>🗂 分类 <span class="sub">共 ${catMap.size} 个 · 改名/合并/删除会把所有用到它的文章一次改好（1 个 commit）</span></h2>
      ${sortEntries(catMap).map(([n, s]) => rowHtml('category', n, s)).join('') || '<p class="hint">还没有分类</p>'}</div>
    <div class="card"><h2>🏷 标签 <span class="sub">共 ${tagMap.size} 个 · 改名/合并/删除会把所有用到它的文章一次改好（1 个 commit）</span></h2>
      ${sortEntries(tagMap).map(([n, s]) => rowHtml('tags', n, s)).join('') || '<p class="hint">还没有标签</p>'}</div>`;
  view.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => {
      const field = b.dataset.f, name = b.dataset.n, act = b.dataset.a;
      if (act === 'del') { applyChange(field, name, null); return; }
      const to = (prompt(act === 'rename' ? `把「${name}」改名为：` : `把「${name}」合并到哪个${field === 'tags' ? '标签' : '分类'}？（填已有的就是合并，填新的就是改名）`, name) || '').trim();
      if (!to || to === name) return;
      applyChange(field, name, to);
    };
  });
};

/* ---------- 字体设置：src/config/fontConfig.ts ---------- */
const FONT_PATH = 'src/config/fontConfig.ts';
/* 解析 fontsList 里注册过的字体（name 与 cssVariable 成对出现） */
function parseFontsList(src) {
  const out = [];
  const re = /name:\s*"([^"]+)",\s*\n\s*cssVariable:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], var: m[2] });
  return out;
}
routes.fonts = async () => {
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  let sha = null, fonts = [], cfg = null, src = '';
  try {
    const data = await ghGetFile(FONT_PATH);
    sha = data.sha; src = data.text;
    fonts = parseFontsList(src);
    const idx = src.indexOf('export const fontConfig');
    const tail = idx >= 0 ? src.slice(idx) : '';
    const selM = tail.match(/selected:\s*\[([^\]]*)\]/);
    const selArr = selM ? [...selM[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : ['system'];
    cfg = {
      enable: tsGetBool(tail, 'enable', true),
      selected: selArr[0] || 'system',
      bannerTitleFont: tsGetStr(tail, 'bannerTitleFont'),
      bannerSubtitleFont: tsGetStr(tail, 'bannerSubtitleFont'),
      navbarTitleFont: tsGetStr(tail, 'navbarTitleFont'),
      codeFont: tsGetStr(tail, 'codeFont'),
    };
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  /* 下拉显示名中文化（只改显示，value 仍是 CSS 变量、配置里的字体名不动——那是加载器认的名字） */
  const FONT_CN = {
    '--font-noto-serif-sc': '思源宋体',
    '--font-lxgw-wenkai': '霞鹜文楷',
    '--font-zhuque-fangsong': '朱雀仿宋',
    '--font-inter': 'Inter · 英文无衬线',
    '--font-jetbrains-mono': 'JetBrains Mono · 代码等宽',
    '--font-zen-maru-gothic': 'Zen Maru Gothic · 日系圆体',
    '--font-greatvibes': 'Great Vibes · 手写花体',
  };
  const fontLabel = (f) => FONT_CN[f.var] || f.name;
  const fontOpts = (cur) => `<option value="system"${cur === 'system' ? ' selected' : ''}>系统字体（不加载网络字体）</option>` +
    fonts.map((f) => `<option value="${esc(f.var)}"${cur === f.var ? ' selected' : ''}>${esc(fontLabel(f))}</option>`).join('');
  const regionOpts = (cur) => `<option value=""${!cur ? ' selected' : ''}>（跟随全局）</option>` +
    fonts.map((f) => `<option value="${esc(f.var)}"${cur === f.var ? ' selected' : ''}>${esc(fontLabel(f))}</option>`).join('');
  const slotField = (id, label, opts) => `<div class="field"><label>${label}</label><select id="${id}">${opts}</select></div>`;

  view.innerHTML = `
  <div class="toolbar">
    <button class="btn btn-ghost" id="btn-back">← 返回</button>
    <span class="spacer"></span>
    <button class="btn" id="btn-save-fonts">💾 保存字体设置</button>
  </div>
  <div class="card"><h2>🔤 字体 <span class="sub">${FONT_PATH}</span></h2>
    <p class="hint">保存后重新构建网站生效。英文字体（Inter 等）只影响英文与数字；中文想变样选思源宋体 / 霞鹜文楷 / 朱雀仿宋。本地中文字体构建时自动子集化，不会拖慢网页。</p>
    <div class="field"><label>选项</label><div class="pills">
      <label class="pill${cfg.enable ? ' on' : ''}"><input type="checkbox" id="font-enable"${cfg.enable ? ' checked' : ''}>🔤 启用自定义字体</label>
    </div></div>
    ${slotField('font-selected', '全局字体（正文与界面）', fontOpts(cfg.selected))}
    <div class="grid2">
      ${slotField('font-banner-title', '横幅主标题', regionOpts(cfg.bannerTitleFont))}
      ${slotField('font-banner-sub', '横幅副标题', regionOpts(cfg.bannerSubtitleFont))}
      ${slotField('font-navbar', '导航栏标题', regionOpts(cfg.navbarTitleFont))}
      ${slotField('font-code', '代码字体', regionOpts(cfg.codeFont))}
    </div>
    <p class="hint">已注册字体 ${fonts.length} 款：${fonts.map((f) => esc(f.name)).join('、')}。想再加新字体，先在 fontConfig.ts 的 fontsList 里注册，之后这里就能选。</p>
  </div>`;

  $('#btn-back').onclick = () => { location.hash = '#/dashboard'; };
  view.querySelectorAll('.pill input[type=checkbox]').forEach((el) => {
    el.onchange = () => el.closest('.pill').classList.toggle('on', el.checked);
  });
  $('#btn-save-fonts').onclick = async () => {
    const enable = $('#font-enable').checked;
    const vals = {
      selected: $('#font-selected').value,
      bannerTitleFont: $('#font-banner-title').value,
      bannerSubtitleFont: $('#font-banner-sub').value,
      navbarTitleFont: $('#font-navbar').value,
      codeFont: $('#font-code').value,
    };
    const idx = src.indexOf('export const fontConfig');
    if (idx < 0) { toast('没找到 fontConfig 段，文件结构可能变了'); return; }
    let tail = src.slice(idx);
    tail = tail.replace(/enable:\s*(true|false)/, 'enable: ' + enable);
    tail = tail.replace(/selected:\s*\[[^\]]*\]/, `selected: [${JSON.stringify(vals.selected)}]`);
    for (const k of ['bannerTitleFont', 'bannerSubtitleFont', 'navbarTitleFont', 'codeFont']) {
      tail = tail.replace(new RegExp(k + ':\\s*"[^"]*"'), `${k}: ${JSON.stringify(vals[k])}`);
    }
    const newSrc = src.slice(0, idx) + tail;
    if (newSrc === src) { toast('没有改动'); return; }
    try {
      await saveWithLog(FONT_PATH, newSrc, sha, '修改字体设置 [管理台]', { type: '字体', action: '更新', target: '字体设置' });
      toast('字体设置已保存，重新构建后生效');
      routes.fonts();
    } catch (e) { toast('保存失败：' + e.message); }
  };
};

/* ---------- 启动 ---------- */
function hideLoader() {
  var w = document.getElementById('loader-wrapper');
  if (!w) return;
  w.classList.add('loaded');
  setTimeout(function () { w.remove(); }, 2000);
}
async function init() {
  $('#btn-logout').onclick = logout;
  const bt = $('#btn-theme');
  if (bt) bt.onclick = toggleTheme;
  syncThemeBtn();
  const bu = $('#btn-ui');
  if (bu) bu.onclick = (e) => { e.stopPropagation(); toggleUiPanel(); };
  document.querySelectorAll('[data-ui-set]').forEach((b) => { b.onclick = () => setUiMode(b.dataset.uiSet); });
  document.querySelectorAll('[data-layout-set]').forEach((b) => { b.onclick = () => setLayout(b.dataset.layoutSet); });
  document.querySelectorAll('[data-lv-set]').forEach((b) => { b.onclick = () => setListView(b.dataset.lvSet); });
  const uh = $('#ui-hue');
  if (uh) uh.oninput = () => setUiHue(parseInt(uh.value, 10));
  document.querySelectorAll('[data-hue-set]').forEach((b) => { b.onclick = () => setUiHue(parseInt(b.dataset.hueSet, 10)); });
  document.querySelectorAll('[data-hue-mono]').forEach((b) => { b.onclick = () => setUiMono(); });
  document.addEventListener('click', (e) => {
    const p = $('#ui-panel');
    if (p && !p.classList.contains('hidden') && !p.contains(e.target)) toggleUiPanel(false);
  });
  // OAuth 回调
  if (new URLSearchParams(location.search).has('code')) {
    view.innerHTML = '<div class="card"><h2>登录中…</h2></div>';
    const ok = await finishLogin().catch((e) => { toast(e.message, true); return false; });
    if (!ok) { routes.login(); hideLoader(); return; }
  }
  if (!token()) { routes.login(); hideLoader(); return; }
  $('#user-badge').textContent = '👤 ' + (localStorage.getItem(USER_KEY) || '');
  $('#user-badge').classList.remove('hidden');
  $('#btn-logout').classList.remove('hidden');
  window.addEventListener('hashchange', router);
  router();
  hideLoader();
  checkCustomBgExists(); /* 异步确认自定义背景是否存在，跨设备有效 */
}
init();
