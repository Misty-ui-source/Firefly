/* Alexander 管理台：相册管理（gallery.js，在 app.js/media.js 之后加载）
 * 相册定义：src/config/galleryConfig.ts 的 albums[]（id/name/description/location/date/tags/cover/password/passwordHint）
 * 照片来源：构建时 scanAlbumPhotos() = public/gallery/<id>/ 目录本地图片 + urls.txt 远程 URL
 * 新增照片走 R2（admin/gallery/<id>/，自动转 WebP）→ 追加 urls.txt；本地文件删除走 GitHub API
 * 注意：albums[] 里有多行 // 注释（含引号），扫描括号/花括号时必须跳过注释
 */
'use strict';

/* GALLERY_CONFIG 已在 media.js 中声明（media.js 先加载），这里直接复用，避免 const 重复声明报错 */
const GALLERY_DIR = 'public/gallery';
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;
const URLS_HEADER = '# 相册图片 URL 列表：每行一个图片 URL（支持 jpg/png/webp/avif/gif）\n# # 开头的是注释行，会被忽略；空行也会被忽略\n# 由管理台自动维护，也可以手动编辑\n';

/* ---------- 注释感知的括号/花括号扫描 ---------- */
// 找到行首 `key: [` 并配平到对应的 `]`，返回 { indent, openIdx, closeIdx }（openIdx/closeIdx 为括号在原文中的下标）
function scanBracketBlock(text, key) {
  const m = text.match(new RegExp(`^(\\s*)${key}\\s*:\\s*\\[`, 'm'));
  if (!m) return null;
  const indent = m[1];
  const openIdx = m.index + m[0].length - 1;
  let depth = 0, inStr = false, q = '', escNext = false, inLine = false, inBlock = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      if (escNext) escNext = false;
      else if (c === '\\') escNext = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return { indent, openIdx, closeIdx: i }; }
  }
  return null;
}
// 在块文本内找出顶层 {...} 对象的位置（相对于块文本），字符串/注释感知
function topBraceObjects(blockText) {
  const objs = [];
  let depth = 0, inStr = false, q = '', escNext = false, inLine = false, inBlock = false, start = -1;
  for (let i = 0; i < blockText.length; i++) {
    const c = blockText[i], n = blockText[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      if (escNext) escNext = false;
      else if (c === '\\') escNext = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { objs.push({ start, end: i + 1 }); start = -1; } }
  }
  return objs;
}

/* ---------- 相册对象解析/序列化 ---------- */
function parseAlbum(objText) {
  const tagsM = objText.match(/tags\s*:\s*(\[[^\]]*\])/);
  return {
    id: getStrField(objText, 'id'),
    name: getStrField(objText, 'name'),
    description: getStrField(objText, 'description'),
    location: getStrField(objText, 'location'),
    date: getStrField(objText, 'date'),
    cover: getStrField(objText, 'cover'),
    tags: tagsM ? parseStringList(tagsM[1]) : [],
    hasPassword: /^\s*password\s*:/m.test(objText),
    password: getStrField(objText, 'password'), // 只在内存里流转、回写用，界面上不展示
    passwordHint: getStrField(objText, 'passwordHint'),
  };
}
function serializeAlbum(a, objIndent) {
  const L = [
    `${objIndent}{`,
    `${objIndent}\tid: "${escConfigStr(a.id)}",`,
    `${objIndent}\tname: "${escConfigStr(a.name)}",`,
    `${objIndent}\tdescription: "${escConfigStr(a.description)}",`,
    `${objIndent}\tlocation: "${escConfigStr(a.location)}",`,
    `${objIndent}\tdate: "${escConfigStr(a.date)}",`,
    `${objIndent}\ttags: [${a.tags.map((t) => `"${escConfigStr(t)}"`).join(', ')}],`,
  ];
  if (a.cover) L.push(`${objIndent}\tcover: "${escConfigStr(a.cover)}",`);
  if (a.password) {
    L.push(`${objIndent}\tpassword: "${escConfigStr(a.password)}",`);
    if (a.passwordHint) L.push(`${objIndent}\tpasswordHint: "${escConfigStr(a.passwordHint)}",`);
  }
  L.push(`${objIndent}},`);
  return L.join('\n');
}
async function readAlbums() {
  const data = await ghGetFile(GALLERY_CONFIG);
  const blk = scanBracketBlock(data.text, 'albums');
  if (!blk) throw new Error('galleryConfig.ts 里找不到 albums');
  const blockText = data.text.slice(blk.openIdx, blk.closeIdx + 1);
  const objs = topBraceObjects(blockText);
  const albums = objs.map((o) => ({ ...parseAlbum(blockText.slice(o.start, o.end)), _pos: o }));
  return { data, blk, blockText, albums };
}
async function appendAlbum(album) {
  const { data, blk, albums } = await readAlbums();
  const objIndent = blk.indent + '\t';
  const newObj = serializeAlbum(album, objIndent);
  let next;
  if (!albums.length) {
    next = data.text.slice(0, blk.openIdx + 1) + '\n' + newObj + '\n' + blk.indent + data.text.slice(blk.closeIdx);
  } else {
    const last = albums[albums.length - 1]._pos;
    const absEnd = blk.openIdx + last.end;
    const cm = data.text.slice(absEnd).match(/^\s*,/);
    if (!cm) throw new Error('相册数组格式异常：最后一个对象后没有逗号');
    const insertAt = absEnd + cm[0].length;
    next = data.text.slice(0, insertAt) + '\n' + newObj + data.text.slice(insertAt);
  }
  await ghPutFile(GALLERY_CONFIG, next, data.sha, `新建相册「${album.name}」 [管理台]`);
}
async function replaceAlbum(id, album) {
  const { data, blk, blockText, albums } = await readAlbums();
  const idx = albums.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error('找不到相册 ' + id);
  const pos = albums[idx]._pos;
  const newObj = serializeAlbum(album, blk.indent + '\t');
  const next = data.text.slice(0, blk.openIdx + pos.start) + newObj + data.text.slice(blk.openIdx + pos.end);
  await ghPutFile(GALLERY_CONFIG, next, data.sha, `更新相册「${album.name}」 [管理台]`);
}
async function removeAlbum(id) {
  const { data, blk, blockText, albums } = await readAlbums();
  const idx = albums.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error('找不到相册 ' + id);
  const pos = albums[idx]._pos;
  const absStart = blk.openIdx + pos.start;
  const absEnd = blk.openIdx + pos.end;
  // 整行删除：从对象所在行行首，删到对象后逗号与换行（无尾逗号时也能保住语法）
  const lineStart = data.text.lastIndexOf('\n', absStart - 1) + 1;
  const tail = data.text.slice(absEnd).match(/^[ \t]*,[ \t]*\r?\n?/);
  const delEnd = absEnd + (tail ? tail[0].length : 0);
  const next = data.text.slice(0, lineStart) + data.text.slice(delEnd);
  await ghPutFile(GALLERY_CONFIG, next, data.sha, `删除相册 ${id} [管理台]`);
}
/* 按给定 id 顺序重排 albums[]：只重组对象区，数组前的注释与各对象原文一字不动 */
async function reorderAlbums(orderedIds) {
  const { data, blk, blockText, albums } = await readAlbums();
  if (albums.length < 2) return;
  const byId = {};
  albums.forEach((a) => { byId[a.id] = blockText.slice(a._pos.start, a._pos.end); });
  if (!orderedIds.every((id) => byId[id])) throw new Error('排序数据对不上，已取消');
  const first = albums[0]._pos.start;
  const lastEnd = albums[albums.length - 1]._pos.end;
  const sep = ',\n' + blk.indent + '\t';
  const mid = orderedIds.map((id) => byId[id]).join(sep) + ',';
  /* lastEnd 处是旧的尾逗号，mid 已自带，跳过它 */
  const nextBlock = blockText.slice(0, first) + mid + blockText.slice(lastEnd + 1);
  const next = data.text.slice(0, blk.openIdx) + nextBlock + data.text.slice(blk.closeIdx + 1);
  await ghPutFile(GALLERY_CONFIG, next, data.sha, '相册排序 [管理台]');
}

/* ---------- urls.txt 与目录 ---------- */
function parseUrlsTxt(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
async function loadAlbumPhotos(albumId) {
  const [dirList, urlsData] = await Promise.all([
    ghGetFile(`${GALLERY_DIR}/${albumId}`).catch(() => []),
    ghGetFile(`${GALLERY_DIR}/${albumId}/urls.txt`).catch(() => null),
  ]);
  const files = (Array.isArray(dirList) ? dirList : []).filter((f) => f.type === 'file');
  const coverFile = files.find((f) => IMG_EXT.test(f.name) && /^cover\./i.test(f.name)) || null;
  const localImgs = files.filter((f) => IMG_EXT.test(f.name) && !/^cover\./i.test(f.name));
  const remoteUrls = urlsData ? parseUrlsTxt(urlsData.text) : [];
  return { files, coverFile, localImgs, remoteUrls, urlsSha: urlsData ? urlsData.sha : null, urlsText: urlsData ? urlsData.text : null };
}
function albumCoverPreview(album, photos) {
  if (album.cover) return cfgImgPreview(album.cover);
  if (photos.coverFile) return repoRawUrl(`${GALLERY_DIR}/${album.id}/${photos.coverFile.name}`);
  if (photos.localImgs.length) return repoRawUrl(`${GALLERY_DIR}/${album.id}/${photos.localImgs[0].name}`);
  if (photos.remoteUrls.length) return photos.remoteUrls[0];
  return '';
}
async function appendUrls(albumId, newUrls) {
  const path = `${GALLERY_DIR}/${albumId}/urls.txt`;
  const cur = await ghGetFile(path).catch(() => null);
  const base = cur ? cur.text : URLS_HEADER;
  const text = (base.endsWith('\n') ? base : base + '\n') + newUrls.join('\n') + '\n';
  await ghPutFile(path, text, cur ? cur.sha : null, `相册 ${albumId} 新增 ${newUrls.length} 张照片 [管理台]`);
}

/* ---------- 相册列表 ---------- */
routes.gallery = async () => {
  view.innerHTML = '<div class="card"><h2>📷 加载中…</h2></div>';
  let albums;
  try { ({ albums } = await readAlbums()); }
  catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  view.innerHTML = `
    <div class="toolbar">
      <button class="btn" id="gal-new">＋ 新建相册</button>
      <span class="spacer"></span>
      <span class="hint">${GALLERY_CONFIG} · 照片存 R2（urls.txt）或仓库目录</span>
    </div>
    <div id="gal-list"></div>`;
  $('#gal-new').onclick = () => { location.hash = '#/gallery-new'; };
  const listEl = $('#gal-list');
  listEl.innerHTML = '<div class="card">正在读取各相册照片数…</div>';

  const photosArr = await Promise.all(albums.map((a) => loadAlbumPhotos(a.id).catch(() => null)));
  listEl.innerHTML = '';
  if (!albums.length) { listEl.innerHTML = '<div class="card">还没有相册，来建第一个吧 👆</div>'; return; }
  albums.forEach((a, i) => {
    const ph = photosArr[i] || { localImgs: [], remoteUrls: [], coverFile: null };
    const count = ph.localImgs.length + ph.remoteUrls.length;
    const cover = albumCoverPreview(a, ph);
    const row = document.createElement('div');
    row.className = 'list-item song gal-row';
    row.innerHTML = `
      ${cover ? `<img class="song-cover" loading="lazy" src="${esc(cover)}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="song-cover"></span>'}
      <div class="song-info">
        <div class="title">${esc(a.name)} ${a.hasPassword ? '<span class="meta">🔒 加密</span>' : ''}</div>
        <div class="meta">${esc(a.id)} · ${count} 张照片${a.date ? ' · ' + esc(a.date) : ''}</div>
        ${a.description ? `<div class="meta">${esc(a.description)}</div>` : ''}
      </div>
      <div class="gal-actions">
        <button class="btn btn-small btn-ghost" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-small btn-ghost" data-a="down" ${i === albums.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-small" data-a="open">管理照片</button>
        <button class="btn btn-small btn-ghost" data-a="edit">编辑信息</button>
        <button class="btn btn-small btn-danger" data-a="del">删除</button>
      </div>`;
    const swap = async (j) => {
      const ids = albums.map((x) => x.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { toast('排序保存中…'); await reorderAlbums(ids); toast('顺序已保存，重新构建后生效'); router(); }
      catch (e) { toast(e.message, true); }
    };
    row.querySelector('[data-a=up]').onclick = () => { if (i > 0) swap(i - 1); };
    row.querySelector('[data-a=down]').onclick = () => { if (i < albums.length - 1) swap(i + 1); };
    row.querySelector('[data-a=open]').onclick = () => { location.hash = '#/gallery-album/' + encodeURIComponent(a.id); };
    row.querySelector('[data-a=edit]').onclick = () => { location.hash = '#/gallery-edit/' + encodeURIComponent(a.id); };
    row.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm(`确定删除相册「${a.name}」？\n这会从配置移除，并删除 public/gallery/${a.id}/ 下所有文件（不可恢复）。`)) return;
      try {
        toast('删除中…');
        const ph2 = await loadAlbumPhotos(a.id);
        for (const f of ph2.files) await ghDelFile(`${GALLERY_DIR}/${a.id}/${f.name}`, f.sha, `删除相册文件 ${a.id}/${f.name} [管理台]`);
        await removeAlbum(a.id);
        toast('相册已删除');
        router();
      } catch (e) { toast(e.message, true); }
    };
    listEl.appendChild(row);
  });
};

/* ---------- 相册详情：照片管理 ---------- */
routes['gallery-album'] = async (id) => {
  view.innerHTML = '<div class="card"><h2>📷 加载中…</h2></div>';
  let album;
  try {
    const { albums } = await readAlbums();
    album = albums.find((a) => a.id === id);
    if (!album) throw new Error('找不到相册 ' + id);
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }

  async function render() {
    const ph = await loadAlbumPhotos(id);
    const grid = $('#gal-photos');
    grid.innerHTML = '';
    $('#gal-count').textContent = ph.localImgs.length + ph.remoteUrls.length;
    const addCell = (src, label, sub, onDel) => {
      const d = document.createElement('div');
      d.className = 'img-cell';
      d.innerHTML = `<img loading="lazy" src="${esc(src)}" alt="">
        <div class="url" title="${esc(sub)}">${esc(label)}</div>
        <div class="ops"><button class="mini-btn danger">删除</button></div>`;
      d.querySelector('button').onclick = onDel;
      grid.appendChild(d);
    };
    if (ph.coverFile) {
      addCell(repoRawUrl(`${GALLERY_DIR}/${id}/${ph.coverFile.name}`), '🖼 封面 ' + ph.coverFile.name, ph.coverFile.name, async () => {
        if (!confirm('确定删除封面文件？（将自动改用第一张照片做封面）')) return;
        try { await ghDelFile(`${GALLERY_DIR}/${id}/${ph.coverFile.name}`, ph.coverFile.sha, `删除相册封面 ${id} [管理台]`); toast('已删除'); render(); }
        catch (e) { toast(e.message, true); }
      });
    }
    ph.localImgs.forEach((f) => {
      addCell(repoRawUrl(`${GALLERY_DIR}/${id}/${f.name}`), '📁 ' + f.name, f.name, async () => {
        if (!confirm(`确定删除 ${f.name}？`)) return;
        try { await ghDelFile(`${GALLERY_DIR}/${id}/${f.name}`, f.sha, `删除相册照片 ${id}/${f.name} [管理台]`); toast('已删除'); render(); }
        catch (e) { toast(e.message, true); }
      });
    });
    ph.remoteUrls.forEach((u) => {
      addCell(u, '☁️ ' + u.replace(/^https?:\/\//, '').slice(0, 28) + '…', u, async () => {
        if (!confirm('确定从 urls.txt 移除这张照片？（R2 上的文件保留）')) return;
        try {
          const cur = await ghGetFile(`${GALLERY_DIR}/${id}/urls.txt`);
          const lines = cur.text.split('\n').filter((l) => l.trim() !== u);
          await ghPutFile(`${GALLERY_DIR}/${id}/urls.txt`, lines.join('\n'), cur.sha, `相册 ${id} 移除照片 [管理台]`);
          toast('已移除'); render();
        } catch (e) { toast(e.message, true); }
      });
    });
    if (!grid.children.length) grid.innerHTML = '<p class="hint">相册是空的，加几张照片吧 👇</p>';
  }

  view.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-ghost" id="gal-back">← 相册列表</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-ghost" id="gal-edit">✏️ 编辑信息</button>
    </div>
    <div class="card">
      <h2>📷 ${esc(album.name)} <span class="sub">${esc(album.id)} · 共 <span id="gal-count">…</span> 张</span></h2>
      ${album.description ? `<p class="hint">${esc(album.description)}</p>` : ''}
      <p class="hint">照片来源：R2 直链（追加到 urls.txt，推荐）或仓库目录文件。构建时两者合并展示，cover.* 优先做封面。</p>
      <div class="img-grid" id="gal-photos"></div>
      <div class="toolbar">
        <input type="file" id="gal-files" accept="image/*" multiple class="hidden">
        <button class="btn btn-small" id="gal-add">＋ 添加照片（传 R2 → urls.txt）</button>
        <span class="hint">多选图片，自动转 WebP</span>
      </div>
    </div>`;
  $('#gal-back').onclick = () => { location.hash = '#/gallery'; };
  $('#gal-edit').onclick = () => { location.hash = '#/gallery-edit/' + encodeURIComponent(id); };
  $('#gal-add').onclick = () => $('#gal-files').click();
  $('#gal-files').onchange = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    toast(`上传中（${files.length} 张）…`);
    try {
      const { urls } = await uploadImages(files, `admin/gallery/${id}`);
      await appendUrls(id, urls);
      toast(`已添加 ${urls.length} 张照片`);
      render();
    } catch (err) { toast(err.message, true); }
  };
  render().catch((e) => { $('#gal-photos').innerHTML = `<p class="hint">加载失败：${esc(e.message)}</p>`; });
};

/* ---------- 新建 / 编辑相册 ---------- */
function slugify(s) {
  const slug = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || ('album-' + Date.now().toString(36));
}
function albumFormHtml(a) {
  const tags = (a.tags || []).join(', ');
  return `
    <div class="row2">
      <div class="field"><label>相册 ID *（英文小写/数字/连字符，定后别改）</label><input type="text" id="af-id" value="${esc(a.id || '')}" placeholder="如 trip-2026"></div>
      <div class="field"><label>相册名称 *</label><input type="text" id="af-name" value="${esc(a.name || '')}" placeholder="如 香港三日游"></div>
    </div>
    <div class="field"><label>描述</label><textarea id="af-desc" rows="2">${esc(a.description || '')}</textarea></div>
    <div class="row2">
      <div class="field"><label>地点</label><input type="text" id="af-location" value="${esc(a.location || '')}"></div>
      <div class="field"><label>日期</label><input type="date" id="af-date" value="${esc(a.date || '')}"></div>
    </div>
    <div class="field"><label>标签（逗号分隔）</label><input type="text" id="af-tags" value="${esc(tags)}" placeholder="如 旅行, 香港"></div>
    <div class="row2">
      <div class="field"><label>访问密码（可选${a.hasPassword ? '，已设置' : ''}）</label><input type="text" id="af-pw" placeholder="${a.hasPassword ? '留空=保持不变' : '不填=公开相册'}"></div>
      <div class="field"><label>密码提示（可选）</label><input type="text" id="af-pwhint" value="${esc(a.passwordHint || '')}"></div>
    </div>
    ${a.hasPassword ? '<div class="field"><label class="checkline"><input type="checkbox" id="af-pw-clear"> 清除密码（变公开相册）</label></div>' : ''}`;
}
routes['gallery-new'] = async () => {
  let albums = [];
  try { ({ albums } = await readAlbums()); }
  catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  view.innerHTML = `
    <div class="toolbar"><button class="btn btn-ghost" id="af-back">← 相册列表</button></div>
    <div class="card"><h2>＋ 新建相册</h2>${albumFormHtml({ date: `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}` })}
      <button class="btn" id="af-save">💾 创建相册</button>
      <p class="hint">创建后会自动建好 public/gallery/&lt;id&gt;/ 目录与 urls.txt，然后去"管理照片"里加图。</p>
    </div>`;
  $('#af-back').onclick = () => { location.hash = '#/gallery'; };
  $('#af-name').oninput = (e) => { if (!$('#af-id').dataset.touched) $('#af-id').value = slugify(e.target.value); };
  $('#af-id').oninput = (e) => { e.target.dataset.touched = '1'; };
  $('#af-save').onclick = async () => {
    const id = $('#af-id').value.trim();
    const name = $('#af-name').value.trim();
    if (!/^[a-z0-9-]+$/.test(id)) { toast('ID 只能用英文小写、数字和连字符', true); return; }
    if (!name) { toast('请填写相册名称', true); return; }
    if (albums.some((a) => a.id === id)) { toast('这个 ID 已经存在了，换一个', true); return; }
    const album = {
      id, name,
      description: $('#af-desc').value.trim(),
      location: $('#af-location').value.trim(),
      date: $('#af-date').value,
      tags: $('#af-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      cover: '',
      password: $('#af-pw').value,
      passwordHint: $('#af-pwhint').value.trim(),
    };
    $('#af-save').disabled = true;
    try {
      await appendAlbum(album);
      await ghPutFile(`${GALLERY_DIR}/${id}/urls.txt`, URLS_HEADER, null, `新建相册目录 ${id} [管理台]`);
      toast('相册已创建');
      location.hash = '#/gallery-album/' + encodeURIComponent(id);
    } catch (e) { toast(e.message, true); $('#af-save').disabled = false; }
  };
};
routes['gallery-edit'] = async (id) => {
  let album;
  try {
    const { albums } = await readAlbums();
    album = albums.find((a) => a.id === id);
    if (!album) throw new Error('找不到相册 ' + id);
  } catch (e) { view.innerHTML = `<div class="card">加载失败：${esc(e.message)}</div>`; return; }
  view.innerHTML = `
    <div class="toolbar"><button class="btn btn-ghost" id="af-back">← 返回照片管理</button></div>
    <div class="card"><h2>✏️ 编辑相册信息 <span class="sub">${esc(album.id)}（ID 不可改）</span></h2>
      ${albumFormHtml(album)}
      <button class="btn" id="af-save">💾 保存</button>
      <p class="hint">密码框留空 = 保持原密码不变；勾选"清除密码"则变为公开相册。</p>
    </div>`;
  $('#af-back').onclick = () => { location.hash = '#/gallery-album/' + encodeURIComponent(id); };
  $('#af-id').disabled = true;
  $('#af-save').onclick = async () => {
    const name = $('#af-name').value.trim();
    if (!name) { toast('请填写相册名称', true); return; }
    const pwInput = $('#af-pw').value;
    const pwClear = $('#af-pw-clear') && $('#af-pw-clear').checked;
    const next = {
      ...album,
      name,
      description: $('#af-desc').value.trim(),
      location: $('#af-location').value.trim(),
      date: $('#af-date').value,
      tags: $('#af-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      passwordHint: $('#af-pwhint').value.trim(),
      password: pwClear ? '' : (pwInput ? pwInput : album.password),
    };
    $('#af-save').disabled = true;
    try {
      await replaceAlbum(id, next);
      toast('已保存');
      location.hash = '#/gallery-album/' + encodeURIComponent(id);
    } catch (e) { toast(e.message, true); $('#af-save').disabled = false; }
  };
};
