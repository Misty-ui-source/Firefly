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
/* 控制台导航定义：key → 默认名称 */
function navDefs() {
  const defs = {
    dashboard: '🏠 首页', stats: '📊 写作',
    images: '🖼 图片', music: '🎵 音乐', gallery: '📷 相册',
    announce: '📢 公告', friends: '🔗 友链', booknav: '🔖 书签', navmgr: '🧭 导航', videos: '🎬 视频', profile: '👤 简介', banner: '🖼️ 横幅',
    timeline: '🕘 时间线', thoughts: '💭 碎碎念',
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
  const isActive = (key) => cur === key || (location.hash === '' && key === 'dashboard') || (key === 'gallery' && cur.startsWith('gallery-'));
  const mkBtn = (key) => {
    const b = document.createElement('button');
    b.textContent = navLabel(key);
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
  };
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (page === 'login' || reduced) { render(); return; }
  if (wasLogin) { playCRT(); render(); return; } // 从登录页进入：CRT 开机动画
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
/* ---------- 控制台内部背景：默认多张轮换（30s 淡入淡出） ---------- */
const INNER_BG_POOL = ['login-art.jpg', 'login-art-alt.jpg', 'login-art-sketch.png'];
const INNER_BG_CUSTOM = 'admin-inner-bg.jpg';
const BG_ROTATE_KEY = 'admin-inner-bg-rotate';
function bgRotateOn() {
  try { return localStorage.getItem(BG_ROTATE_KEY) !== '0'; } catch (e) { return true; }
}
function innerBgPool() {
  const pool = INNER_BG_POOL.slice();
  if (BG_CUSTOM_EXISTS) pool.push(INNER_BG_CUSTOM);
  return pool;
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
  const key = (isLogin ? 'L' : 'C') + (on ? 'R' : 'D') + '|' + pool.join(',');
  if (!force && key === _bgKey) return;
  _bgKey = key;
  stopInnerBg();
  const layers = [a, b];
  if (isLogin || !on) {
    layers[0].style.opacity = '0'; layers[1].style.opacity = '0';
    document.body.classList.remove('has-bg');
    return;
  }
  document.body.classList.add('has-bg');
  const url = (f) => `url("./${f}")`;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let idx = 0, front = 0;
  layers[0].style.backgroundImage = url(pool[0]);
  layers[0].style.opacity = '1'; layers[1].style.opacity = '0';
  if (pool.length > 1) { const im = new Image(); im.src = './' + pool[1]; } // 预加载下一张
  if (pool.length < 2 || reduced) return; // 单张或减弱动效：静止显示
  _bgTimer = setInterval(() => {
    idx = (idx + 1) % pool.length;
    const back = 1 - front;
    layers[back].style.backgroundImage = url(pool[idx]); // 已预加载，直接换不闪
    layers[back].style.opacity = '1';
    layers[front].style.opacity = '0';
    front = back;
    const nx = new Image(); nx.src = './' + pool[(idx + 1) % pool.length]; // 预加载再下一张
  }, 30000);
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
  /* 控制台背景图：config.js 的 adminBg 可切换（图片管理 → 控制台背景） */
  const bgFile = (CFG.adminBg || 'login-art.jpg').replace(/^\/+/, '');
  stage.style.backgroundImage = `url("./${bgFile}")`;
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
/* 写作数据栏目：折线图 + 热力图 */
routes.stats = async () => {
  view.innerHTML = '<div class="card"><h2>📊 写作数据</h2><p class="hint">正在读取仓库数据…</p></div>';
  const [postDates, dynDates] = await Promise.all([fetchPostDates(), fetchDynDates()]);
  if (!postDates.length && !dynDates.length) {
    view.innerHTML = '<div class="card"><h2>📊 写作数据</h2><p class="hint">没有读到写作数据。</p></div>';
    return;
  }
  view.innerHTML = '<div class="card"><h2>📊 写作数据</h2><p class="hint">文章与动态的发布统计，数据来自仓库实时读取。</p></div>';
  renderWriteCharts(postDates, dynDates);
};
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

  const jobs = { posts: postStats, dynamic: dynStats };
  for (const [key, col] of Object.entries(CFG.collections)) {
    const d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = `<div class="stat-head"><span class="lbl">${col.label}</span><span class="num">…</span></div><div class="stat-rows"></div>`;
    d.onclick = () => { location.hash = '#/' + key; };
    grid.appendChild(d);
    (async () => {
      const fn = jobs[key] || simpleStats;
      const { total, details } = await fn(col);
      const numEl = d.querySelector('.num');
      if (numEl) numEl.textContent = total;
      const rowsEl = d.querySelector('.stat-rows');
      if (rowsEl) rowsEl.innerHTML = details.map(([icon, label, val]) =>
        `<div class="stat-row"><span class="dot"></span>${icon} ${label} <b>${esc(String(val))}</b></div>`).join('');
    })();
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
        rows.push({ e, div });
      }
      /* 文章列表：异步回填 published 写作时间 + 真实标题（每批 4 个并发） */
      if (key === 'posts' && rows.length) {
        const fill = async ({ e, div }) => {
          try {
            const files = await ghGetFile(`${col.path}/${e.name}`);
            const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
            if (!md) return;
            const data = await ghGetFile(`${col.path}/${e.name}/${md.name}`);
            const { fm } = parseFrontmatter(data.text);
            const dEl = div.querySelector('.date');
            if (dEl && fm.published) dEl.textContent = '📅 ' + String(fm.published).slice(0, 10);
            const tEl = div.querySelector('.title');
            if (tEl && fm.title) tEl.textContent = fm.title;
          } catch (err) { /* 单篇失败不影响其他 */ }
        };
        for (let i = 0; i < rows.length; i += 4) {
          await Promise.all(rows.slice(i, i + 4).map(fill));
        }
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
      <button class="btn btn-small" id="btn-video" type="button" title="插入视频">🎬 视频</button>
      <button class="btn btn-small" data-md="hl" type="button" title="高亮">✨ 高亮</button>
      <button class="btn btn-small" data-md="codeblock" type="button" title="代码块">📦 代码块</button>
      <button class="btn btn-small" data-md="task" type="button" title="任务列表">☑️ 任务</button>
      <button class="btn btn-small" data-md="table" type="button" title="表格">🗒 表格</button>
      <button class="btn btn-small" data-md="hr" type="button" title="分割线">➖ 分割线</button>
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
      else if (k === 'hl') wrapSel('==', '==', '高亮文字');
      else if (k === 'codeblock') insertAtCursor('\n```js\n代码\n```\n');
      else if (k === 'task') insertAtCursor('\n- [ ] 任务\n');
      else if (k === 'table') insertAtCursor('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n');
      else if (k === 'hr') insertAtCursor('\n---\n');
    };
  });
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
function buildAnnouncementTs({ content, closable, linkEnable, linkText, linkUrl, external }) {
  return `import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
\t// 公告标题，留空则走i18n默认标题
\ttitle: "",

\t// 公告内容
\tcontent: "${tsEsc(content)}",

\t// 是否允许用户关闭公告
\tclosable: ${closable},

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
};
`;
}
routes.announce = async () => {
  view.innerHTML = '<div class="card"><h2>加载中…</h2></div>';
  let sha = null, external = false;
  let content = '', closable = true, linkEnable = true, linkText = '', linkUrl = '';
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
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  view.innerHTML = `
  <div class="toolbar">
    <button class="btn btn-ghost" id="btn-back">← 返回</button>
    <span class="spacer"></span>
    <button class="btn" id="btn-save-ann">💾 保存公告</button>
  </div>
  <div class="card"><h2>📢 网站公告 <span class="sub">${ANN_PATH}</span></h2>
    <p class="hint">网站顶部的公告栏，一句话即可。保存后重新构建网站生效。</p>
    <div class="field"><label>公告内容</label>
      <input type="text" id="ann-content" class="big" value="${esc(content)}" placeholder="一句话公告"></div>
    <div class="field"><label>选项</label><div class="pills">
      <label class="pill${closable ? ' on' : ''}"><input type="checkbox" id="ann-closable"${closable ? ' checked' : ''}>❌ 允许用户关闭</label>
      <label class="pill${linkEnable ? ' on' : ''}"><input type="checkbox" id="ann-link-enable"${linkEnable ? ' checked' : ''}>🔗 显示链接</label>
    </div></div>
    <div id="ann-link-zone" class="${linkEnable ? '' : 'hidden'}">
      <div class="grid2">
        <div class="field"><label>链接文本</label><input type="text" id="ann-link-text" value="${esc(linkText)}" placeholder="了解更多"></div>
        <div class="field"><label>链接 URL</label><input type="text" id="ann-link-url" value="${esc(linkUrl)}" placeholder="/about/"></div>
      </div>
    </div>
  </div>`;

  $('#btn-back').onclick = () => { location.hash = '#/dashboard'; };
  view.querySelectorAll('.pill input[type=checkbox]').forEach((el) => {
    el.onchange = () => {
      el.closest('.pill').classList.toggle('on', el.checked);
      if (el.id === 'ann-link-enable') $('#ann-link-zone').classList.toggle('hidden', !el.checked);
    };
  });
  $('#btn-save-ann').onclick = async () => {
    const text = buildAnnouncementTs({
      content: $('#ann-content').value.trim(),
      closable: $('#ann-closable').checked,
      linkEnable: $('#ann-link-enable').checked,
      linkText: $('#ann-link-text').value.trim(),
      linkUrl: $('#ann-link-url').value.trim(),
      external,
    });
    const btn = $('#btn-save-ann');
    btn.disabled = true;
    try {
      await ghPutFile(ANN_PATH, text, sha, '更新网站公告 [管理台]');
      toast('公告已保存，重新构建网站后生效');
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
  let sha = null, head = '', tail = '', list = [];
  try {
    const data = await ghGetFile(FRIENDS_PATH);
    sha = data.sha;
    const parts = friendsExtract(data.text);
    head = parts.head; tail = parts.tail;
    list = friendsParseBody(parts.body);
    list.sort((a, b) => b.weight - a.weight);
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
    <div class="toolbar"><span class="spacer"></span>
      <button class="btn btn-small btn-ghost" data-a="cancel">取消</button>
      <button class="btn btn-small" data-a="oksave">确定</button>
    </div></div>`;
  }
  function wireRssTest(formEl) {
    const btn = formEl.querySelector('[data-a=rsstest]');
    if (!btn) return;
    btn.onclick = async () => {
      const url = formEl.querySelector('[data-k=rss]').value.trim();
      const tip = formEl.querySelector('.rss-test-tip');
      if (!url) { tip.textContent = '先填 RSS 地址'; return; }
      btn.disabled = true; tip.textContent = '测试中…';
      try {
        const r = await fetch('/api/rss-test?url=' + encodeURIComponent(url), { headers: { Authorization: `Bearer ${token()}` } });
        const j = await r.json();
        tip.innerHTML = j.ok
          ? `<span style="color:#16a34a">✓ 有效，约 ${j.count} 篇</span>`
          : `<span style="color:#dc2626">✗ ${esc(j.error || '无效')}（构建时会自动跳过）</span>`;
      } catch (e) { tip.textContent = '测试失败：' + e.message; }
      btn.disabled = false;
    };
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
        fe.querySelector('[data-a=cancel]').onclick = () => { fe.classList.add('hidden'); fe.innerHTML = ''; };
        fe.querySelector('[data-a=oksave]').onclick = () => {
          const f = list[i];
          fe.querySelectorAll('[data-k]').forEach((el) => {
            const k = el.dataset.k;
            if (k === 'enabled') f.enabled = el.checked;
            else if (k === 'tags') f.tags = el.value.split(',').map((s) => s.trim()).filter(Boolean);
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
      <button class="btn" id="btn-fsave" disabled>💾 保存到仓库</button>
    </div>
    <p class="hint">↑↓ 调整顺序（保存后按此顺序展示）；停用=前台隐藏但保留。</p>
    <div id="friend-new"></div>
    <div id="friend-list"></div>`;
  render();

  $('#btn-fadd').onclick = () => {
    const box = $('#friend-new');
    if (box.innerHTML) { box.innerHTML = ''; return; }
    box.innerHTML = formHtml({ title: '', siteurl: '', imgurl: '', desc: '', tags: ['Blog'], rss: '', enabled: true });
    wireRssTest(box);
    box.querySelector('[data-a=cancel]').onclick = () => { box.innerHTML = ''; };
    box.querySelector('[data-a=oksave]').onclick = () => {
      const f = { tags: [] };
      box.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        if (k === 'enabled') f.enabled = el.checked;
        else if (k === 'tags') f.tags = el.value.split(',').map((s) => s.trim()).filter(Boolean);
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
      const text = head + '\n' + body + '\n' + tail;
      const r = await ghPutFile(FRIENDS_PATH, text, sha, '更新友链 [管理台]');
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
          <button class="btn btn-small" data-a="gup">↑</button><button class="btn btn-small" data-a="gdown">↓</button>
          <button class="btn btn-small" data-a="gedit">编辑分组</button><button class="btn btn-small" data-a="iadd">＋书签</button>
          <button class="btn btn-small btn-danger" data-a="gdel">删分组</button></div>
        <div class="gform hidden"></div>
        ${g.items.map((it, ii) => `
          <div class="list-item" data-ii="${ii}">
            <span class="title">${esc(it.title || '(无标题)')}</span><span class="meta">${esc(it.url)}</span>
            <button class="btn btn-small" data-a="iup">↑</button><button class="btn btn-small" data-a="idown">↓</button>
            <button class="btn btn-small" data-a="iedit">编辑</button><button class="btn btn-small btn-danger" data-a="idel">删除</button>
          </div><div class="iform hidden"></div>`).join('')}
        <div class="inew"></div>
      </div>`).join('');
    box.querySelectorAll('[data-g]').forEach((card) => {
      const gi = +card.dataset.g, g = groups[gi];
      const qsa = (s) => card.querySelector(s);
      qsa('[data-a=gup]').onclick = () => { if (gi > 0) { [groups[gi - 1], groups[gi]] = [groups[gi], groups[gi - 1]]; markDirty(); render(); } };
      qsa('[data-a=gdown]').onclick = () => { if (gi < groups.length - 1) { [groups[gi + 1], groups[gi]] = [groups[gi], groups[gi + 1]]; markDirty(); render(); } };
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
        const nw = card.querySelector('.inew');
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
      <button class="btn" id="btn-gadd">＋ 添加分组</button><span class="spacer"></span>
      <span class="hint" id="booknav-count"></span><button class="btn" id="btn-bsave" disabled>💾 保存到仓库</button>
    </div><p class="hint">↑↓ 调整顺序（保存后按此顺序展示）。图标留空则自动获取目标站 favicon。</p>
    <div id="booknav-new"></div><div id="booknav-list"></div>`;
  render();
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
      const r = await ghPutFile(BOOKNAV_PATH, text, sha, '更新书签导航 [管理台]');
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
    return { primary: arr('primary'), secondary: arr('secondary'), labels };
  };
  let layout = parseLayout(cfgText) || { primary: [], secondary: [], labels: {} };
  const defs = navDefs();
  const allKeys = Object.keys(defs);
  // 补齐漏掉的 key
  allKeys.forEach((k) => { if (!layout.primary.includes(k) && !layout.secondary.includes(k)) layout.secondary.push(k); });
  layout.primary = layout.primary.filter((k) => allKeys.includes(k));
  layout.secondary = layout.secondary.filter((k) => allKeys.includes(k));
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
  }
  view.innerHTML = `<div class="toolbar"><span class="spacer"></span>
      <button class="btn" id="btn-navmsave" disabled>💾 保存到仓库</button></div>
    <p class="hint">调整控制台导航栏：↑↓ 排序，→··· / ←主栏 切换分组，改名自定义显示名称。保存后所有设备生效。</p>
    <div id="navm-list"></div>`;
  render();
  $('#btn-navmsave').onclick = async () => {
    const btn = $('#btn-navmsave'); btn.disabled = true;
    try {
      const q = (s) => `'${s}'`;
      const labelsStr = Object.entries(layout.labels).map(([k, v]) => `${k}: '${v.replace(/'/g, "\\'")}'`).join(', ');
      const newLayout = `navLayout: {\n    primary: [${layout.primary.map(q).join(', ')}],\n    secondary: [${layout.secondary.map(q).join(', ')}],\n    labels: { ${labelsStr} },\n  },`;
      const text = cfgText.replace(/navLayout\s*:\s*\{[\s\S]*?\n\s*\},/, newLayout);
      if (text === cfgText) throw new Error('配置未变化或格式不匹配');
      const r = await ghPutFile(NAVMGR_PATH, text, sha, '更新控制台导航栏 [管理台]');
      sha = r.content.sha; cfgText = text;
      // 同步到当前页
      CFG.navLayout = { primary: layout.primary.slice(), secondary: layout.secondary.slice(), labels: { ...layout.labels } };
      toast('已保存，刷新页面生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
};

/* ---------- 时间线管理 ---------- */
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
  const markDirty = () => { $('#btn-tlsave').disabled = false; };
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
    overlay.querySelector('#tl-cancel').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
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
      const tags = v('#tl-tags').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      if (tags.length) obj.tags = tags;
      const link = v('#tl-link'); if (link) obj.link = link;
      const img = v('#tl-image'); if (img) obj.image = img;
      if (idx >= 0) items[idx] = { ...items[idx], ...obj };
      else items.unshift(obj);
      overlay.remove();
      markDirty(); render();
    };
  }
  view.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-tladd">＋ 新增节点</button>
      <span class="spacer"></span>
      <button class="btn" id="btn-tlsave" disabled>💾 保存到仓库</button></div>
    <p class="hint">时间线显示在博客首页。↑↓ 排序，新增的节点默认排最前面。保存后重新构建生效。</p>
    <div id="tl-list"></div>`;
  render();
  $('#btn-tladd').onclick = () => openEditor(-1);
  $('#btn-tlsave').onclick = async () => {
    const btn = $('#btn-tlsave'); btn.disabled = true;
    try {
      const text = genTS(items);
      if (text === cfgText) throw new Error('配置未变化');
      const r = await ghPutFile(TIMELINE_PATH, text, sha, '更新时间线 [管理台]');
      sha = r.content.sha; cfgText = text;
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
  const markDirty = () => { $('#btn-thsave').disabled = false; };
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
    overlay.querySelector('#th-cancel').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
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
      overlay.remove();
      markDirty(); render();
    };
  }
  view.innerHTML = `<div class="toolbar">
      <button class="btn" id="btn-thadd">＋ 新增碎碎念</button>
      <span class="spacer"></span>
      <button class="btn" id="btn-thsave" disabled>💾 保存到仓库</button></div>
    <p class="hint">碎碎念显示在 /gallery/thoughts/ 星空页面。新增自动记录发布时间，编辑自动记录更新时间。保存后重新构建生效。</p>
    <div id="th-list"></div>`;
  render();
  $('#btn-thadd').onclick = () => openEditor(-1);
  $('#btn-thsave').onclick = async () => {
    const btn = $('#btn-thsave'); btn.disabled = true;
    try {
      const text = genTS(items);
      if (text === cfgText) throw new Error('配置未变化');
      const r = await ghPutFile(THOUGHTS_PATH, text, sha, '更新碎碎念 [管理台]');
      sha = r.content.sha; cfgText = text;
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
            toast('已删除'); load();
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
        await ghPutFile(repoPath, b64, sha, `替换头像 ${repoPath} [管理台]`, true);
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
      const r = await ghPutFile(PROFILE_PATH, text, sha, '更新简介卡片 [管理台]');
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
      const r = await ghPutFile(BANNER_PATH, text, sha, '更新横幅文字 [管理台]');
      sha = r.content.sha; src = text; toast('已保存，构建后生效');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
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
