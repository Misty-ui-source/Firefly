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
  const items = [['dashboard', '🏠 首页'], ...Object.entries(CFG.collections).map(([k, c]) => [k, c.label]), ['images', '🖼 图片'], ['music', '🎵 音乐'], ['gallery', '📷 相册']];
  const cur = location.hash.replace('#/', '');
  for (const [key, label] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cur === key || (location.hash === '' && key === 'dashboard') || (key === 'gallery' && cur.startsWith('gallery-'))) b.classList.add('active');
    b.onclick = () => { n.classList.remove('open'); location.hash = '#/' + key; };
    n.appendChild(b);
  }
  const mb = $('#btn-menu');
  if (mb && !mb._wired) { mb._wired = true; mb.onclick = () => n.classList.toggle('open'); }
}
function router() {
  const h = location.hash.replace('#/', '') || 'dashboard';
  const [page, ...rest] = h.split('/');
  const arg = rest.join('/');
  document.body.classList.toggle('is-login', page === 'login');
  nav();
  if (routes[page]) routes[page](decodeURIComponent(arg || ''));
  else routes.dashboard();
}

/* 登录页：装饰图原图完整鲜明呈现（不做淡化/半透明处理），hue 174 青绿品牌风 */
routes.login = () => {
  document.body.classList.add('is-login');
  $('#nav').classList.add('hidden');
  view.innerHTML = `<div class="login-stage">
    <div class="login-card">
      <div class="login-body">
        <img class="login-avatar" src="/avatar.png" alt="zhz" onerror="this.style.display='none'">
        <h1>Alexander <span class="brand">管理台</span></h1>
        <p class="login-desc">博客的中控室 —— 内容、图片、音乐，一处打理。</p>
        <ul class="login-feats">
          <li><span>🖼</span>图片管理：背景 / 头像 / 贴纸一键换</li>
          <li><span>🎵</span>音乐管理：歌单增删改、调顺序</li>
          <li><span>📷</span>相册管理：新建相册、批量传图</li>
          <li><span>📝</span>内容管理：文章 / 动态 / 项目 / 单页</li>
          <li><span>☁️</span>R2 图床：上传自动转 WebP</li>
        </ul>
        <button class="btn btn-login" id="btn-login">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
          用 GitHub 登录
        </button>
        <p class="hint">登录即授权浏览器直写仓库 · 每次保存自动 commit</p>
      </div>
    </div>
    <div class="login-foot">🛠 Alexander 自研管理台 · hue 174</div>
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
  /* 控制台背景图：config.js 的 adminBg 可切换（图片管理 → 控制台背景） */
  const bgFile = (CFG.adminBg || 'login-art.png').replace(/^\/+/, '');
  stage.style.backgroundImage = `url("./${bgFile}")`;
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

  /* ============ 表单：doulor 式分区编辑器 ============ */
  const isPost = key === 'posts';
  const isDynamic = key === 'dynamic';
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
    <div class="field"><label>描述</label>
      <textarea data-f="description" rows="2" placeholder="一句话简介，显示在文章列表页">${esc(fm.description ?? '')}</textarea></div>
    <div class="field"><label>封面</label>
      <div class="cover-row">
        <input type="text" data-f="image" id="f-image" value="${esc(fm.image ?? '')}" placeholder=https://… 或 /assets/…">
        <input type="file" id="f-cover" accept="image/*" class="hidden">
        <button class="btn btn-small" id="btn-cover" type="button">🖼 上传</button>
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

  const r2dirDefault = isDynamic ? `dynamic/${new Date().toISOString().slice(0, 10)}` : '';
  view.innerHTML = `
  <div class="toolbar">
    <button class="btn btn-ghost" id="btn-back">← 返回</button>
    <span class="spacer"></span>
    <button class="btn btn-ghost" id="btn-preview">👁 预览</button>
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
      <button class="btn btn-small" id="btn-img" type="button">🖼 插入图片</button>
      <input type="file" id="f-img" accept="image/*" multiple class="hidden">
      <input type="text" id="f-r2dir" value="${r2dirDefault}" placeholder="R2 目录，如 dynamic/2026-10-23">
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
  const updCount = () => { $('#char-count').textContent = ta.value.replace(/\s/g, '').length; };
  ta.addEventListener('input', updCount); updCount();
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
    };
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
      else if (f === 'tags') newFm[f] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
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
function hideLoader() {
  var w = document.getElementById('loader-wrapper');
  if (!w) return;
  w.classList.add('loaded');
  setTimeout(function () { w.remove(); }, 2000);
}
async function init() {
  $('#btn-logout').onclick = logout;
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
}
init();
