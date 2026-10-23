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
function nav() {
  const n = $('#nav');
  n.innerHTML = '';
  n.classList.remove('hidden');
  const items = [['dashboard', '🏠 首页'], ['stats', '📊 写作'], ...Object.entries(CFG.collections).map(([k, c]) => [k, c.label]), ['images', '🖼 图片'], ['music', '🎵 音乐'], ['gallery', '📷 相册'], ['announce', '📢 公告']];
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
  const wasLogin = document.body.classList.contains('is-login');
  if (page !== 'login' && window._loginTimer) { clearInterval(window._loginTimer); window._loginTimer = null; }
  document.body.classList.toggle('is-login', page === 'login');
  nav();
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
const BG_CUSTOM_KEY = 'admin-inner-bg-custom';
function bgRotateOn() {
  try { return localStorage.getItem(BG_ROTATE_KEY) !== '0'; } catch (e) { return true; }
}
function innerBgPool() {
  const pool = INNER_BG_POOL.slice();
  try { if (localStorage.getItem(BG_CUSTOM_KEY) === '1') pool.push(INNER_BG_CUSTOM); } catch (e) {}
  return pool;
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
  const q = quotes[Math.floor(Math.random() * quotes.length)];
  $('#quote-text').textContent = '\u201C' + q.text + '\u201D';
  $('#quote-from').textContent = '— ' + q.from;
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
  const isArchived = (fm) => String(fm.archived).toLowerCase() === 'true';
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
        ['📦', '已存档', rows.filter(isArchived).length],
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
          ${key === 'posts' ? '<button class="btn btn-small btn-archive">📦 存档</button>' : ''}
          <button class="btn btn-small btn-danger">删除</button>`;
        const btns = div.querySelectorAll('button');
        const btnEdit = btns[0], btnDel = btns[btns.length - 1];
        const btnArch = key === 'posts' ? div.querySelector('.btn-archive') : null;
        btnEdit.onclick = () => { location.hash = `#/edit/${key}/${encodeURIComponent(e.name)}`; };
        if (btnArch) btnArch.onclick = async () => {
          try {
            const files = await ghGetFile(`${col.path}/${e.name}`);
            const md = (Array.isArray(files) ? files : []).find((f) => f.name.endsWith('.md'));
            if (!md) { toast('找不到文章文件', true); return; }
            const data = await ghGetFile(`${col.path}/${e.name}/${md.name}`);
            const { fm, body } = parseFrontmatter(data.text);
            const nowArchived = String(fm.archived).toLowerCase() === 'true';
            if (nowArchived) delete fm.archived; else fm.archived = true;
            await ghPutFile(`${col.path}/${e.name}/${md.name}`, serializeFrontmatter(fm, body), data.sha,
              `${nowArchived ? '取消存档' : '存档'} ${e.name} [管理台]`);
            toast(nowArchived ? '已取消存档，前台恢复显示' : '已存档，前台不再显示（构建后生效）');
            router();
          } catch (err) { toast(err.message, true); }
        };
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
            if (String(fm.archived).toLowerCase() === 'true') {
              if (tEl) tEl.innerHTML = '📦 ' + esc(tEl.textContent);
              const bA = div.querySelector('.btn-archive');
              if (bA) bA.textContent = '📤 取消存档';
              div.classList.add('is-archived');
            }
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
      ${pill('archived', '📦 存档', isTrue(fm.archived))}
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
}
init();
