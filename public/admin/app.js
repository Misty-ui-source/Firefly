/* Alexander 管理台：原生 JS 单页，无构建步骤
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
  const res = await fetch(GH_API + path, {
    ...opts,
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
async function ghPutFile(path, text, sha, message) {
  return gh(`/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `更新 ${path} [管理台]`,
      content: b64encodeUnicode(text),
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
    client_id: CFG.githubClientId, scope: 'public_repo',
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
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!res.ok) { toast('换 token 失败: ' + res.status, true); return false; }
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

/* ---------- 简易 Markdown 预览 ---------- */
function mdPreview(src) {
  let html = esc(src);
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>').replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^(?!<[hu]|<li|<ul)(.+)$/gm, '<p>$1</p>').replace(/<p><\/p>/g, '');
  return html;
}

/* ---------- R2 上传 ---------- */
function fileToWebp(file, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('WebP 转换失败')); }, 'image/webp', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
async function uploadImages(files, dir) {
  if (!dir) throw new Error('请先填写 R2 目录名');
  const fd = new FormData();
  fd.append('dir', dir);
  for (const f of files) {
    let blob = f, name = f.name;
    if (f.type.startsWith('image/') && !f.name.endsWith('.webp')) {
      blob = await fileToWebp(f);
      name = f.name.replace(/\.[^.]+$/, '') + '.webp';
    }
    fd.append('files', blob, name);
  }
  const res = await fetch('/api/r2-upload', {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `上传失败: ${res.status}`);
  }
  return res.json(); // { urls: [...] }
}

/* ---------- 路由与视图 ---------- */
const routes = {};
function nav() {
  const n = $('#nav');
  n.innerHTML = '';
  n.classList.remove('hidden');
  const items = [['dashboard', '🏠 首页'], ...Object.entries(CFG.collections).map(([k, c]) => [k, c.label])];
  for (const [key, label] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    if (location.hash.replace('#/', '') === key || (location.hash === '' && key === 'dashboard')) b.classList.add('active');
    b.onclick = () => { location.hash = '#/' + key; };
    n.appendChild(b);
  }
}
function router() {
  const h = location.hash.replace('#/', '') || 'dashboard';
  const [page, arg] = h.split('/');
  nav();
  if (routes[page]) routes[page](decodeURIComponent(arg || ''));
  else routes.dashboard();
}

/* 登录页 */
routes.login = () => {
  $('#nav').classList.add('hidden');
  view.innerHTML = `<div class="card login-wrap">
    <div class="big">🛠</div>
    <h2>Alexander 管理台</h2>
    <p class="hint">用 GitHub 登录，浏览器直写仓库，图片存 R2</p>
    <button class="btn" id="btn-login">用 GitHub 登录</button>
  </div>`;
  $('#btn-login').onclick = startLogin;
};

/* 首页 */
routes.dashboard = async () => {
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  const grid = document.createElement('div');
  grid.className = 'stat-grid';
  view.innerHTML = '<div class="card"><h2>👋 欢迎回来，<span id="d-user"></span></h2><p class="hint">选个集合开始干活。保存后会自动 commit 到 GitHub，构建发版走 Pages。</p></div>';
  $('#d-user').textContent = localStorage.getItem(USER_KEY) || '';
  view.appendChild(grid);
  for (const [key, col] of Object.entries(CFG.collections)) {
    try {
      const list = await ghGetFile(col.path);
      const count = Array.isArray(list) ? list.filter((x) => x.name.endsWith('.md') || x.type === 'dir').length : 0;
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<div class="num">${count}</div><div class="lbl">${col.label}</div>`;
      d.onclick = () => { location.hash = '#/' + key; };
      grid.appendChild(d);
    } catch (e) { /* 忽略 */ }
  }
};

/* 列表页 */
function listRoute(key) {
  return async () => {
    const col = CFG.collections[key];
    view.innerHTML = `<div class="toolbar">
        <button class="btn" id="btn-new">＋ 新建${col.label}</button>
        <span class="spacer"></span><span class="hint">${col.path}</span>
      </div><div id="list"></div>`;
    $('#btn-new').onclick = () => { location.hash = `#/edit/${key}/__new__`; };
    const listEl = $('#list');
    listEl.innerHTML = '<div class="card">加载中…</div>';
    try {
      const items = await ghGetFile(col.path);
      const entries = (Array.isArray(items) ? items : []).filter((x) => x.type === 'dir' || x.name.endsWith('.md'));
      if (!entries.length) { listEl.innerHTML = '<div class="card">空的，来一篇吧 👆</div>'; return; }
      listEl.innerHTML = '';
      // 动态按文件名倒序
      entries.sort((a, b) => b.name.localeCompare(a.name));
      for (const e of entries) {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `<span class="title">${esc(e.name)}</span><span class="meta">${e.type}</span>
          <button class="btn btn-small">编辑</button>
          <button class="btn btn-small btn-danger">删除</button>`;
        const [btnEdit, btnDel] = div.querySelectorAll('button');
        btnEdit.onclick = () => { location.hash = `#/edit/${key}/${encodeURIComponent(e.name)}`; };
        btnDel.onclick = async () => {
          if (!confirm(`确定删除 ${e.name}？`)) return;
          try {
            if (e.type === 'dir') {
              const files = await ghGetFile(`${col.path}/${e.name}`);
              for (const f of files) await ghDelFile(`${col.path}/${e.name}/${f.name}`, f.sha, `删除 ${e.name}/${f.name} [管理台]`);
            } else {
              await ghDelFile(`${col.path}/${e.name}`, e.sha);
            }
            toast('已删除');
            router();
          } catch (err) { toast(err.message, true); }
        };
        listEl.appendChild(div);
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
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  let fm = {}, body = '', sha = null, filePath = '', dirName = '';

  try {
    if (isNew) {
      fm = { published: nowISO().slice(0, 10), draft: 'false' };
      if (key === 'dynamic') { filePath = `${col.path}/${col.newFileName()}`; fm = { published: nowISO(), pinned: 'false' }; }
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

  const fieldDefs = {
    title: ['标题 title', 'text'], published: ['发布时间 published', 'text'],
    updated: ['更新时间 updated', 'text'], description: ['描述 description', 'text'],
    image: ['封面 image', 'text'], tags: ['标签 tags（逗号分隔）', 'text'],
    category: ['分类 category', 'text'], draft: ['草稿 draft', 'check'],
    pinned: ['置顶 pinned', 'check'],
  };
  const fields = col.fields || Object.keys(fieldDefs);
  let formHtml = '';
  for (const f of fields) {
    const [label, type] = fieldDefs[f] || [f, 'text'];
    let val = fm[f] ?? '';
    if (Array.isArray(val)) val = val.join(', ');
    if (type === 'check') {
      const checked = String(val).toLowerCase() === 'true' ? 'checked' : '';
      formHtml += `<div class="field"><label class="checkline"><input type="checkbox" data-f="${f}" ${checked}> ${esc(label)}</label></div>`;
    } else {
      formHtml += `<div class="field"><label>${esc(label)}</label><input type="text" data-f="${f}" value="${esc(val)}"></div>`;
    }
  }
  if (isNew && col.mode === 'dir') {
    formHtml = `<div class="field"><label>目录名（英文）</label><input type="text" id="f-dirname" placeholder="my-new-post"></div>
      <div class="field"><label>文件名</label><input type="text" id="f-filename" value="index.md"></div>` + formHtml;
  }

  view.innerHTML = `<div class="toolbar">
      <button class="btn btn-ghost" id="btn-back">← 返回</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost" id="btn-preview">预览</button>
      <button class="btn" id="btn-save">💾 保存发布</button>
    </div>
    <div class="card"><h2>${isNew ? '新建' : '编辑'}${col.label} <span class="sub">${esc(filePath || '')}</span></h2>${formHtml}</div>
    <div class="card"><h2>正文 <span class="sub">Markdown</span></h2>
      <div class="toolbar"><input type="file" id="f-img" accept="image/*" multiple class="hidden">
        <button class="btn btn-small" id="btn-img">🖼 插入图片（R2）</button>
        <input type="text" id="f-r2dir" placeholder="R2 目录名，如 dynamic/2026-10-23" style="flex:1;border:3px solid #000;border-radius:10px;padding:6px 10px">
      </div>
      <div class="field"><textarea id="md-body" class="code" rows="18">${esc(body)}</textarea></div>
      <div id="preview" class="preview hidden"></div>
    </div>`;

  $('#btn-back').onclick = () => { location.hash = '#/' + key; };
  $('#btn-preview').onclick = () => {
    const p = $('#preview');
    p.classList.toggle('hidden');
    p.innerHTML = mdPreview($('#md-body').value);
  };
  $('#btn-img').onclick = () => $('#f-img').click();
  $('#f-img').onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const dir = $('#f-r2dir').value.trim();
    toast('上传中…');
    try {
      const { urls } = await uploadImages(files, dir);
      const ta = $('#md-body');
      const ins = urls.map((u) => `![图片](${u})`).join('\n');
      const pos = ta.selectionStart;
      ta.value = ta.value.slice(0, pos) + '\n' + ins + '\n' + ta.value.slice(pos);
      toast(`上传成功 ${urls.length} 张`);
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  };
  $('#btn-save').onclick = async () => {
    const newFm = {};
    view.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') newFm[f] = el.checked ? 'true' : 'false';
      else if (f === 'tags') newFm[f] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
      else newFm[f] = el.value.trim();
    });
    const newBody = $('#md-body').value;
    let path = filePath;
    if (isNew) {
      if (col.mode === 'dir') {
        const d = $('#f-dirname').value.trim(), fn = $('#f-filename').value.trim() || 'index.md';
        if (!d) { toast('请填写目录名', true); return; }
        path = `${col.path}/${d}/${fn}`;
      }
      sha = null;
    }
    const text = serializeFrontmatter(newFm, newBody);
    $('#btn-save').disabled = true;
    try {
      await ghPutFile(path, text, sha, `${isNew ? '新建' : '更新'} ${path} [管理台]`);
      toast('保存成功！');
      location.hash = '#/' + key;
    } catch (err) { toast(err.message, true); $('#btn-save').disabled = false; }
  };
};

/* ---------- 启动 ---------- */
async function init() {
  $('#btn-logout').onclick = logout;
  // OAuth 回调
  if (new URLSearchParams(location.search).has('code')) {
    view.innerHTML = '<div class="card"><h2>登录中…</h2></div>';
    const ok = await finishLogin().catch((e) => { toast(e.message, true); return false; });
    if (!ok) { routes.login(); return; }
  }
  if (!token()) { routes.login(); return; }
  $('#user-badge').textContent = '👤 ' + (localStorage.getItem(USER_KEY) || '');
  $('#user-badge').classList.remove('hidden');
  $('#btn-logout').classList.remove('hidden');
  window.addEventListener('hashchange', router);
  router();
}
init();
