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
  await saveWithLog(repoPath, b64, sha, `替换图片 ${repoPath} [管理台]`, { type: '图片', action: '替换', target: repoPath }, { isBase64: true });
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
/* 队列感知读底：同文件已入队时以队列快照为底叠加（baseSha 沿用队列条目记录的原始远端 sha，
 * 执行时据此判断排队期间远端有没有被改过）；未入队则以远端当前文本为底。 */
async function cfgBaseForQueue(path) {
  const data = await ghGetFile(path);
  if (typeof opQueueFind === 'function') {
    const q = opQueueFind(path);
    if (q) return { text: q.payload, sha: data.sha, baseSha: q.baseSha || null };
  }
  return { text: data.text, sha: data.sha, baseSha: data.sha };
}
// 字符串数组型配置（立即提交原路径）：读 → 改 → 写回（一次 commit）
async function updateStringListConfigDirect(path, key, newItems, label) {
  const data = await ghGetFile(path);
  const found = extractConfigValue(data.text, key);
  if (!found) throw new Error(`配置 ${path} 里找不到 ${key}`);
  const next = data.text.slice(0, found.start)
    + found.indent + key + ': ' + serializeStringList(newItems, found.indent)
    + data.text.slice(found.end);
  const res = await saveWithLog(path, next, data.sha, `更新 ${label || key} [管理台]`, { type: '配置', action: '更新', target: label || key });
  return res;
}
// 字符串数组型配置：默认走暂存队列——生成整表新文本后按目标文件入队，不直接提交
async function updateStringListConfig(path, key, newItems, label) {
  if (typeof opQueueEnqueue !== 'function') return updateStringListConfigDirect(path, key, newItems, label);
  const base = await cfgBaseForQueue(path);
  const found = extractConfigValue(base.text, key);
  if (!found) throw new Error(`配置 ${path} 里找不到 ${key}`);
  const next = base.text.slice(0, found.start)
    + found.indent + key + ': ' + serializeStringList(newItems, found.indent)
    + base.text.slice(found.end);
  opQueueEnqueue({ targetFile: path, label: label || key, payload: next, baseSha: base.baseSha, op: { type: '配置', action: '更新', target: label || key } });
  return { queued: true };
}
/* 从 openIdx 的 { 开始按括号配平切出整块文本（字符串/注释感知） */
function scanBraceText(text, openIdx) {
  let depth = 0, inStr = false, escNext = false, q = '', inLine = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inStr) {
      if (escNext) escNext = false;
      else if (c === '\\') escNext = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { inLine = true; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return text.slice(openIdx, i + 1); }
  }
  return text.slice(openIdx);
}
/* 分模式壁纸（modeSrc / modeCarousel）解析：某模式某端有专属图就用专属图，空则回退共享 */
const WP_MODES = ['banner', 'fullscreen', 'overlay'];
function parseModeWallpapers(text) {
  const out = {
    src: { banner: { desktop: [], mobile: [] }, fullscreen: { desktop: [], mobile: [] }, overlay: { desktop: [], mobile: [] } },
    carousel: { banner: true, fullscreen: true, overlay: true },
  };
  const gm = text.match(/carousel\s*:\s*\{\s*enable\s*:\s*(true|false)/);
  const gDef = gm ? gm[1] === 'true' : true;
  WP_MODES.forEach((mode) => { out.carousel[mode] = gDef; });
  const bi = text.indexOf('modeSrc:');
  if (bi >= 0) {
    const block = scanBraceText(text, text.indexOf('{', bi));
    WP_MODES.forEach((mode) => {
      const mi = block.indexOf(mode + ':');
      if (mi < 0) return;
      const mb = scanBraceText(block, block.indexOf('{', mi));
      out.src[mode].desktop = parseConfigStrings(extractConfigValue(mb, 'desktop'));
      out.src[mode].mobile = parseConfigStrings(extractConfigValue(mb, 'mobile'));
    });
  }
  const ci = text.indexOf('modeCarousel:');
  if (ci >= 0) {
    const block = scanBraceText(text, text.indexOf('{', ci));
    WP_MODES.forEach((mode) => {
      const m = block.match(new RegExp(mode + '\\s*:\\s*(true|false)'));
      if (m) out.carousel[mode] = m[1] === 'true';
    });
  }
  return out;
}
function buildModeSrcBlock(srcMap) {
  const lines = ['\tmodeSrc: {'];
  WP_MODES.forEach((mode) => {
    lines.push(`\t\t${mode}: {`);
    lines.push(`\t\t\tdesktop: ${serializeStringList(srcMap[mode].desktop, '\t\t\t')},`);
    lines.push(`\t\t\tmobile: ${serializeStringList(srcMap[mode].mobile, '\t\t\t')},`);
    lines.push('\t\t},');
  });
  lines.push('\t},');
  return lines.join('\n');
}
function buildModeCarouselBlock(carMap) {
  const lines = ['\tmodeCarousel: {'];
  WP_MODES.forEach((mode) => lines.push(`\t\t${mode}: ${carMap[mode] ? 'true' : 'false'},`));
  lines.push('\t},');
  return lines.join('\n');
}
/* 替换（或首次插入）配置里的某个对象块，块由控制台维护、整体重写 */
function replaceConfigBlock(text, key, blockText) {
  const re = new RegExp(`^\\t${key}\\s*:`, 'm');
  const m = text.match(re);
  if (m) {
    const open = text.indexOf('{', m.index);
    const span = scanBraceText(text, open);
    let end = m.index + 0; // 计算绝对结束位置
    const absOpen = open;
    const absEnd = absOpen + span.length;
    end = absEnd;
    if (text[end] === ',') end++;
    return text.slice(0, m.index) + blockText + text.slice(end);
  }
  const anchor = text.indexOf('\n\tdisabled:');
  if (anchor >= 0) return text.slice(0, anchor + 1) + blockText + '\n' + text.slice(anchor + 1);
  return text + '\n' + blockText + '\n';
}
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

routes.images = async (arg) => {
  view.innerHTML = '<div class="card"><h2>🖼 加载中…</h2></div>';
  let bg, sticker, gallery;
  try {
    [bg, sticker, gallery] = await Promise.all([
      ghGetFile(BG_CONFIG), ghGetFile(STICKER_CONFIG), ghGetFile(GALLERY_CONFIG),
    ]);
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  /* 初始列表用「远端 + 已入队快照」的合并视图：本机队列里有未执行的快照时以快照为准，
   * 这样刷新后接着改、includes 去重判断都不会漏掉排队中的图 */
  const bgText0 = (typeof opQueuePayload === 'function' && opQueuePayload(BG_CONFIG)) || bg.text;
  const stickerText0 = (typeof opQueuePayload === 'function' && opQueuePayload(STICKER_CONFIG)) || sticker.text;
  let wpDesktop = parseConfigStrings(extractConfigValue(bgText0, 'desktop'));
  let wpMobile = parseConfigStrings(extractConfigValue(bgText0, 'mobile'));
  let wpDisabled = parseConfigStrings(extractConfigValue(bgText0, 'disabled'));
  const wpParsed = parseModeWallpapers(bgText0);
  let wpModeSrc = wpParsed.src;
  let wpModeCarousel = wpParsed.carousel;
  let stickers = splitBraceObjects((extractConfigValue(stickerText0, 'stickers') || { raw: '[]' }).raw)
    .map((o) => ({ src: getStrField(o, 'src'), x: getNumField(o, 'x'), y: getNumField(o, 'y'), size: getNumField(o, 'size') }));
  const albums = [];
  {
    const re = /\{\s*id:\s*"((?:[^"\\]|\\.)*)"[\s\S]*?name:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(gallery.text))) albums.push({ id: m[1], name: m[2] });
  }

  /* 保存分工（2026-10-29 暂存队列）：默认 save* = 只入队不提交，顶栏执行才落仓库；
   * save*Now = 立即提交出口，走改前的原路径原语义，急用时绕过队列 */
  async function saveWallpapers() {
    await updateStringListConfig(BG_CONFIG, 'desktop', wpDesktop, '桌面壁纸');
    await updateStringListConfig(BG_CONFIG, 'mobile', wpMobile, '手机壁纸');
    await updateStringListConfig(BG_CONFIG, 'disabled', wpDisabled, '禁用壁纸');
    toast('壁纸配置已加入待执行队列（顶栏「📥 待执行」执行后生效）');
  }
  async function saveWallpapersNow() {
    await updateStringListConfigDirect(BG_CONFIG, 'desktop', wpDesktop, '桌面壁纸');
    await updateStringListConfigDirect(BG_CONFIG, 'mobile', wpMobile, '手机壁纸');
    await updateStringListConfigDirect(BG_CONFIG, 'disabled', wpDisabled, '禁用壁纸');
    toast('壁纸配置已保存（构建后生效）');
  }
  function dedupeModeSrc() {
    // 保存前按 URL 去重（保留首次出现）：历史数据里混进过的重复图在这里清掉，
    // 否则同一张图占两个位置，「固定第一张」和随机抽图都会被它干扰
    WP_MODES.forEach((mode) => {
      ['desktop', 'mobile'].forEach((dev) => {
        wpModeSrc[mode][dev] = [...new Set(wpModeSrc[mode][dev])];
      });
    });
  }
  function buildModeWallpaperText(baseText) {
    let text = replaceConfigBlock(baseText, 'modeSrc', buildModeSrcBlock(wpModeSrc));
    text = replaceConfigBlock(text, 'modeCarousel', buildModeCarouselBlock(wpModeCarousel));
    return text;
  }
  async function saveModeWallpapers() {
    dedupeModeSrc();
    if (typeof opQueueEnqueue !== 'function') return saveModeWallpapersNow();
    const base = await cfgBaseForQueue(BG_CONFIG);
    const text = buildModeWallpaperText(base.text);
    opQueueEnqueue({ targetFile: BG_CONFIG, label: '分模式壁纸', payload: text, baseSha: base.baseSha, op: { type: '配置', action: '更新', target: '分模式壁纸' } });
    toast('分模式壁纸已加入待执行队列（顶栏「📥 待执行」执行后生效）');
  }
  async function saveModeWallpapersNow() {
    dedupeModeSrc();
    const data = await ghGetFile(BG_CONFIG);
    const text = buildModeWallpaperText(data.text);
    await saveWithLog(BG_CONFIG, text, data.sha, '更新分模式壁纸 [管理台]', { type: '配置', action: '更新', target: '分模式壁纸' });
    toast('分模式壁纸已保存（构建后生效）');
  }
  function buildStickerText(baseText) {
    const found = extractConfigValue(baseText, 'stickers');
    if (!found) throw new Error('stickerConfig.ts 里找不到 stickers');
    const lines = stickers.map((s) => `${found.indent}\t{ src: "${escConfigStr(s.src)}", x: ${s.x}, y: ${s.y}, size: ${s.size} },`);
    return baseText.slice(0, found.start)
      + found.indent + 'stickers: [\n' + lines.join('\n') + '\n' + found.indent + ']'
      + baseText.slice(found.end);
  }
  async function saveStickers(msg) {
    if (typeof opQueueEnqueue !== 'function') return saveStickersNow(msg);
    const base = await cfgBaseForQueue(STICKER_CONFIG);
    const next = buildStickerText(base.text);
    const label = (msg || '更新首页贴纸 [管理台]').replace(/ \[管理台\]$/, '');
    opQueueEnqueue({ targetFile: STICKER_CONFIG, label, payload: next, baseSha: base.baseSha, op: { type: '贴纸', action: '更新', target: '首页贴纸' } });
    toast('贴纸配置已加入待执行队列（顶栏「📥 待执行」执行后生效）');
  }
  async function saveStickersNow(msg) {
    const data = await ghGetFile(STICKER_CONFIG);
    const next = buildStickerText(data.text);
    await saveWithLog(STICKER_CONFIG, next, data.sha, msg || '更新首页贴纸 [管理台]', { type: '贴纸', action: '更新', target: '首页贴纸' });
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
      const { urls } = await uploadImages([file], 'admin/wallpaper', 0.72);
      // 与其余加图入口对齐：同一 URL 已在列表里就不再重复添加（此入口此前独缺这道检查）
      if (list.includes(urls[0])) { toast('这张已经在了', true); return; }
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
      if (!confirm('用这张替换贴纸的图片？原图会被覆盖。')) return;
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
    <div class="toolbar"><span class="hint">🖼 图片管理：所有槽位一处替换。R2 槽位上传自动转 WebP；固定路径文件直接覆盖仓库原文件。壁纸/贴纸改动先存进本机「📥 待执行队列」，顶栏执行才合并成一次 commit；急用可点各卡片里的「⚡ 立即提交」。<span id="img-queue-hint"></span></span></div>

    <div class="card">
      <h2>🖼 博客背景图 <span class="sub">${BG_CONFIG}（R2 直链，构建时不二次处理）</span></h2>
      <p class="hint">桌面端用横版图、移动端用竖版图；多张则每次刷新随机一张。上传的图片先转 WebP 存 R2，再把地址写入配置（先进待执行队列）。</p>
      <div class="toolbar"><button class="btn btn-small" id="wp-now">⚡ 立即提交共享壁纸（不走队列）</button></div>
      <h3>桌面端壁纸（${wpDesktop.length} 张）</h3>
      <div class="img-grid" id="wp-desktop"></div>
      <div class="toolbar">
        <input type="file" id="wp-d-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="wp-d-add">＋ 添加桌面壁纸</button>
        <button class="btn btn-small" id="wp-d-ml">🗂 从媒体库选</button>
      </div>
      <h3>移动端壁纸（${wpMobile.length} 张）</h3>
      <div class="img-grid" id="wp-mobile"></div>
      <div class="toolbar">
        <input type="file" id="wp-m-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="wp-m-add">＋ 添加手机壁纸</button>
        <button class="btn btn-small" id="wp-m-ml">🗂 从媒体库选</button>
      </div>
    </div>

    <div class="card">
      <h2>🎠 分模式壁纸 <span class="sub">给每个壁纸模式配专属图和轮播开关（在「🎨 主题」页切换默认模式）</span></h2>
      <p class="hint">规则：某模式某端<b>有专属图就只用专属图</b>，空着就回退用上面的共享图库。开启轮播就轮播；关掉轮播时，列表<b>第一张</b>就是固定显示的那张——点任意一张的「固定这张」会把它置顶（还开着轮播的话会顺手把该模式轮播关掉）。每次改动先进待执行队列，顶栏执行后生效；急用点下方「⚡ 立即提交」。</p>
      <div class="toolbar"><button class="btn btn-small" id="wp-mode-now">⚡ 立即提交分模式壁纸（不走队列）</button></div>
      ${[['banner', '横幅模式'], ['fullscreen', '全屏模式'], ['overlay', '透明覆盖']].map(([mode, label]) => `
      <div class="wp-mode-sec" id="wp-sec-${mode}">
        <h3>${label}专属图
          <label class="pill wp-carousel-pill" title="这个模式下是否自动轮播"><input type="checkbox" class="wp-carousel" data-mode="${mode}">🎠 轮播</label>
        </h3>
        <h4 class="sub-h">桌面端（<span id="wp-cnt-${mode}-desktop">0</span> 张）</h4>
        <div class="img-grid" id="wp-m-${mode}-desktop"></div>
        <div class="toolbar">
          <input type="text" class="wp-url-in" data-mode="${mode}" data-dev="desktop" placeholder="粘贴图片 URL">
          <button class="btn btn-small wp-url-add" data-mode="${mode}" data-dev="desktop">＋ URL 添加</button>
          <input type="file" accept="image/*" class="hidden wp-file" data-mode="${mode}" data-dev="desktop">
          <button class="btn btn-small wp-up" data-mode="${mode}" data-dev="desktop">📤 上传</button>
          <button class="btn btn-small wp-pick" data-mode="${mode}" data-dev="desktop">🖼 从共享图库选</button>
          <button class="btn btn-small wp-mlpick" data-mode="${mode}" data-dev="desktop">🗂 从媒体库选</button>
        </div>
        <div class="img-grid wp-picker hidden" data-mode="${mode}" data-dev="desktop"></div>
        <h4 class="sub-h">移动端（<span id="wp-cnt-${mode}-mobile">0</span> 张）</h4>
        <div class="img-grid" id="wp-m-${mode}-mobile"></div>
        <div class="toolbar">
          <input type="text" class="wp-url-in" data-mode="${mode}" data-dev="mobile" placeholder="粘贴图片 URL">
          <button class="btn btn-small wp-url-add" data-mode="${mode}" data-dev="mobile">＋ URL 添加</button>
          <input type="file" accept="image/*" class="hidden wp-file" data-mode="${mode}" data-dev="mobile">
          <button class="btn btn-small wp-up" data-mode="${mode}" data-dev="mobile">📤 上传</button>
          <button class="btn btn-small wp-pick" data-mode="${mode}" data-dev="mobile">🖼 从共享图库选</button>
          <button class="btn btn-small wp-mlpick" data-mode="${mode}" data-dev="mobile">🗂 从媒体库选</button>
        </div>
        <div class="img-grid wp-picker hidden" data-mode="${mode}" data-dev="mobile"></div>
      </div>`).join('')}
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
            <button class="btn btn-small" id="avatar-ml">🗂 从媒体库选</button>
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
            <button class="btn btn-small" id="fav-ml">🗂 从媒体库选</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>✨ 首页贴纸 <span class="sub">${STICKER_CONFIG}</span></h2>
      <p class="hint">首页可拖拽的小贴纸。换图直接覆盖原文件；改位置/尺寸后点"保存位置"；新增贴纸会上传到 src/assets/images/stickers/ 并追加配置。配置改动先进待执行队列，急用点下方「⚡ 立即提交」。</p>
      <div class="toolbar"><button class="btn btn-small" id="sticker-now">⚡ 立即提交贴纸配置（不走队列）</button></div>
      <div class="img-grid" id="sticker-grid"></div>
      <div class="toolbar">
        <input type="file" id="sticker-file" accept="image/*" class="hidden">
        <input type="text" id="sticker-name" placeholder="新贴纸文件名（英文，如 cat2）" style="border:3px solid #000;border-radius:10px;padding:6px 10px">
        <button class="btn btn-small" id="sticker-add">＋ 新增贴纸</button>
        <button class="btn btn-small" id="sticker-ml">🗂 媒体库选图（先填文件名）</button>
      </div>
    </div>

    <div class="card">
      <h2>🧭 导航栏 Logo <span class="sub">src/assets/images/logo/（只替换文件内容）</span></h2>
      <div class="slot-row">
        <img class="slot-preview" src="${repoRawUrl('src/assets/images/logo/firefly-light.png')}" alt="浅色">
        <div>
          <p class="hint">浅色模式 Logo</p>
          <div class="toolbar"><input type="file" id="logo-l-file" accept="image/*" class="hidden"><button class="btn btn-small" id="logo-l-btn">📤 替换浅色 Logo</button> <button class="btn btn-small" id="logo-l-ml">🗂 媒体库</button></div>
        </div>
        <img class="slot-preview" src="${repoRawUrl('src/assets/images/logo/firefly-dark.png')}" alt="深色">
        <div>
          <p class="hint">深色模式 Logo</p>
          <div class="toolbar"><input type="file" id="logo-d-file" accept="image/*" class="hidden"><button class="btn btn-small" id="logo-d-btn">📤 替换深色 Logo</button> <button class="btn btn-small" id="logo-d-ml">🗂 媒体库</button></div>
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
      <p class="hint">登录页的背景图。预设一键切换，或自己上传（走 R2，保留在列表里随时切换，不覆盖原图）。config.js 的 adminBg 决定当前用哪张。</p>
      <div class="img-grid" id="adminbg-grid"></div>
      <div class="toolbar">
        <input type="file" id="adminbg-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="adminbg-btn">📤 上传新背景图</button>
        <button class="btn btn-small" id="adminbg-ml">🗂 从媒体库选</button>
      </div>
      <h3 class="sub-h">📱 手机版登录背景 <span class="sub">仅手机宽度（≤743px）· 桌面/平板仍用上面的图</span></h3>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" id="lmbg-rotate" checked><span class="slider"></span></label>
        <span>图片轮换 <span class="hint">每次打开登录页从内置竖图和自定义图里随机抽一张；关闭则固定用下面选中的图</span></span>
      </div>
      <p class="hint">点任意一张即固定为该图（自动关轮换）。上传的自定义图会保留在列表里，也会加入轮换；删除只是移出列表，不删 R2 原图。清除后手机登录页回退用上面的桌面背景。</p>
      <div class="img-grid" id="lmbg-grid"></div>
      <div class="switch-row">
        <span>显示方式</span>
        <button class="mini-btn" id="lmbg-fit-cover">铺满裁剪</button>
        <button class="mini-btn" id="lmbg-fit-contain">完整显示</button>
        <span class="hint">仅作用于手机专用图</span>
      </div>
      <div class="toolbar">
        <input type="file" id="lmbg-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="lmbg-btn">📤 自定义上传</button>
        <button class="btn btn-small" id="lmbg-ml">🗂 从媒体库选</button>
        <button class="btn btn-small" id="lmbg-clear">🧹 清除（用桌面图兜底）</button>
      </div>
    </div>

    <div class="card">
      <h2>🖥 控制台内部背景 <span class="sub">登录后内页背景 · 默认多张轮换</span></h2>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" id="innerbg-rotate" checked><span class="slider"></span></label>
        <span>背景轮换 <span class="hint">多张背景每 30 秒淡入淡出切换；关闭则用纯色主题背景</span></span>
      </div>
      <p class="hint">轮换池：下面这些图会自动轮换播放。上传新图走 R2 加入轮换池并一直保留，可逐张删除（只移出池子，不删 R2 原图）。</p>
      <div class="img-grid" id="innerbg-grid"></div>
      <div class="toolbar">
        <input type="file" id="innerbg-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="innerbg-btn">📤 上传图片加入轮换</button>
        <button class="btn btn-small" id="innerbg-ml">🗂 从媒体库选</button>
      </div>
      <h3 class="sub-h">📱 手机版内页背景 <span class="sub">仅手机宽度（≤743px）· 桌面/平板仍用上面的轮换池</span></h3>
      <div class="switch-row">
        <label class="switch"><input type="checkbox" id="mbg-rotate" checked><span class="slider"></span></label>
        <span>图片轮换 <span class="hint">内置竖图和自定义图在内页每 30 秒轮换；关闭则固定用下面选中的图</span></span>
      </div>
      <p class="hint">点任意一张即固定为该图（自动关轮换）。上传的自定义图会保留在列表里，也会加入轮换；删除只是移出列表，不删 R2 原图。清除后手机端内页回退用桌面背景（位置做竖屏适配）。</p>
      <div class="img-grid" id="mbg-grid"></div>
      <div class="switch-row">
        <span>显示方式</span>
        <button class="mini-btn" id="mbg-fit-cover">铺满裁剪</button>
        <button class="mini-btn" id="mbg-fit-contain">完整显示</button>
        <span class="hint">仅作用于手机专用图</span>
      </div>
      <div class="toolbar">
        <input type="file" id="mbg-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="mbg-btn">📤 自定义上传</button>
        <button class="btn btn-small" id="mbg-clear">🧹 清除（用桌面图兜底）</button>
      </div>
    </div>


    <div class="card">
      <h2>📊 报告图库（波奇酱） <span class="sub">总结报告的背景轮换池</span></h2>
      <p class="hint">总结报告每次打开会随机抽一张这里的图当背景。内置两张波奇图（默认、草稿）；上传的图片走 R2（自动转 WebP），地址存在本机，报告页直接取用。删除仅移出轮换池，不删 R2 文件。仓库侧图库文件同步待联调。</p>
      <div class="img-grid" id="report-g-grid"></div>
      <div class="toolbar">
        <input type="file" id="report-g-file" accept="image/*" class="hidden">
        <button class="btn btn-small" id="report-g-btn">📤 上传图片加入报告图库</button>
        <button class="btn btn-small" id="report-g-ml">🗂 从媒体库选</button>
      </div>
    </div>`;

  function modeImgCell(url, list, idx, mode) {
    const d = document.createElement('div');
    d.className = 'img-cell';
    // 固定语义（站长定）：某模式开轮播就轮播；关轮播时列表第一张就是固定显示的那张。
    // 「固定这张」= 把这张置顶；若该模式还开着轮播，顺手关掉（一次保存同时写列表顺序和轮播开关）。
    const carouselOn = !!wpModeCarousel[mode];
    const isFixed = !carouselOn && idx === 0;
    d.innerHTML = `<img loading="lazy" src="${esc(cfgImgPreview(url))}" alt="">
      <div class="url" title="${esc(url)}">${esc(url)}${isFixed ? ' · 📌 固定中' : ''}</div>
      <div class="ops">
        <button class="mini-btn" data-a="up">↑</button>
        <button class="mini-btn" data-a="down">↓</button>
        ${isFixed
          ? '<button class="mini-btn" data-a="fix" disabled>📌 固定中</button>'
          : '<button class="mini-btn" data-a="fix">固定这张</button>'}
        <button class="mini-btn danger" data-a="del">删除</button>
      </div>`;
    d.querySelector('[data-a=up]').onclick = async () => {
      if (idx === 0) return;
      [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
      try { await saveModeWallpapers(); renderModeWallpapers(); } catch (e) { toast(e.message, true); }
    };
    d.querySelector('[data-a=down]').onclick = async () => {
      if (idx === list.length - 1) return;
      [list[idx + 1], list[idx]] = [list[idx], list[idx - 1]];
      try { await saveModeWallpapers(); renderModeWallpapers(); } catch (e) { toast(e.message, true); }
    };
    const fixBtn = d.querySelector('[data-a=fix]');
    if (fixBtn && !isFixed) fixBtn.onclick = async () => {
      const wasCarousel = !!wpModeCarousel[mode];
      list.splice(idx, 1);
      list.unshift(url);
      if (wasCarousel) wpModeCarousel[mode] = false;
      try {
        await saveModeWallpapers(); renderModeWallpapers();
        toast(wasCarousel ? '已固定这张，该模式轮播已关' : '已固定这张');
      } catch (e) { toast(e.message, true); }
    };
    d.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('确定移除这张专属图？')) return;
      list.splice(idx, 1);
      try { await saveModeWallpapers(); renderModeWallpapers(); } catch (e) { toast(e.message, true); }
    };
    return d;
  }
  function renderModeWallpapers() {
    WP_MODES.forEach((mode) => {
      ['desktop', 'mobile'].forEach((dev) => {
        const g = $(`#wp-m-${mode}-${dev}`);
        if (!g) return;
        const list = wpModeSrc[mode][dev];
        g.innerHTML = '';
        list.forEach((u, i) => g.appendChild(modeImgCell(u, list, i, mode)));
        if (!list.length) g.innerHTML = '<p class="hint">暂无专属图，用共享图库 👆</p>';
        const cnt = $(`#wp-cnt-${mode}-${dev}`);
        if (cnt) cnt.textContent = list.length;
      });
      const chk = view.querySelector(`.wp-carousel[data-mode="${mode}"]`);
      if (chk) {
        chk.checked = !!wpModeCarousel[mode];
        chk.closest('.pill').classList.toggle('on', !!wpModeCarousel[mode]);
      }
    });
  }
  function wireModeWallpapers() {
    view.querySelectorAll('.wp-carousel').forEach((chk) => {
      chk.onchange = async () => {
        wpModeCarousel[chk.dataset.mode] = chk.checked;
        chk.closest('.pill').classList.toggle('on', chk.checked);
        try { await saveModeWallpapers(); } catch (e) { toast(e.message, true); }
      };
    });
    view.querySelectorAll('.wp-url-add').forEach((btn) => {
      btn.onclick = async () => {
        const { mode, dev } = btn.dataset;
        const input = view.querySelector(`.wp-url-in[data-mode="${mode}"][data-dev="${dev}"]`);
        const url = input.value.trim();
        if (!url) { toast('先粘贴图片 URL', true); return; }
        if (wpModeSrc[mode][dev].includes(url)) { toast('这张已经在了', true); return; }
        wpModeSrc[mode][dev].push(url);
        input.value = '';
        try { await saveModeWallpapers(); renderModeWallpapers(); } catch (e) { toast(e.message, true); }
      };
    });
    view.querySelectorAll('.wp-up').forEach((btn) => {
      btn.onclick = () => {
        const { mode, dev } = btn.dataset;
        view.querySelector(`.wp-file[data-mode="${mode}"][data-dev="${dev}"]`).click();
      };
    });
    view.querySelectorAll('.wp-file').forEach((fi) => {
      fi.onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const { mode, dev } = fi.dataset;
        toast('上传中…');
        try {
          const { urls } = await uploadImages([f], 'admin/wallpaper', 0.72);
          // 与其他三个添加入口对齐：同一 URL 已在列表里就不再重复添加
          // （旧写法独缺这道检查，同一张图能进列表两次，固定/轮播全乱套）
          if (wpModeSrc[mode][dev].includes(urls[0])) { toast('这张已经在了', true); }
          else {
            wpModeSrc[mode][dev].push(urls[0]);
            await saveModeWallpapers();
            renderModeWallpapers();
          }
        } catch (err) { toast(err.message, true); }
        e.target.value = '';
      };
    });
    view.querySelectorAll('.wp-pick').forEach((btn) => {
      btn.onclick = () => {
        const { mode, dev } = btn.dataset;
        const picker = view.querySelector(`.wp-picker[data-mode="${mode}"][data-dev="${dev}"]`);
        const shared = dev === 'desktop' ? wpDesktop : wpMobile;
        picker.innerHTML = '';
        shared.forEach((u) => {
          const c = document.createElement('div');
          c.className = 'img-cell';
          c.innerHTML = `<img loading="lazy" src="${esc(cfgImgPreview(u))}" alt=""><div class="ops"><button class="mini-btn" type="button">＋ 加入</button></div>`;
          c.querySelector('button').onclick = async () => {
            if (wpModeSrc[mode][dev].includes(u)) { toast('这张已经在了', true); return; }
            wpModeSrc[mode][dev].push(u);
            try { await saveModeWallpapers(); renderModeWallpapers(); } catch (e) { toast(e.message, true); }
          };
          picker.appendChild(c);
        });
        if (!shared.length) picker.innerHTML = '<p class="hint">共享图库是空的</p>';
        picker.classList.toggle('hidden');
      };
    });
    view.querySelectorAll('.wp-mlpick').forEach((btn) => {
      btn.onclick = () => {
        const { mode, dev } = btn.dataset;
        openMediaPicker(async (url) => {
          if (wpModeSrc[mode][dev].includes(url)) { toast('这张已经在了', true); return; }
          wpModeSrc[mode][dev].push(url);
          try { await saveModeWallpapers(); renderModeWallpapers(); } catch (e) { toast(e.message, true); }
        });
      };
    });
  }

  renderWallpapers();
  renderModeWallpapers();
  wireModeWallpapers();
  if (arg && arg.startsWith('wp-')) {
    const target = document.getElementById('wp-sec-' + arg.slice(3)) || document.getElementById(arg);
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('flash-anchor');
        setTimeout(() => target.classList.remove('flash-anchor'), 2200);
      }, 80);
    }
  }
  renderStickers();

  /* ⚡ 立即提交出口：绕过队列、走原路径直接落仓库（队列里已有的条目不受影响） */
  const wpNowBtn = $('#wp-now');
  if (wpNowBtn) wpNowBtn.onclick = async () => { try { await saveWallpapersNow(); renderWallpapers(); } catch (e) { toast(e.message, true); } };
  const wpModeNowBtn = $('#wp-mode-now');
  if (wpModeNowBtn) wpModeNowBtn.onclick = async () => { try { await saveModeWallpapersNow(); renderModeWallpapers(); } catch (e) { toast(e.message, true); } };
  const stickerNowBtn = $('#sticker-now');
  if (stickerNowBtn) stickerNowBtn.onclick = async () => { try { await saveStickersNow(); renderStickers(); } catch (e) { toast(e.message, true); } };
  const qHint = $('#img-queue-hint');
  if (qHint && typeof opQueueLoad === 'function') {
    const qn = opQueueLoad().length;
    if (qn) qHint.textContent = ` ⏳ 本机还有 ${qn} 项待执行（顶栏「📥 待执行」）。`;
  }

  // ---- 报告图库（波奇酱）：内置两张 + 本机上传（R2 直链，存 localStorage） ----
  // 待联调：图库列表的仓库侧文件同步（需一次 commit；为避免每次上传都触发构建，暂只存本机）。
  function renderReportGallery() {
    const g = $('#report-g-grid');
    if (!g) return;
    const builtins = [
      { url: 'login-art.jpg', name: '波奇酱（默认）', builtin: true },
      { url: 'login-art-sketch.png', name: '波奇草稿（旧版）', builtin: true },
    ];
    const uploaded = reportGallery().map((url) => ({ url, name: '用户上传', builtin: false }));
    const all = [...builtins, ...uploaded];
    g.innerHTML = all.map((it, i) => `<div class="img-cell">
      <img loading="lazy" src="${esc(it.url)}" alt="${esc(it.name)}">
      <div class="ops" style="gap:6px"><span class="hint">${esc(it.name)}</span>
      ${it.builtin ? '' : `<button class="mini-btn" data-del="${i - builtins.length}">删除</button>`}</div>
    </div>`).join('') || '<p class="hint">空的，传一张吧 👇</p>';
    g.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        if (!confirm('把这张移出报告图库？（R2 上的文件保留，之后重新上传可以再加回）')) return;
        const list = reportGallery();
        list.splice(+b.dataset.del, 1);
        try { localStorage.setItem(REPORT_GALLERY_KEY, JSON.stringify(list)); } catch (e) {}
        renderReportGallery();
        toast('已移出报告图库（R2 文件未删）');
      };
    });
  }
  renderReportGallery();
  $('#report-g-btn').onclick = () => $('#report-g-file').click();
  $('#report-g-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('上传中…');
    try {
      const { urls } = await uploadImages([f], 'admin/report-bocchi');
      const list = reportGallery();
      list.push(urls[0]);
      try { localStorage.setItem(REPORT_GALLERY_KEY, JSON.stringify(list)); } catch (err) {}
      /* R2 上传本身不产生仓库 commit，日志记 pending，下次仓库保存时一并同步 */
      oplogRecord('图片', '上传', '报告图库', f.name);
      renderReportGallery();
      toast('已加入报告图库，打开报告时会随机抽到');
    } catch (err) { toast(err.message, true); }
  };

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
    await saveWithLog('public/admin/config.js', next, data.sha, `切换控制台背景为 ${file} [管理台]`, { type: '图片', action: '切换', target: file });
    CFG.adminBg = file;
    renderAdminBg();
    toast('控制台背景已切换（重新进登录页生效）');
  }
  /* 桌面登录背景的自定义图列表（R2 直链存本机，可多张保留） */
  function adminBgCustoms() { try { const v = JSON.parse(localStorage.getItem('admin-bg-customs') || '[]'); return Array.isArray(v) ? v.filter((u) => /^https?:\/\//.test(u)) : []; } catch (e) { return []; } }
  function saveAdminBgCustoms(list) { try { localStorage.setItem('admin-bg-customs', JSON.stringify(list)); } catch (e) {} }
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
    adminBgCustoms().forEach((u, i, arr) => {
      const name = '自定义上传' + (arr.length > 1 ? ' ' + (i + 1) : '');
      const d = document.createElement('div');
      d.className = 'img-cell';
      d.innerHTML = `<img loading="lazy" src="${esc(u)}" alt="${esc(name)}">
        <div class="url" title="${esc(name)}">${esc(name)}${u === cur ? ' ✅ 使用中' : ''}</div>
        <div class="ops"><button class="mini-btn" data-a="use"${u === cur ? ' disabled' : ''}>设为背景</button><button class="mini-btn" data-a="del">删除</button></div>`;
      d.querySelector('[data-a=use]').onclick = async () => {
        try { await setAdminBg(u); } catch (e) { toast(e.message, true); }
      };
      d.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm('删除这张自定义背景？只是移出列表，R2 上的原图不会删。')) return;
        saveAdminBgCustoms(adminBgCustoms().filter((x) => x !== u));
        if (CFG.adminBg === u) { try { await setAdminBg('login-art.jpg'); } catch (e) { toast(e.message, true); } }
        renderAdminBg();
        toast('已删除这张自定义背景');
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
    toast('上传中…');
    try {
      const { urls } = await uploadImages([f], 'admin/login-bg');
      const list = adminBgCustoms();
      if (!list.includes(urls[0])) { list.push(urls[0]); saveAdminBgCustoms(list); }
      oplogRecord('图片', '上传', '登录页背景自定义图', f.name);
      await setAdminBg(urls[0]); // 上传完直接设为当前背景（setAdminBg 内部会重渲染并提示）
    } catch (err) { toast(err.message, true); }
  };

  // ---- 控制台内部背景：默认轮换 + 一个禁用开关 ----
  const INNERBG_PRESETS = [
    { file: 'login-art.jpg', name: '波奇酱' },
    { file: 'login-art-alt.jpg', name: '星空海滨站' },
    { file: 'login-art-sketch.png', name: '波奇草稿' },
  ];
  /* 桌面内页背景的自定义图列表（R2 直链存本机，进轮换池，可多张保留） */
  function innerCustoms() { try { const v = JSON.parse(localStorage.getItem('admin-inner-bg-customs') || '[]'); return Array.isArray(v) ? v.filter((u) => /^https?:\/\//.test(u)) : []; } catch (e) { return []; } }
  function saveInnerCustoms(list) { try { localStorage.setItem('admin-inner-bg-customs', JSON.stringify(list)); } catch (e) {} }
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
    const list = INNERBG_PRESETS.concat(hasCustom ? [{ file: 'admin-inner-bg.jpg', name: customName, custom: true }] : [])
      .concat(innerCustoms().map((u, i, arr) => ({ file: u, name: '自定义上传' + (arr.length > 1 ? ' ' + (i + 1) : ''), customUrl: true })));
    list.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'img-cell';
      d.innerHTML = `<img loading="lazy" src="${p.customUrl ? esc(p.file) : repoRawUrl('public/admin/' + p.file)}" alt="${esc(p.name)}">
        <div class="url" title="${esc(p.name)}">${esc(p.name)}</div>
        ${p.custom ? '<div class="ops"><button class="mini-btn" data-a="rename">✏️ 改名</button></div>' : ''}${p.customUrl ? '<div class="ops"><button class="mini-btn" data-a="del">删除</button></div>' : ''}`;
      if (p.customUrl) {
        d.querySelector('[data-a=del]').onclick = () => {
          if (!confirm('删除这张自定义背景？只是移出轮换池，R2 上的原图不会删。')) return;
          saveInnerCustoms(innerCustoms().filter((u) => u !== p.file));
          applyInnerBg(true);
          renderInnerBg();
          toast('已移出轮换池');
        };
      }
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
      const { urls } = await uploadImages([f], 'admin/inner-bg');
      const list = innerCustoms();
      if (!list.includes(urls[0])) { list.push(urls[0]); saveInnerCustoms(list); }
      oplogRecord('图片', '上传', '内部背景自定义图', f.name);
      applyInnerBg(true);
      renderInnerBg();
      toast('已加入轮换（会一直保留在池子里）');
    } catch (err) { toast(err.message, true); }
  };

  // ---- 手机版背景：登录页与内页两套独立设置，分别并入「控制台背景」「控制台内部背景」卡 ----
  const MBG_BUILTINS = [
    { file: 'bg-m-pink.webp', name: '粉红款（默认）' },
    { file: 'bg-m-2.webp', name: '竖版波奇 2' },
    { file: 'bg-m-3.webp', name: '竖版波奇 3' },
  ];
  function mbgGet(key, dft) { try { const v = localStorage.getItem(key); return v === null ? dft : v; } catch (e) { return dft; } }
  function mbgSet(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
  /* scope: { p 元素 id 前缀, fixed/rotate/fit 三个 localStorage 键, dir R2 上传目录, noun 名称, apply 改完立即生效的刷新函数 } */
  function setupPhoneBg(scope) {
    const CKEY = scope.fixed + '-customs'; // 自定义图列表键（JSON 数组 of R2 直链）
    function customs() {
      let list = [];
      try { const v = JSON.parse(mbgGet(CKEY, '[]')); if (Array.isArray(v)) list = v.filter((u) => /^https?:\/\//.test(u)); } catch (e) {}
      const fx = mbgGet(scope.fixed, '');
      /* 旧版单张时代 fixed 本身是直链：并入列表并落盘，那张图不丢 */
      if (/^https?:\/\//.test(fx) && !list.includes(fx)) { list = [fx, ...list]; mbgSet(CKEY, JSON.stringify(list)); }
      return list;
    }
    function saveCustoms(list) { mbgSet(CKEY, JSON.stringify(list)); }
    function render() {
      const g = $('#' + scope.p + '-grid');
      if (!g) return;
      const fixed = mbgGet(scope.fixed, 'bg-m-pink.webp');
      const rotate = mbgGet(scope.rotate, '1') !== '0';
      const fit = mbgGet(scope.fit, 'cover');
      const cleared = fixed === 'none';
      const cells = MBG_BUILTINS.slice();
      customs().forEach((u, i, arr) => cells.push({ file: u, name: '自定义上传' + (arr.length > 1 ? ' ' + (i + 1) : ''), custom: true }));
      g.innerHTML = cleared ? '<p class="hint">当前已清除：手机端回退使用桌面背景。点任意一张图可重新启用手机背景。</p>' : '';
      cells.forEach((p) => {
        const active = !cleared && !rotate && fixed === p.file;
        const d = document.createElement('div');
        d.className = 'img-cell';
        d.innerHTML = `<img loading="lazy" src="${p.custom ? esc(p.file) : repoRawUrl('public/admin/' + p.file)}" alt="${esc(p.name)}">
          <div class="url" title="${esc(p.name)}">${esc(p.name)}${active ? ' ✅ 固定使用中' : (!cleared && rotate ? ' · 轮换中' : '')}</div>
          <div class="ops"><button class="mini-btn" data-a="fix"${active ? ' disabled' : ''}>固定这张</button>${p.custom ? '<button class="mini-btn" data-a="del">删除</button>' : ''}</div>`;
        d.querySelector('[data-a=fix]').onclick = () => {
          mbgSet(scope.fixed, p.file);
          mbgSet(scope.rotate, '0');
          const sw = $('#' + scope.p + '-rotate'); if (sw) sw.checked = false;
          scope.apply();
          render();
          toast(`手机版${scope.noun}背景已固定为「${p.name}」`);
        };
        if (p.custom) d.querySelector('[data-a=del]').onclick = () => {
          if (!confirm('删除这张自定义背景？只是移出列表，R2 上的原图不会删。')) return;
          saveCustoms(customs().filter((u) => u !== p.file));
          if (mbgGet(scope.fixed, '') === p.file) mbgSet(scope.fixed, 'bg-m-pink.webp');
          scope.apply();
          render();
          toast('已删除这张自定义背景');
        };
        g.appendChild(d);
      });
      const sw = $('#' + scope.p + '-rotate');
      if (sw && !sw._wired) {
        sw._wired = true;
        sw.checked = rotate;
        sw.onchange = () => {
          mbgSet(scope.rotate, sw.checked ? '1' : '0');
          if (sw.checked && mbgGet(scope.fixed, '') === 'none') mbgSet(scope.fixed, 'bg-m-pink.webp');
          scope.apply();
          render();
          toast(sw.checked ? `手机版${scope.noun}背景轮换已开启（内置图与自定义图一起轮换）` : `手机版${scope.noun}背景轮换已关闭，固定当前选图`);
        };
      } else if (sw) { sw.checked = rotate; }
      const fc = $('#' + scope.p + '-fit-cover'), ft = $('#' + scope.p + '-fit-contain');
      if (fc && ft) {
        fc.disabled = fit === 'cover';
        ft.disabled = fit === 'contain';
        fc.onclick = () => { mbgSet(scope.fit, 'cover'); scope.apply(); render(); };
        ft.onclick = () => { mbgSet(scope.fit, 'contain'); scope.apply(); render(); };
      }
    }
    render();
    const btn = $('#' + scope.p + '-btn'), file = $('#' + scope.p + '-file'), clr = $('#' + scope.p + '-clear');
    if (btn && file) btn.onclick = () => file.click();
    if (file) file.onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      toast('上传中…');
      try {
        const { urls } = await uploadImages([f], scope.dir);
        const list = customs();
        if (!list.includes(urls[0])) { list.push(urls[0]); saveCustoms(list); }
        mbgSet(scope.fixed, urls[0]);
        mbgSet(scope.rotate, '0');
        const sw = $('#' + scope.p + '-rotate'); if (sw) sw.checked = false;
        oplogRecord('图片', '上传', `手机版${scope.noun}背景`, f.name);
        scope.apply();
        render();
        toast(`手机版${scope.noun}背景已换成自定义图（固定显示）`);
      } catch (err) { toast(err.message, true); }
    };
    if (clr) clr.onclick = () => {
      if (!confirm(`清除手机版${scope.noun}背景？清除后手机端回退用桌面背景，自定义上传的图将不再被使用。`)) return;
      mbgSet(scope.fixed, 'none');
      scope.apply();
      render();
      toast(`已清除手机版${scope.noun}背景，手机端回退用桌面图`);
    };
  }
  setupPhoneBg({ p: 'lmbg', fixed: 'admin-login-bg-mobile', rotate: 'admin-login-bg-mobile-rotate', fit: 'admin-login-bg-mobile-fit', dir: 'admin/login-mobile-bg', noun: '登录页', apply: () => { if (typeof paintLoginStage === 'function') paintLoginStage(); } });
  setupPhoneBg({ p: 'mbg', fixed: 'admin-inner-bg-mobile', rotate: 'admin-inner-bg-mobile-rotate', fit: 'admin-inner-bg-mobile-fit', dir: 'admin/mobile-bg', noun: '内页', apply: () => applyInnerBg(true) });

  // ---- 背景图：添加 ----
  $('#wp-d-add').onclick = () => $('#wp-d-file').click();
  $('#wp-m-add').onclick = () => $('#wp-m-file').click();
  $('#wp-d-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addWallpaper(f, wpDesktop); };
  $('#wp-m-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addWallpaper(f, wpMobile); };
  /* 🗂 从媒体库选图：各图片位统一接线 */
  async function addWallpaperUrl(url, list) {
    if (list.includes(url)) { toast('这张已经在了', true); return; }
    list.push(url);
    try { await saveWallpapers(); renderWallpapers(); toast('已从媒体库添加'); } catch (e) { toast(e.message, true); }
  }
  const mlBind = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  mlBind('#wp-d-ml', () => openMediaPicker((url) => addWallpaperUrl(url, wpDesktop)));
  mlBind('#wp-m-ml', () => openMediaPicker((url) => addWallpaperUrl(url, wpMobile)));
  mlBind('#report-g-ml', () => openMediaPicker((url) => {
    const list = reportGallery();
    if (list.includes(url)) { toast('这张已经在报告图库里了', true); return; }
    list.push(url);
    try { localStorage.setItem(REPORT_GALLERY_KEY, JSON.stringify(list)); } catch (e) {}
    oplogRecord('图片', '媒体库选图', '报告图库', url.split('/').pop());
    renderReportGallery();
    toast('已从媒体库加入报告图库');
  }));
  mlBind('#avatar-ml', () => pickMediaIntoFileInput($('#avatar-file')));
  mlBind('#fav-ml', () => pickMediaIntoFileInput($('#fav-file')));
  mlBind('#logo-l-ml', () => pickMediaIntoFileInput($('#logo-l-file')));
  mlBind('#logo-d-ml', () => pickMediaIntoFileInput($('#logo-d-file')));
  mlBind('#adminbg-ml', () => pickMediaIntoFileInput($('#adminbg-file')));
  mlBind('#lmbg-ml', () => pickMediaIntoFileInput($('#lmbg-file')));
  mlBind('#innerbg-ml', () => pickMediaIntoFileInput($('#innerbg-file')));
  mlBind('#sticker-ml', () => pickMediaIntoFileInput($('#sticker-file')));

  // ---- 头像 ----
  $('#avatar-btn').onclick = () => $('#avatar-file').click();
  $('#avatar-file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm(`用「${f.name}」替换头像？public/avatar.png 和 .avif 都会换成这张，对外地址不变。`)) return;
    toast('头像生成中…');
    try {
      await replaceRepoImage('public/avatar.png', f, { format: 'image/png', quality: 0.92, maxDim: 1024, label: '头像 PNG' });
      // AVIF：浏览器支持编码才写，不支持就跳过并提示（avatar.png 已更新可用）
      try {
        const avif = await convertImage(f, { format: 'image/avif', quality: 0.8, maxDim: 1024 });
        if (avif.type && avif.type.includes('avif')) {
          const b64 = await blobToBase64(avif);
          await saveWithLog('public/avatar.avif', b64, await getSha('public/avatar.avif'), '替换图片 public/avatar.avif [管理台]', { type: '图片', action: '替换', target: 'public/avatar.avif' }, { isBase64: true });
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
    if (!confirm(`用「${f.name}」替换站点 Favicon？两个尺寸的图标文件都会被覆盖。`)) return;
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
      if (!confirm(`用「${f.name}」替换${label}？原文件会被覆盖。`)) return;
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

/* ================= MP3 标签（ID3）自动识别 =================
 * 浏览器端解析 ID3v2（TIT2 歌名 / TPE1 歌手 / TALB 专辑 / APIC 封面 / USLT 歌词），
 * 无标签时回退 ID3v1。文本帧编码字节 0 名义上是 Latin-1，但中文文件实际多为 GBK
 * 或 UTF-8，故按 UTF-8 严格解码失败 → GBK 的顺序兜底。解析失败不阻塞手动填写。 */
function id3SyncSafe(u8, off) {
  return ((u8[off] & 0x7f) << 21) | ((u8[off + 1] & 0x7f) << 14) | ((u8[off + 2] & 0x7f) << 7) | (u8[off + 3] & 0x7f);
}
function id3DecodeText(bytes) {
  if (!bytes.length) return '';
  const enc = bytes[0];
  const body = bytes.subarray(1);
  const strip = (s) => s.replace(/\0+$/, '').trim();
  try {
    if (enc === 3) return strip(new TextDecoder('utf-8').decode(body));
    if (enc === 1) return strip(new TextDecoder('utf-16').decode(body));
    if (enc === 2) return strip(new TextDecoder('utf-16be').decode(body));
    try { return strip(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
    catch (e) { return strip(new TextDecoder('gbk').decode(body)); }
  } catch (e) { return ''; }
}
function id3ParseApic(data) {
  const enc = data[0];
  let i = 1, mime = '';
  while (i < data.length && data[i] !== 0) { mime += String.fromCharCode(data[i]); i++; }
  i++; /* mime 的结束 0 */
  i++; /* 图片类型字节 */
  if (enc === 1 || enc === 2) {
    while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < data.length && data[i] !== 0) i++;
    i++;
  }
  const img = data.subarray(i);
  if (!img.length) return null;
  return new Blob([img], { type: mime && mime.startsWith('image/') ? mime : 'image/jpeg' });
}
async function readMp3Tags(file) {
  const out = { title: '', artist: '', album: '', cover: null, lyrics: '' };
  try {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) { /* "ID3" */
      const major = u8[3];
      const tagSize = id3SyncSafe(u8, 6);
      let off = 10;
      if ((u8[5] & 0x40) && major === 3) off += 10; /* v2.3 扩展头（粗略跳过） */
      if ((u8[5] & 0x40) && major === 4) off += 10 + id3SyncSafe(u8, 10);
      const end = Math.min(10 + tagSize, u8.length);
      while (off + 10 <= end) {
        const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fsize = major === 4
          ? id3SyncSafe(u8, off + 4)
          : ((u8[off + 4] << 24) | (u8[off + 5] << 16) | (u8[off + 6] << 8) | u8[off + 7]) >>> 0;
        if (fsize <= 0 || off + 10 + fsize > u8.length + 1024) break;
        const data = u8.subarray(off + 10, off + 10 + fsize);
        if (id === 'TIT2') out.title = id3DecodeText(data);
        else if (id === 'TPE1') out.artist = id3DecodeText(data);
        else if (id === 'TALB') out.album = id3DecodeText(data);
        else if (id === 'APIC' && !out.cover) out.cover = id3ParseApic(data);
        else if (id === 'USLT' && !out.lyrics) {
          /* USLT = 编码(1) + 语言(3) + 描述（以编码对应的 0 结尾） + 歌词正文 */
          const enc = data[0];
          let j = 4;
          if (enc === 1 || enc === 2) { while (j + 1 < data.length && !(data[j] === 0 && data[j + 1] === 0)) j += 2; j += 2; }
          else { while (j < data.length && data[j] !== 0) j++; j++; }
          const joined = new Uint8Array(data.length - j + 1);
          joined[0] = enc; joined.set(data.subarray(j), 1);
          out.lyrics = id3DecodeText(joined);
        }
        off += 10 + fsize;
      }
    }
    if ((!out.title || !out.artist) && u8.length >= 128) {
      const t = u8.subarray(u8.length - 128);
      if (t[0] === 0x54 && t[1] === 0x41 && t[2] === 0x47) { /* "TAG" */
        const dec = (b) => { try { return new TextDecoder('gbk').decode(b).replace(/\0+$/, '').trim(); } catch (e) { return ''; } };
        if (!out.title) out.title = dec(t.subarray(3, 33));
        if (!out.artist) out.artist = dec(t.subarray(33, 63));
        if (!out.album) out.album = dec(t.subarray(63, 93));
      }
    }
  } catch (e) { /* 解析失败：返回已读到的部分，表单仍可手动填 */ }
  return out;
}

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
    await saveWithLog(MUSIC_CONFIG, next, cfg.sha, msg || '更新播放器歌单 [管理台]', { type: '音乐', action: '更新', target: '播放器歌单' });
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
      <div class="toolbar">
        <label class="hint" for="ms-kbps">上传压缩（保存时在浏览器里重编码，标签已提取到表单，不受影响）</label>
        <select id="ms-kbps">
          <option value="0">不压缩（原文件）</option>
          <option value="256">256 kbps · 轻压</option>
          <option value="192">192 kbps · 推荐</option>
          <option value="128">128 kbps · 省空间</option>
          <option value="96">96 kbps · 最小</option>
        </select>
        <span class="hint" id="ms-kbps-note"></span>
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
  /* 上传压缩档位：记住上次选择 */
  try { const saved = localStorage.getItem('admin-mp3-kbps'); if (saved && $('#ms-kbps')) $('#ms-kbps').value = saved; } catch (e) {}
  const kbpsNote = () => {
    const k = parseInt(($('#ms-kbps') || {}).value || '0', 10);
    $('#ms-kbps-note').textContent = !mp3File ? '' : k > 0
      ? `原文件 ${(mp3File.size / 1048576).toFixed(1)} MB，保存时压到 ${k} kbps`
      : `原文件 ${(mp3File.size / 1048576).toFixed(1)} MB，不压缩`;
  };
  if ($('#ms-kbps')) $('#ms-kbps').onchange = () => { try { localStorage.setItem('admin-mp3-kbps', $('#ms-kbps').value); } catch (e) {} kbpsNote(); };
  $('#ms-mp3-btn').onclick = () => $('#ms-mp3').click();
  $('#ms-mp3').onchange = async (e) => {
    mp3File = e.target.files[0] || null;
    if (!mp3File) { $('#ms-mp3-name').textContent = '未选择文件'; return; }
    $('#ms-url').value = '';
    kbpsNote();
    $('#ms-mp3-name').textContent = `已选：${mp3File.name}（保存时上传）· 正在识别标签…`;
    /* 选中 MP3 立即解析 ID3：歌名/歌手直接填表单，封面自动上传 R2，歌词填歌词框 */
    try {
      const tags = await readMp3Tags(mp3File);
      const got = [];
      if (tags.title) { $('#ms-name').value = tags.title; got.push(`歌名《${tags.title}》`); }
      if (tags.artist) { $('#ms-artist').value = tags.artist; got.push(`歌手 ${tags.artist}`); }
      if (tags.album) got.push(`专辑《${tags.album}》`);
      if (tags.lyrics && !$('#ms-lrc').value.trim()) { $('#ms-lrc').value = tags.lyrics; got.push('歌词'); }
      if (tags.cover) {
        try {
          const ext = tags.cover.type.includes('png') ? 'png' : 'jpg';
          const cf = new File([tags.cover], `cover-auto.${ext}`, { type: tags.cover.type });
          const { urls } = await uploadImages([cf], 'admin/music-cover');
          coverUrl = urls[0];
          const p = $('#ms-cover-preview');
          p.src = coverUrl; p.classList.remove('hidden');
          $('#ms-cover-name').textContent = '已从 MP3 封面自动上传';
          got.push('封面（已上传）');
        } catch (err) { got.push('封面识别到但上传失败，可手动传'); }
      }
      $('#ms-mp3-name').textContent = `已选：${mp3File.name}（保存时上传）` + (got.length ? ` · 已自动识别：${got.join('、')}` : ' · 没读到 ID3 标签，请手动填写');
      if (got.length) toast('MP3 标签已自动填好，核对后点「添加到歌单并保存」');
    } catch (err) {
      $('#ms-mp3-name').textContent = `已选：${mp3File.name}（保存时上传）· 标签识别失败，请手动填写`;
    }
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
        let upFile = mp3File;
        const kbps = parseInt(($('#ms-kbps') || {}).value || '0', 10);
        if (kbps > 0) {
          try {
            toast(`MP3 压缩中（${kbps} kbps）…`);
            upFile = await compressMp3(mp3File, kbps, (p) => { $('#ms-mp3-name').textContent = `压缩中… ${Math.round(p * 100)}%`; });
            toast(`压缩完成：${(mp3File.size / 1048576).toFixed(1)} MB → ${(upFile.size / 1048576).toFixed(1)} MB，上传中…`);
          } catch (err) { toast('压缩失败，改用原文件上传：' + err.message, true); upFile = mp3File; }
        } else toast('mp3 上传中…');
        const { urls } = await uploadRawFiles([upFile], 'admin/music');
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
