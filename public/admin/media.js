/* Alexander Console：图片管理 + 音乐管理（media.js，在 app.js 之后加载）
 * 图片槽位：背景壁纸 / 头像 / Favicon / 首页贴纸 / 导航 Logo / Devices 配图 / 相册封面
 * 音乐：src/config/musicConfig.ts 的 local.playlist 增删改排序
 * 约定：R2 适合远程 URL 的槽位（壁纸/音乐/封面）；固定路径文件走 GitHub Contents API base64 覆盖
 */
'use strict';

/* ================= 通用：二进制 / 图片 ================= */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsDataURL(blob);
  });
}
// 图片转码/缩放。format: image/png | image/jpeg | image/webp；avif 看浏览器脸色（调用方自行判断 blob.type）
function convertImage(file, { format = 'image/webp', quality = 0.85, maxDim = 0 } = {}) {
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
      URL.revokeObjectURL(url);
      c.toBlob((b) => {
        if (b && b.size > 0) resolve(b);
        else reject(new Error('图片转换失败'));
      }, format, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
async function ghPutBinary(path, base64, sha, message) {
  return gh(`/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || `更新 ${path} [管理台]`,
      content: base64,
      branch: CFG.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}
async function getSha(path) {
  try { const d = await ghGetFile(path); return d.sha || null; }
  catch (e) { return null; }
}
// 上传图片 → 转码 → base64 覆盖仓库固定路径文件（头像 / favicon / 贴纸 / devices / logo 专用）
async function replaceRepoImage(repoPath, file, { format = 'image/webp', quality = 0.9, maxDim = 0, label = '' } = {}) {
  const blob = await convertImage(file, { format, quality, maxDim });
  const b64 = await blobToBase64(blob);
  const sha = await getSha(repoPath);
  await ghPutBinary(repoPath, b64, sha, `替换图片 ${repoPath} [管理台]`);
  toast(`已更新 ${label || repoPath}`);
}
// 仓库文件 → raw 预览地址（公开仓库免鉴权，面板里直接 <img> 可用）
function repoRawUrl(repoPath) {
  return `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/${repoPath}`;
}
// 配置里的图片值 → 可预览 URL（远程 URL / public 绝对路径 / src 相对路径）
function cfgImgPreview(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return repoRawUrl('public' + v);
  return repoRawUrl('src/' + v);
}
// R2 原样上传（不转 WebP，给 mp3 用）
async function uploadRawFiles(files, dir) {
  if (!dir) throw new Error('缺少 R2 目录名');
  const fd = new FormData();
  fd.append('dir', dir);
  for (const f of files) fd.append('files', f, f.name);
  const res = await fetch('/api/r2-upload', {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `上传失败: ${res.status}`);
  }
  return res.json();
}

/* ================= 通用：TS 配置文本读写 ================= */
// 提取 key: [...] 或 key: "..."（行首匹配，自动跳过 // 注释行）
function extractConfigValue(text, key) {
  const re = new RegExp(`^(\\s*)${key}\\s*:\\s*(\\[[\\s\\S]*?\\]|"(?:[^"\\\\]|\\\\.)*")`, 'm');
  const m = text.match(re);
  if (!m) return null;
  return { indent: m[1], raw: m[2], isArray: m[2].startsWith('['), start: m.index, end: m.index + m[0].length };
}
function parseStringList(arrayRaw) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(arrayRaw))) out.push(m[1]);
  return out;
}
function parseConfigStrings(found) {
  if (!found) return [];
  return found.isArray ? parseStringList(found.raw) : [found.raw.slice(1, -1)];
}
function serializeStringList(items, indent) {
  if (!items.length) return '[]';
  const lines = items.map((s) => `${indent}\t"${s}",`);
  return `[\n${lines.join('\n')}\n${indent}]`;
}
// 字符串数组型配置：读 → 改 → 写回（一次 commit）
async function updateStringListConfig(path, key, newItems, label) {
  const data = await ghGetFile(path);
  const found = extractConfigValue(data.text, key);
  if (!found) throw new Error(`配置 ${path} 里找不到 ${key}`);
  const next = data.text.slice(0, found.start)
    + found.indent + key + ': ' + serializeStringList(newItems, found.indent)
    + data.text.slice(found.end);
  const res = await ghPutFile(path, next, data.sha, `更新 ${label || key} [管理台]`);
  return res;
}
// 按花括号配平切出数组里的每个 {...}（字符串感知，lrc 长文本也安全）
function splitBraceObjects(arrayRaw) {
  const objs = [];
  let depth = 0, inStr = false, escNext = false, q = '', start = -1;
  for (let i = 0; i < arrayRaw.length; i++) {
    const c = arrayRaw[i];
    if (inStr) {
      if (escNext) escNext = false;
      else if (c === '\\') escNext = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { objs.push(arrayRaw.slice(start, i + 1)); start = -1; } }
  }
  return objs;
}
function getStrField(obj, field) {
  const m = obj.match(new RegExp(`${field}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
}
function getNumField(obj, field) {
  const m = obj.match(new RegExp(`${field}\\s*:\\s*(\\d+)`));
  return m ? parseInt(m[1], 10) : 0;
}
const escConfigStr = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/* ================= 图片管理 ================= */
const BG_CONFIG = 'src/config/backgroundWallpaper.ts';
const STICKER_CONFIG = 'src/config/stickerConfig.ts';
const GALLERY_CONFIG = 'src/config/galleryConfig.ts';

routes.images = async () => {
  view.innerHTML = '<div class="card"><h2>🖼 加载中…</h2></div>';
  let bg, sticker, gallery;
  try {
    [bg, sticker, gallery] = await Promise.all([
      ghGetFile(BG_CONFIG), ghGetFile(STICKER_CONFIG), ghGetFile(GALLERY_CONFIG),
    ]);
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  let wpDesktop = parseConfigStrings(extractConfigValue(bg.text, 'desktop'));
  let wpMobile = parseConfigStrings(extractConfigValue(bg.text, 'mobile'));
  let wpDisabled = parseConfigStrings(extractConfigValue(bg.text, 'disabled'));
  let stickers = splitBraceObjects((extractConfigValue(sticker.text, 'stickers') || { raw: '[]' }).raw)
    .map((o) => ({ src: getStrField(o, 'src'), x: getNumField(o, 'x'), y: getNumField(o, 'y'), size: getNumField(o, 'size') }));
  const albums = [];
  {
    const re = /\{\s*id:\s*"((?:[^"\\]|\\.)*)"[\s\S]*?name:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(gallery.text))) albums.push({ id: m[1], name: m[2] });
  }

  async function saveWallpapers() {
    await updateStringListConfig(BG_CONFIG, 'desktop', wpDesktop, '桌面壁纸');
    await updateStringListConfig(BG_CONFIG, 'mobile', wpMobile, '手机壁纸');
    await updateStringListConfig(BG_CONFIG, 'disabled', wpDisabled, '禁用壁纸');
    toast('壁纸配置已保存（构建后生效）');
  }
  async function saveStickers(msg) {
    const data = await ghGetFile(STICKER_CONFIG);
    const found = extractConfigValue(data.text, 'stickers');
    if (!found) throw new Error('stickerConfig.ts 里找不到 stickers');
    const lines = stickers.map((s) => `${found.indent}\t{ src: "${escConfigStr(s.src)}", x: ${s.x}, y: ${s.y}, size: ${s.size} },`);
    const next = data.text.slice(0, found.start)
      + found.indent + 'stickers: [\n' + lines.join('\n') + '\n' + found.indent + ']'
      + data.text.slice(found.end);
    await ghPutFile(STICKER_CONFIG, next, data.sha, msg || '更新首页贴纸 [管理台]');
    toast('贴纸配置已保存（构建后生效）');
  }

  function wallpaperCell(url, list, idx, rerender) {
    const d = document.createElement('div');
    const isDisabled = wpDisabled.includes(url);
    d.className = 'img-cell' + (isDisabled ? ' is-disabled' : '');
    d.innerHTML = `<img loading="lazy" src="${esc(cfgImgPreview(url))}" alt="">
      <div class="url" title="${esc(url)}">${esc(url)}${isDisabled ? '（已禁用）' : ''}</div>
      <div class="ops">
        <button class="mini-btn" data-a="up">↑</button>
        <button class="mini-btn" data-a="down">↓</button>
        <button class="mini-btn${isDisabled ? '' : ' warn'}" data-a="toggle">${isDisabled ? '启用' : '禁用'}</button>
        <button class="mini-btn danger" data-a="del">删除</button>
      </div>`;
    d.querySelector('[data-a=up]').onclick = async () => {
      if (idx === 0) return;
      [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
      try { await saveWallpapers(); rerender(); } catch (e) { toast(e.message, true); }
    };
    d.querySelector('[data-a=down]').onclick = async () => {
      if (idx === list.length - 1) return;
      [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]];
      try { await saveWallpapers(); rerender(); } catch (e) { toast(e.message, true); }
    };
    d.querySelector('[data-a=toggle]').onclick = async () => {
      const i = wpDisabled.indexOf(url);
      if (i >= 0) wpDisabled.splice(i, 1);
      else wpDisabled.push(url);
      try { await saveWallpapers(); rerender(); } catch (e) { toast(e.message, true); }
    };
    d.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('确定移除这张壁纸？')) return;
      list.splice(idx, 1);
      const di = wpDisabled.indexOf(url);
      if (di >= 0) wpDisabled.splice(di, 1);
      try { await saveWallpapers(); rerender(); } catch (e) { toast(e.message, true); }
    };
    return d;
  }

  function renderWallpapers() {
    const gd = $('#wp-desktop'), gm = $('#wp-mobile');
    gd.innerHTML = ''; gm.innerHTML = '';
    wpDesktop.forEach((u, i) => gd.appendChild(wallpaperCell(u, wpDesktop, i, renderWallpapers)));
    wpMobile.forEach((u, i) => gm.appendChild(wallpaperCell(u, wpMobile, i, renderWallpapers)));
    if (!wpDesktop.length) gd.innerHTML = '<p class="hint">空的，加一张吧 👇</p>';
    if (!wpMobile.length) gm.innerHTML = '<p class="hint">空的，加一张吧 👇</p>';
  }

  async function addWallpaper(file, list) {
    toast('上传中…');
    try {
      const { urls } = await uploadImages([file], 'admin/wallpaper');
      list.push(urls[0]);
      await saveWallpapers();
      renderWallpapers();
    } catch (e) { toast(e.message, true); }
  }

  function stickerCell(s, idx) {
    const d = document.createElement('div');
    d.className = 'img-cell';
    d.innerHTML = `<img loading="lazy" src="${esc(cfgImgPreview(s.src))}" alt="">
      <div class="ops" style="gap:6px">
        <label class="hint">x <input class="num-inline" type="number" data-f="x" value="${s.x}"></label>
        <label class="hint">y <input class="num-inline" type="number" data-f="y" value="${s.y}"></label>
        <label class="hint">尺寸 <input class="num-inline" type="number" data-f="size" value="${s.size}"></label>
      </div>
      <div class="ops">
        <button class="mini-btn" data-a="img">换图</button>
        <button class="mini-btn" data-a="save">保存位置</button>
        <button class="mini-btn danger" data-a="del">删除</button>
        <input type="file" accept="image/*" class="hidden" data-f="file">
      </div>`;
    const fileInput = d.querySelector('[data-f=file]');
    d.querySelector('[data-a=img]').onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      toast('替换中…');
      try {
        await replaceRepoImage(s.src.startsWith('/') ? 'public' + s.src : 'src/' + s.src, f,
          { format: 'image/png', quality: 0.9, label: '贴纸' });
        stickerCellImgRefresh(d, s);
      } catch (err) { toast(err.message, true); }
      e.target.value = '';
    };
    d.querySelector('[data-a=save]').onclick = async () => {
      s.x = parseInt(d.querySelector('[data-f=x]').value, 10) || 0;
      s.y = parseInt(d.querySelector('[data-f=y]').value, 10) || 0;
      s.size = parseInt(d.querySelector('[data-f=size]').value, 10) || 72;
      try { await saveStickers('更新贴纸位置 [管理台]'); } catch (e) { toast(e.message, true); }
    };
    d.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('确定删除这个贴纸？（图片文件保留，只从配置移除）')) return;
      stickers.splice(idx, 1);
      try { await saveStickers('删除贴纸 [管理台]'); renderStickers(); } catch (e) { toast(e.message, true); }
    };
    return d;
  }
  function stickerCellImgRefresh(cell, s) {
    const img = cell.querySelector('img');
    img.src = cfgImgPreview(s.src) + (cfgImgPreview(s.src).includes('?') ? '&' : '?') + 't=' + Date.now();
  }
  function renderStickers() {
    const g = $('#sticker-grid');
    g.innerHTML = '';
    stickers.forEach((s, i) => g.appendChild(stickerCell(s, i)));
    if (!stickers.length) g.innerHTML = '<p class="hint">没有贴纸，加一个吧 👇</p>';
  }

  view.innerHTML = `
    <div class="toolbar"><span class="hint">🖼 图片管理：所有槽位一处替换。R2 槽位上传自动转 WebP；固定路径文件直接覆盖仓库原文件。每次保存 = 一次 commit，Pages 重新构建后生效。</span></div>

    <div class="card">
      <h2>🖼 博客背景图 <span class="sub">${BG_CONFIG}（R2 直链，构建时不二次处理）</span></h2>
      <p class="hint">桌面端用横版图、移动端用竖版图；多张则每次刷新随机一张。上传的图片先转 WebP 存 R2，再把地址写入配置。</p>
      <h3>桌面端壁纸（${wpDesktop.length} 张）</h3>
      <div class="img-grid" id="wp-desktop"></div>
      <div class="toolbar">
        <input type="file" id="wp-d-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="wp-d-add">＋ 添加桌面壁纸</button>
      </div>
      <h3>移动端壁纸（${wpMobile.length} 张）</h3>
      <div class="img-grid" id="wp-mobile"></div>
      <div class="toolbar">
        <input type="file" id="wp-m-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="wp-m-add">＋ 添加手机壁纸</button>
      </div>
    </div>

    <div class="card">
      <h2>👤 头像 <span class="sub">public/avatar.png · public/avatar.avif（对外固定地址，只替换文件内容）</span></h2>
      <div class="slot-row">
        <img class="slot-preview round" id="avatar-preview" src="${repoRawUrl('public/avatar.png')}" alt="当前头像">
        <div>
          <p class="hint">选一张图，自动生成 PNG（主用）与 AVIF（备用）两个版本覆盖原文件，地址不变，友链那边无缝切换。</p>
          <div class="toolbar">
            <input type="file" id="avatar-file" accept="image/*" class="hidden">
            <button class="btn btn-small" id="avatar-btn">📤 上传替换头像</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>🔖 Favicon <span class="sub">public/favicon/（只替换文件内容，路径不变）</span></h2>
      <div class="slot-row">
        <img class="slot-preview" id="fav-180" src="${repoRawUrl('public/favicon/favicon-cat-180.png')}" alt="180px">
        <img class="slot-preview" id="fav-32" src="${repoRawUrl('public/favicon/favicon-cat-32.png')}" alt="32px">
        <div>
          <p class="hint">一次上传，自动生成 180px（apple-touch）与 32px（浏览器标签）两个尺寸，覆盖原文件。深浅色共用同一套图。</p>
          <div class="toolbar">
            <input type="file" id="fav-file" accept="image/*" class="hidden">
            <button class="btn btn-small" id="fav-btn">📤 上传替换 Favicon</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>✨ 首页贴纸 <span class="sub">${STICKER_CONFIG}</span></h2>
      <p class="hint">首页可拖拽的小贴纸。换图直接覆盖原文件；改位置/尺寸后点"保存位置"；新增贴纸会上传到 src/assets/images/stickers/ 并追加配置。</p>
      <div class="img-grid" id="sticker-grid"></div>
      <div class="toolbar">
        <input type="file" id="sticker-file" accept="image/*" class="hidden">
        <input type="text" id="sticker-name" placeholder="新贴纸文件名（英文，如 cat2）" style="border:3px solid #000;border-radius:10px;padding:6px 10px">
        <button class="btn btn-small" id="sticker-add">＋ 新增贴纸</button>
      </div>
    </div>

    <div class="card">
      <h2>🧭 导航栏 Logo <span class="sub">src/assets/images/logo/（只替换文件内容）</span></h2>
      <div class="slot-row">
        <img class="slot-preview" src="${repoRawUrl('src/assets/images/logo/firefly-light.png')}" alt="浅色">
        <div>
          <p class="hint">浅色模式 Logo</p>
          <div class="toolbar"><input type="file" id="logo-l-file" accept="image/*" class="hidden"><button class="btn btn-small" id="logo-l-btn">📤 替换浅色 Logo</button></div>
        </div>
        <img class="slot-preview" src="${repoRawUrl('src/assets/images/logo/firefly-dark.png')}" alt="深色">
        <div>
          <p class="hint">深色模式 Logo</p>
          <div class="toolbar"><input type="file" id="logo-d-file" accept="image/*" class="hidden"><button class="btn btn-small" id="logo-d-btn">📤 替换深色 Logo</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📱 Devices 页配图 <span class="sub">src/assets/images/devices/（只替换文件内容）</span></h2>
      <p class="hint">/devices/ 页六张设备图的背景，上传自动转 JPEG 覆盖原文件。</p>
      <div class="img-grid" id="devices-grid"></div>
    </div>

    <div class="card">
      <h2>🖼 相册封面 <span class="sub">public/gallery/&lt;id&gt;/cover.webp</span></h2>
      <p class="hint">每个相册一张封面（cover.webp），上传自动转 WebP。相册正文图片仍建议用构建脚本或直接推仓库。</p>
      <div id="album-list"></div>
    </div>

    <div class="card">
      <h2>🖥 控制台背景 <span class="sub">public/admin/login-art.jpg（登录页全屏背景）</span></h2>
      <p class="hint">登录页的背景图。预设一键切换，或自己上传一张（自动转 JPEG 覆盖 login-art.jpg）。config.js 的 adminBg 决定当前用哪张。</p>
      <div class="img-grid" id="adminbg-grid"></div>
      <div class="toolbar">
        <input type="file" id="adminbg-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="adminbg-btn">📤 上传替换当前背景</button>
      </div>
    </div>

    <div class="card">
      <h2>🖥 控制台内部背景 <span class="sub">登录后内页背景 · 默认多张轮换</span></h2>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" id="innerbg-rotate" checked><span class="slider"></span></label>
        <span>背景轮换 <span class="hint">多张背景每 30 秒淡入淡出切换；关闭则用纯色主题背景</span></span>
      </div>
      <p class="hint">轮换池：下面这些图会自动轮换播放。上传新图会加入轮换（自动转 JPEG 存为 admin-inner-bg.jpg）。</p>
      <div class="img-grid" id="innerbg-grid"></div>
      <div class="toolbar">
        <input type="file" id="innerbg-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="innerbg-btn">📤 上传图片加入轮换</button>
      </div>
    </div>`;

  renderWallpapers();
  renderStickers();

  // ---- 控制台背景 ----
  const ADMINBG_PRESETS = [
    { file: 'login-art.jpg', name: '波奇酱（默认）' },
    { file: 'login-art-alt.jpg', name: '星空海滨站（备选）' },
    { file: 'login-art-sketch.png', name: '波奇草稿（旧版）' },
  ];
  async function setAdminBg(file) {
    const data = await ghGetFile('public/admin/config.js');
    if (!/adminBg\s*:\s*'[^']*'/.test(data.text)) throw new Error('config.js 里找不到 adminBg 字段');
    const next = data.text.replace(/adminBg\s*:\s*'[^']*'/, `adminBg: '${file}'`);
    await ghPutFile('public/admin/config.js', next, data.sha, `切换控制台背景为 ${file} [管理台]`);
    CFG.adminBg = file;
    renderAdminBg();
    toast('控制台背景已切换（重新进登录页生效）');
  }
  function renderAdminBg() {
    const g = $('#adminbg-grid');
    g.innerHTML = '';
    const cur = CFG.adminBg || 'login-art.jpg';
    ADMINBG_PRESETS.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'img-cell';
      d.innerHTML = `<img loading="lazy" src="${repoRawUrl('public/admin/' + p.file)}" alt="${esc(p.name)}">
        <div class="url" title="${esc(p.name)}">${esc(p.name)}${p.file === cur ? ' ✅ 使用中' : ''}</div>
        <div class="ops"><button class="mini-btn" data-a="use"${p.file === cur ? ' disabled' : ''}>设为背景</button></div>`;
      d.querySelector('[data-a=use]').onclick = async () => {
        try { await setAdminBg(p.file); } catch (e) { toast(e.message, true); }
      };
      g.appendChild(d);
    });
  }
  renderAdminBg();
  $('#adminbg-btn').onclick = () => $('#adminbg-file').click();
  $('#adminbg-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('背景替换中…');
    try {
      await replaceRepoImage('public/admin/login-art.jpg', f, { format: 'image/jpeg', quality: 0.85, label: '控制台背景' });
      toast('背景已替换（重新进登录页生效）');
      renderAdminBg();
    } catch (err) { toast(err.message, true); }
  };

  // ---- 控制台内部背景：默认轮换 + 一个禁用开关 ----
  const INNERBG_PRESETS = [
    { file: 'login-art.jpg', name: '波奇酱' },
    { file: 'login-art-alt.jpg', name: '星空海滨站' },
    { file: 'login-art-sketch.png', name: '波奇草稿' },
  ];
  function renderInnerBg() {
    const g = $('#innerbg-grid');
    if (!g) return;
    g.innerHTML = '';
    let hasCustom = false, customName = '自定义上传';
    try {
      /* 以仓库文件实际存在为准（跨设备）；本机改名只影响显示名 */
      hasCustom = (typeof BG_CUSTOM_EXISTS !== 'undefined') && BG_CUSTOM_EXISTS;
      customName = localStorage.getItem('admin-inner-bg-custom-name') || '自定义上传';
    } catch (e) {}
    const list = INNERBG_PRESETS.concat(hasCustom ? [{ file: 'admin-inner-bg.jpg', name: customName, custom: true }] : []);
    list.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'img-cell';
      d.innerHTML = `<img loading="lazy" src="${repoRawUrl('public/admin/' + p.file)}" alt="${esc(p.name)}">
        <div class="url" title="${esc(p.name)}">${esc(p.name)}</div>
        ${p.custom ? '<div class="ops"><button class="mini-btn" data-a="rename">✏️ 改名</button></div>' : ''}`;
      if (p.custom) {
        d.querySelector('[data-a=rename]').onclick = () => {
          const v = prompt('给这张自定义背景起个名字：', customName);
          if (v === null) return;
          const name = v.trim() || '自定义上传';
          try { localStorage.setItem('admin-inner-bg-custom-name', name); } catch (e) {}
          renderInnerBg();
          toast('已改名为「' + name + '」');
        };
      }
      g.appendChild(d);
    });
    const sw = $('#innerbg-rotate');
    if (sw && !sw._wired) {
      sw._wired = true;
      let on = true;
      try { on = localStorage.getItem('admin-inner-bg-rotate') !== '0'; } catch (e) {}
      sw.checked = on;
      sw.onchange = () => {
        try { localStorage.setItem('admin-inner-bg-rotate', sw.checked ? '1' : '0'); } catch (e) {}
        applyInnerBg(true);
        toast(sw.checked ? '背景轮换已开启' : '背景已关闭，改用纯色主题背景');
      };
    }
  }
  renderInnerBg();
  $('#innerbg-btn').onclick = () => $('#innerbg-file').click();
  $('#innerbg-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('上传中…');
    try {
      await replaceRepoImage('public/admin/admin-inner-bg.jpg', f, { format: 'image/jpeg', quality: 0.85, maxDim: 1920, label: '内部背景' });
      try { if (typeof BG_CUSTOM_EXISTS !== 'undefined') BG_CUSTOM_EXISTS = true; } catch (e2) {}
      applyInnerBg(true);
      renderInnerBg();
      toast('已加入轮换');
    } catch (err) { toast(err.message, true); }
  };

  // ---- 背景图：添加 ----
  $('#wp-d-add').onclick = () => $('#wp-d-file').click();
  $('#wp-m-add').onclick = () => $('#wp-m-file').click();
  $('#wp-d-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addWallpaper(f, wpDesktop); };
  $('#wp-m-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addWallpaper(f, wpMobile); };

  // ---- 头像 ----
  $('#avatar-btn').onclick = () => $('#avatar-file').click();
  $('#avatar-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('头像生成中…');
    try {
      await replaceRepoImage('public/avatar.png', f, { format: 'image/png', quality: 0.92, maxDim: 1024, label: '头像 PNG' });
      // AVIF：浏览器支持编码才写，不支持就跳过并提示（avatar.png 已更新可用）
      try {
        const avif = await convertImage(f, { format: 'image/avif', quality: 0.8, maxDim: 1024 });
        if (avif.type && avif.type.includes('avif')) {
          const b64 = await blobToBase64(avif);
          await ghPutBinary('public/avatar.avif', b64, await getSha('public/avatar.avif'), '替换图片 public/avatar.avif [管理台]');
          toast('头像已更新（PNG + AVIF）');
        } else {
          toast('头像 PNG 已更新；当前浏览器不支持 AVIF 编码，avatar.avif 未动', false);
        }
      } catch (err2) {
        toast('头像 PNG 已更新；AVIF 编码失败，avatar.avif 未动', false);
      }
      $('#avatar-preview').src = repoRawUrl('public/avatar.png') + '?t=' + Date.now();
    } catch (err) { toast(err.message, true); }
  };

  // ---- Favicon ----
  $('#fav-btn').onclick = () => $('#fav-file').click();
  $('#fav-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('Favicon 生成中…');
    try {
      await replaceRepoImage('public/favicon/favicon-cat-180.png', f, { format: 'image/png', maxDim: 180, label: 'Favicon 180px' });
      await replaceRepoImage('public/favicon/favicon-cat-32.png', f, { format: 'image/png', maxDim: 32, label: 'Favicon 32px' });
      $('#fav-180').src = repoRawUrl('public/favicon/favicon-cat-180.png') + '?t=' + Date.now();
      $('#fav-32').src = repoRawUrl('public/favicon/favicon-cat-32.png') + '?t=' + Date.now();
    } catch (err) { toast(err.message, true); }
  };

  // ---- 贴纸：新增 ----
  $('#sticker-add').onclick = () => $('#sticker-file').click();
  $('#sticker-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const name = $('#sticker-name').value.trim().replace(/[^a-zA-Z0-9_-]/g, '') || ('sticker-' + Date.now().toString(36));
    const repoPath = `src/assets/images/stickers/${name}.png`;
    toast('贴纸上传中…');
    try {
      const blob = await convertImage(f, { format: 'image/png', quality: 0.9 });
      await ghPutBinary(repoPath, await blobToBase64(blob), null, `新增贴纸 ${repoPath} [管理台]`);
      stickers.push({ src: `assets/images/stickers/${name}.png`, x: 50, y: 50, size: 72 });
      await saveStickers('新增贴纸 [管理台]');
      $('#sticker-name').value = '';
      renderStickers();
    } catch (err) { toast(err.message, true); }
  };

  // ---- Logo ----
  const logoBind = (btnId, fileId, repoPath, label) => {
    $(btnId).onclick = () => $(fileId).click();
    $(fileId).onchange = async (ev) => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      toast('替换中…');
      try {
        await replaceRepoImage(repoPath, f, { format: 'image/png', quality: 0.92, label });
        router();
      } catch (err) { toast(err.message, true); }
    };
  };
  logoBind('#logo-l-btn', '#logo-l-file', 'src/assets/images/logo/firefly-light.png', '浅色 Logo');
  logoBind('#logo-d-btn', '#logo-d-file', 'src/assets/images/logo/firefly-dark.png', '深色 Logo');

  // ---- Devices ----
  const devices = [
    ['phone', '手机'], ['laptop', '笔记本'], ['tablet', '平板'],
    ['watch', '手表'], ['earbuds1', '耳机 1'], ['earbuds2', '耳机 2'],
  ];
  const dg = $('#devices-grid');
  for (const [key, label] of devices) {
    const repoPath = `src/assets/images/devices/${key}.jpg`;
    const cell = document.createElement('div');
    cell.className = 'img-cell';
    cell.innerHTML = `<img loading="lazy" src="${repoRawUrl(repoPath)}" alt="${esc(label)}">
      <div class="url">${esc(label)}</div>
      <div class="ops"><button class="mini-btn">📤 替换</button><input type="file" accept="image/*" class="hidden"></div>`;
    const fi = cell.querySelector('input');
    cell.querySelector('button').onclick = () => fi.click();
    fi.onchange = async (ev) => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      toast('替换中…');
      try {
        await replaceRepoImage(repoPath, f, { format: 'image/jpeg', quality: 0.9, maxDim: 1600, label });
        cell.querySelector('img').src = repoRawUrl(repoPath) + '?t=' + Date.now();
      } catch (err) { toast(err.message, true); }
    };
    dg.appendChild(cell);
  }

  // ---- 相册封面 ----
  const al = $('#album-list');
  if (!albums.length) al.innerHTML = '<p class="hint">没读到相册配置</p>';
  for (const a of albums) {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `<img class="song-cover" loading="lazy" src="${repoRawUrl(`public/gallery/${a.id}/cover.webp`)}" alt="" onerror="this.style.visibility='hidden'">
      <span class="title">${esc(a.name)} <span class="meta">${esc(a.id)}</span></span>
      <button class="btn btn-small">📤 上传封面</button>
      <input type="file" accept="image/*" class="hidden">`;
    const fi = row.querySelector('input');
    row.querySelector('button').onclick = () => fi.click();
    fi.onchange = async (ev) => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      toast('封面上传中…');
      try {
        await replaceRepoImage(`public/gallery/${a.id}/cover.webp`, f,
          { format: 'image/webp', quality: 0.85, maxDim: 1200, label: `「${a.name}」封面` });
        const img = row.querySelector('img');
        img.style.visibility = 'visible';
        img.src = repoRawUrl(`public/gallery/${a.id}/cover.webp`) + '?t=' + Date.now();
      } catch (err) { toast(err.message, true); }
    };
    al.appendChild(row);
  }
};

/* ================= 音乐管理 ================= */
const MUSIC_CONFIG = 'src/config/musicConfig.ts';

routes.music = async () => {
  view.innerHTML = '<div class="card"><h2>🎵 加载中…</h2></div>';
  let cfg;
  try { cfg = await ghGetFile(MUSIC_CONFIG); }
  catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  let plBlock = extractConfigValue(cfg.text, 'playlist');
  if (!plBlock) { view.innerHTML = '<div class="card">musicConfig.ts 里找不到 playlist</div>'; return; }
  let songs = splitBraceObjects(plBlock.raw).map((o) => ({
    name: getStrField(o, 'name'), artist: getStrField(o, 'artist'),
    url: getStrField(o, 'url'), cover: getStrField(o, 'cover'), lrc: getStrField(o, 'lrc'),
  }));

  async function saveSongs(msg) {
    const items = songs.map((s) =>
      `${plBlock.indent}\t{\n` +
      `${plBlock.indent}\t\tname: "${escConfigStr(s.name)}",\n` +
      `${plBlock.indent}\t\tartist: "${escConfigStr(s.artist)}",\n` +
      `${plBlock.indent}\t\turl: "${escConfigStr(s.url)}",\n` +
      `${plBlock.indent}\t\tcover: "${escConfigStr(s.cover)}",\n` +
      `${plBlock.indent}\t\tlrc: "${escConfigStr(s.lrc)}",\n` +
      `${plBlock.indent}\t},`);
    const next = cfg.text.slice(0, plBlock.start)
      + plBlock.indent + 'playlist: [\n' + items.join('\n') + '\n' + plBlock.indent + ']'
      + cfg.text.slice(plBlock.end);
    await ghPutFile(MUSIC_CONFIG, next, cfg.sha, msg || '更新播放器歌单 [管理台]');
    // 重新读取，sha 与文本位置都刷新
    cfg = await ghGetFile(MUSIC_CONFIG);
    plBlock = extractConfigValue(cfg.text, 'playlist');
    toast('歌单已保存（Pages 重新构建后生效）');
  }

  function renderSongs() {
    const list = $('#song-list');
    list.innerHTML = '';
    $('#song-count').textContent = songs.length;
    songs.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'list-item song';
      row.innerHTML = `
        <img class="song-cover" loading="lazy" src="${esc(cfgImgPreview(s.cover))}" alt="" onerror="this.style.visibility='hidden'">
        <div class="song-info">
          <div class="title">${esc(s.name) || '<span class="hint">未命名</span>'}</div>
          <div class="meta">${esc(s.artist)}</div>
        </div>
        <audio controls preload="none" src="${esc(s.url)}"></audio>
        <button class="mini-btn" data-a="up">↑</button>
        <button class="mini-btn" data-a="down">↓</button>
        <button class="mini-btn danger" data-a="del">删除</button>`;
      row.querySelector('[data-a=up]').onclick = async () => {
        if (i === 0) return;
        [songs[i - 1], songs[i]] = [songs[i], songs[i - 1]];
        try { await saveSongs('调整歌单顺序 [管理台]'); renderSongs(); } catch (e) { toast(e.message, true); }
      };
      row.querySelector('[data-a=down]').onclick = async () => {
        if (i === songs.length - 1) return;
        [songs[i + 1], songs[i]] = [songs[i], songs[i + 1]];
        try { await saveSongs('调整歌单顺序 [管理台]'); renderSongs(); } catch (e) { toast(e.message, true); }
      };
      row.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm(`确定删除《${s.name}》？`)) return;
        songs.splice(i, 1);
        try { await saveSongs('从歌单删除歌曲 [管理台]'); renderSongs(); } catch (e) { toast(e.message, true); }
      };
      list.appendChild(row);
    });
    if (!songs.length) list.innerHTML = '<div class="card">歌单空空如也，加一首吧 👇</div>';
  }

  view.innerHTML = `
    <div class="card">
      <h2>🎵 播放器歌单 <span class="sub">${MUSIC_CONFIG} · 共 <span id="song-count">${songs.length}</span> 首</span></h2>
      <p class="hint">播放器构建时读取该配置：增删改、调顺序后点保存即 commit，Pages 自动重新构建，构建完成访问即生效。音频直链 / R2 链接均可（ plain &lt;audio&gt; 播放，无跨域问题）。</p>
      <div id="song-list"></div>
    </div>
    <div class="card">
      <h2>＋ 添加歌曲</h2>
      <div class="row2">
        <div class="field"><label>歌名 *</label><input type="text" id="ms-name" placeholder="如 Crashing"></div>
        <div class="field"><label>歌手</label><input type="text" id="ms-artist" placeholder="如 Ed Sheeran"></div>
      </div>
      <div class="field"><label>音频 URL（直链，与上传二选一）</label><input type="text" id="ms-url" placeholder="https://…/xxx.mp3"></div>
      <div class="toolbar">
        <input type="file" id="ms-mp3" accept="audio/*,.mp3" class="hidden">
        <button class="btn btn-small btn-ghost" id="ms-mp3-btn">📤 上传 mp3 → R2</button>
        <span class="hint" id="ms-mp3-name">未选择文件</span>
      </div>
      <div class="field"><label>封面</label></div>
      <div class="toolbar">
        <input type="file" id="ms-cover" accept="image/*" class="hidden">
        <button class="btn btn-small btn-ghost" id="ms-cover-btn">🖼 上传封面 → R2（自动转 WebP）</button>
        <img id="ms-cover-preview" class="song-cover hidden" alt="">
        <span class="hint" id="ms-cover-name">未选择</span>
      </div>
      <div class="field"><label>歌词（可选，纯文本）</label><textarea id="ms-lrc" rows="3" placeholder="[00:12.34] 歌词…"></textarea></div>
      <button class="btn" id="ms-add">＋ 添加到歌单并保存</button>
    </div>`;

  renderSongs();

  let mp3File = null, coverUrl = '';
  $('#ms-mp3-btn').onclick = () => $('#ms-mp3').click();
  $('#ms-mp3').onchange = (e) => {
    mp3File = e.target.files[0] || null;
    $('#ms-mp3-name').textContent = mp3File ? `已选：${mp3File.name}（保存时上传）` : '未选择文件';
    if (mp3File) $('#ms-url').value = '';
  };
  $('#ms-cover-btn').onclick = () => $('#ms-cover').click();
  $('#ms-cover').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('封面上传中…');
    try {
      const { urls } = await uploadImages([f], 'admin/music-cover');
      coverUrl = urls[0];
      const p = $('#ms-cover-preview');
      p.src = coverUrl; p.classList.remove('hidden');
      $('#ms-cover-name').textContent = '已上传';
      toast('封面已上传');
    } catch (err) { toast(err.message, true); }
  };

  $('#ms-add').onclick = async () => {
    const name = $('#ms-name').value.trim();
    let url = $('#ms-url').value.trim();
    const artist = $('#ms-artist').value.trim();
    const lrc = $('#ms-lrc').value;
    if (!name) { toast('请填写歌名', true); return; }
    $('#ms-add').disabled = true;
    try {
      if (mp3File) {
        toast('mp3 上传中…');
        const { urls } = await uploadRawFiles([mp3File], 'admin/music');
        url = urls[0];
      }
      if (!url) { toast('请填写音频 URL 或上传 mp3', true); $('#ms-add').disabled = false; return; }
      songs.push({ name, artist, url, cover: coverUrl, lrc });
      await saveSongs(`歌单新增《${name}》 [管理台]`);
      renderSongs();
      $('#ms-name').value = ''; $('#ms-artist').value = ''; $('#ms-url').value = ''; $('#ms-lrc').value = '';
      coverUrl = ''; mp3File = null;
      $('#ms-cover-preview').classList.add('hidden');
      $('#ms-cover-name').textContent = '未选择'; $('#ms-mp3-name').textContent = '未选择文件';
    } catch (e) { toast(e.message, true); }
    $('#ms-add').disabled = false;
  };
};
