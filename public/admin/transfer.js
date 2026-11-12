/* Alexander Console · 跨站搬文（二期）：灵感屋文章一键转投主站 / 旧站
 * 规则真源：《跨站搬文-字段映射表》（2026-11-12 站长六项拍板）。
 * 结构：上半是纯转换逻辑（不碰 DOM / 网络，node 可直接 require 干跑）；
 *       下半是浏览器 UI（弹窗 + 走现有 gh 读写层 ghCommitMulti / ghDelFile 执行）。
 * 纪律：写入目标仓走 ghCommitMulti 合成 1 个 commit；删原稿走现有 confirm + ghDelFile 逐文件删。
 */
(function () {
  'use strict';

  /* ================= 纯逻辑 ================= */

  /* 三站都没有或构建期生成的字段，一律不带 */
  const DROP_ALWAYS = ['wikiExclude', 'prevTitle', 'prevSlug', 'nextTitle', 'nextSlug'];
  /* 旧站 Fuwari schema 没有的字段（映射表第一节）：搬去旧站丢弃 */
  const DROP_FOR_FUWARI = ['pinned', 'author', 'sourceLink', 'licenseName', 'licenseUrl',
    'comment', 'password', 'passwordHint', 'archived', 'series', 'seriesOrder'];
  /* 输出 frontmatter 的固定字段顺序（照三站存量文章的常见排布） */
  const FM_ORDER = ['title', 'published', 'updated', 'description', 'image', 'tags', 'category',
    'draft', 'pinned', 'archived', 'series', 'seriesOrder', 'lang', 'author', 'sourceLink',
    'licenseName', 'licenseUrl', 'comment', 'passwordHint', 'password'];
  /* 分类对照初稿（映射表第四节）：灵感屋分类 → 主站默认值；旧站沿用原名 */
  const CATEGORY_TO_MAIN = {
    '学习文档': '教程',
    '实践笔记': '博客',
    '设计文档': '博客',
    '生活杂谈': '随笔',
    '部署文档': '教程',
  };
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'];
  const isImageName = (name) => IMAGE_EXTS.includes((name.split('.').pop() || '').toLowerCase());

  /* datetime → 纯日期 YYYY-MM-DD（截前 10 位；本就是纯日期的原样返回） */
  function toPureDate(v) {
    const m = String(v == null ? '' : v).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : v;
  }

  /* 检测正文里的 MDX 指令糖（mmz 底座语法，主站/旧站无此管线）：
   * - 容器指令 :::name{...} ... ::: （含无名的收尾 :::）
   * - 块级叶指令 ::name{...} / ::name（如 ::chat、::link-card）
   * - 行内叶指令 :name[文字] / :name{...}（如 :badge[必看]、:tip[术语]{tip="…"}）
   * 返回命中的指令名数组（去重）。 */
  function detectDirectives(body) {
    const found = [];
    const add = (n) => { if (n && !found.includes(n)) found.push(n); };
    const text = String(body || '');
    for (const line of text.split('\n')) {
      let m = line.match(/^\s*:::\s*([A-Za-z][\w-]*)?/);
      if (m) { add(m[1] || '(容器)'); continue; }
      m = line.match(/^\s*::\s*([A-Za-z][\w-]*)/);
      if (m) { add(m[1]); continue; }
    }
    const inline = /(?<![:\w/]):([A-Za-z][\w-]*)(\[[^\]]*\]|\{[^}\n]*\})/g;
    let im;
    while ((im = inline.exec(text)) !== null) add(im[1]);
    return found;
  }

  /* 指令糖近似转换（站长拍板：提示后执意搬则近似呈现）：
   * - 容器 :::name{...} 与收尾 ::: 只剥外壳行，内部 Markdown 原样保留；
   * - ::chat 块：:u/:a/:s 消息行转成引用行（> 内容），::chat 与收尾 :: 行去掉；
   * - 独占一行的叶指令（::link-card{...} 等渲染卡片、无 Markdown 等价物）整行去掉；
   * - 行内叶指令 :name[文字]{...} 只留 [文字] 的内容，:name{...} 直接去掉。 */
  function approximateDirectives(body) {
    const lines = String(body || '').split('\n');
    const out = [];
    let inChat = false;
    for (let raw of lines) {
      const line = raw;
      if (/^\s*:::\s*([A-Za-z][\w-]*)?/.test(line)) continue; // 容器外壳/收尾
      const chatOpen = line.match(/^\s*::\s*chat\b/);
      if (chatOpen) { inChat = true; continue; }
      if (inChat && /^\s*::\s*$/.test(line)) { inChat = false; continue; }
      if (/^\s*::\s*[A-Za-z][\w-]*/.test(line)) continue; // 其他块级叶指令整行去掉
      if (/^\s*::?[A-Za-z][\w-]*\{[^}]*\}\s*$/.test(line)) continue; // 独占一行的 :name{...}
      let s = line;
      if (inChat) {
        const msg = s.match(/^\s*:[uas](\{[^}]*\})?\s*(.*)$/);
        if (msg) { out.push('> ' + msg[2]); continue; }
      }
      s = s.replace(/:([A-Za-z][\w-]*)\[([^\]]*)\](\{[^}\n]*\})?/g, '$2');
      s = s.replace(/(?<![:\w/]):([A-Za-z][\w-]*)\{[^}\n]*\}/g, '');
      out.push(s);
    }
    return out.join('\n');
  }

  /* 正文首个非空行是 # 一级标题时去掉它（主站/灵感屋惯例不带正文 H1；旧站保留） */
  function stripLeadingH1(body) {
    const lines = String(body || '').split('\n');
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && /^#\s+/.test(lines[i])) {
      lines.splice(i, 1);
      while (i < lines.length && lines[i].trim() === '') lines.splice(i, 1);
    }
    return lines.join('\n');
  }

  /* ==高亮== 按目标站转换：灵感屋不支持 → 加粗；旧站 → <mark>；主站保留 */
  function convertHighlight(body, target) {
    const text = String(body || '');
    if (target === 'idea') return text.replace(/==([^=\n]+)==/g, '**$1**');
    if (target === 'fuwari') return text.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    return text;
  }

  /* 把正文里对某张图的引用从 ./X 改成 ./images/X（主站正文图进 images/ 子目录） */
  function rewriteImageRef(body, name) {
    let text = String(body || '');
    text = text.split(`](./${name})`).join(`](./images/${name})`);
    text = text.split(`](${name})`).join(`](./images/${name})`);
    text = text.split(`src="./${name}"`).join(`src="./images/${name}"`);
    text = text.split(`src="${name}"`).join(`src="./images/${name}"`);
    return text;
  }

  /* frontmatter 转换。fm 为 parseFrontmatter 的产物（值是字符串或字符串数组）。
   * opts: { target:'main'|'fuwari'|'idea', category, tags(数组), draft('true'|'false'),
   *         series, seriesOrder } —— category/tags/draft 由界面给定（含默认值）。 */
  function convertFrontmatter(fm, opts) {
    const target = opts.target;
    const drop = new Set(DROP_ALWAYS.concat(target === 'fuwari' ? DROP_FOR_FUWARI : []));
    const picked = {};
    const keys = Object.keys(fm || {});
    for (const k of keys) {
      if (drop.has(k)) continue;
      picked[k] = fm[k];
    }
    if (target === 'fuwari') {
      if (picked.published !== undefined) picked.published = toPureDate(picked.published);
      if (picked.updated !== undefined) picked.updated = toPureDate(picked.updated);
    }
    if (opts.category !== undefined) picked.category = opts.category;
    if (opts.tags !== undefined) picked.tags = opts.tags;
    if (opts.draft !== undefined) picked.draft = opts.draft;
    if (target === 'main') {
      if (picked.archived === undefined || picked.archived === '') picked.archived = 'false';
      if (opts.series) picked.series = opts.series; else delete picked.series;
      if (opts.series && opts.seriesOrder !== undefined && opts.seriesOrder !== '') picked.seriesOrder = String(opts.seriesOrder);
      else delete picked.seriesOrder;
    }
    /* 按固定顺序重排，其余字段（lang/author 等）跟在后面透传 */
    const out = {};
    for (const k of FM_ORDER) if (picked[k] !== undefined) out[k] = picked[k];
    for (const k of keys) if (picked[k] !== undefined && out[k] === undefined) out[k] = picked[k];
    return out;
  }

  /* 文件计划：源目录内相对路径 → 目标相对路径。
   * files: ['index.md', 'cover.webp', 'shot.png', ...]（可含 images/ 前缀的相对路径）
   * coverName: fm.image 指向的封面文件名（留根目录）；md 文件保持原名。 */
  function planFiles(files, target, coverName) {
    return (files || []).map((rel) => {
      const name = rel.split('/').pop();
      if (/\.mdx?$/i.test(name)) return { from: rel, to: rel, kind: 'md' };
      if (coverName && name === coverName) return { from: rel, to: name, kind: 'cover' };
      if (isImageName(name)) {
        if (target === 'main' && !rel.startsWith('images/')) return { from: rel, to: 'images/' + name, kind: 'image' };
        return { from: rel, to: rel, kind: 'image' };
      }
      return { from: rel, to: rel, kind: 'other' };
    });
  }

  /* 一次转投的完整纯转换（UI 与干跑共用）。
   * input: { fm, body, files:[相对路径] }
   * opts: 同 convertFrontmatter，外加 approxDirectives(是否已确认近似转换)
   * 返回 { fm, body, plan, warnings:{ directives:[], hasPassword } } */
  function convertTransfer(input, opts) {
    const fm = input.fm || {};
    const target = opts.target;
    const coverName = fm.image ? String(fm.image).split('/').pop() : '';
    const directives = detectDirectives(input.body);
    let body = String(input.body || '');
    if (directives.length && opts.approxDirectives) body = approximateDirectives(body);
    if (target !== 'fuwari') body = stripLeadingH1(body);
    body = convertHighlight(body, target);
    const plan = planFiles(input.files, target, coverName);
    if (target === 'main') {
      for (const p of plan) {
        if (p.kind === 'image' && p.from !== p.to) body = rewriteImageRef(body, p.from.split('/').pop());
      }
    }
    return {
      fm: convertFrontmatter(fm, opts),
      body,
      plan,
      warnings: {
        directives,
        hasPassword: !!(fm.password && String(fm.password).trim() !== ''),
      },
    };
  }

  /* 定稿文本修正：seriesOrder 是三站里唯一的 number 型字段（主站 schema z.number()），
   * 而 serializeFrontmatter 会给纯数字字符串加引号——写出前把这一行的引号去掉，
   * 否则目标站构建会因类型不符报错。 */
  function finalizeText(text, fmOut) {
    const t = String(text);
    if (fmOut && fmOut.seriesOrder !== undefined && /^\d+$/.test(String(fmOut.seriesOrder))) {
      return t.replace(/^seriesOrder: "\d+"$/m, `seriesOrder: ${fmOut.seriesOrder}`);
    }
    return t;
  }

  const TransferCore = {
    DROP_ALWAYS, DROP_FOR_FUWARI, CATEGORY_TO_MAIN,
    toPureDate, detectDirectives, approximateDirectives,
    stripLeadingH1, convertHighlight, rewriteImageRef,
    convertFrontmatter, planFiles, convertTransfer, finalizeText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TransferCore;
  if (typeof window === 'undefined') return;
  window.TransferCore = TransferCore;

  /* ================= 浏览器 UI ================= */

  /* 目标站坐标：主站取 BASE_CFG（applySite 前的顶层配置快照），旧站取 config 里
   * transferOnly 的 sites 条目。posts 集合路径主站/旧站同为 src/content/posts。 */
  function targetDef(id) {
    const sites = Array.isArray(CFG.sites) ? CFG.sites : [];
    if (id === 'main') {
      return { id: 'main', label: '🏠 主站', owner: BASE_CFG.owner, repo: BASE_CFG.repo, branch: BASE_CFG.branch, postsPath: (BASE_CFG.collections.posts || {}).path || 'src/content/posts' };
    }
    const s = sites.find((x) => x.id === id);
    if (!s) return null;
    return { id: s.id, label: s.label || s.id, owner: s.owner, repo: s.repo, branch: s.branch, postsPath: ((s.collections || {}).posts || {}).path || 'src/content/posts' };
  }
  const sourceRepo = () => ({ owner: CFG.owner, repo: CFG.repo, branch: CFG.branch });
  const targetPath = (t, p) => `/repos/${t.owner}/${t.repo}/contents/${p}?ref=${t.branch}`;

  /* 递归列出源文章目录的全部文件（相对路径 + sha） */
  async function listSourceFiles(colPath, dirName) {
    const out = [];
    const walk = async (rel) => {
      const entries = await ghGetFile(rel ? `${colPath}/${dirName}/${rel}` : `${colPath}/${dirName}`);
      if (!Array.isArray(entries)) return;
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.type === 'dir') await walk(r);
        else out.push({ rel: r, name: e.name, sha: e.sha });
      }
    };
    await walk('');
    return out;
  }

  window.openTransfer = async function openTransfer(key, dirName) {
    const col = CFG.collections[key];
    if (!col || SITE_ID !== 'idea') return;
    const { body, close } = bigModal('📤 转投文章', `${col.path}/${dirName}`);
    body.innerHTML = '<p class="hint">读取源文章中…</p>';
    let src;
    try {
      const files = await listSourceFiles(col.path, dirName);
      const mdFile = files.find((f) => /\.mdx?$/i.test(f.name) && !f.rel.includes('/'));
      if (!mdFile) throw new Error('源目录里没有 md 文件');
      const data = await ghGetFile(`${col.path}/${dirName}/${mdFile.rel}`);
      const parsed = parseFrontmatter(data.text);
      src = { files, mdFile, fm: parsed.fm, body: parsed.body };
    } catch (e) {
      body.innerHTML = `<p class="hint">读取失败：${esc(e.message)}</p>`;
      return;
    }

    const mainT = targetDef('main');
    const fuwariT = targetDef('archive');
    const targets = [mainT, fuwariT].filter(Boolean);
    if (!targets.length) { body.innerHTML = '<p class="hint">没有可用的转投目标（config 未登记）。</p>'; return; }
    const directives = detectDirectives(src.body);
    const hasPw = !!(src.fm.password && String(src.fm.password).trim() !== '');

    body.innerHTML = `
      <div class="field"><label>目标站点</label>
        <div class="pills" id="tr-targets">
          ${targets.map((t, i) => `<label class="pill${i === 0 ? ' on' : ''}"><input type="radio" name="tr-target" value="${t.id}"${i === 0 ? ' checked' : ''}>${esc(t.label)}（${esc(t.repo)}）</label>`).join('')}
        </div></div>
      <div class="grid2">
        <div class="field"><label>目标目录名（slug）</label><input type="text" id="tr-slug" value="${esc(dirName)}"></div>
        <div class="field"><label>投放状态</label><select id="tr-draft">
          <option value="false">正式发布（draft: false）</option>
          <option value="true">存为草稿（draft: true）</option>
        </select></div>
      </div>
      <div class="field"><label>分类（按目标站词表，可改）</label><input type="text" id="tr-category" value=""></div>
      <div class="field"><label>标签（逗号分隔，可按目标站词表增删）</label><input type="text" id="tr-tags" value="${esc(Array.isArray(src.fm.tags) ? src.fm.tags.join(', ') : (src.fm.tags || ''))}"></div>
      <div id="tr-series-zone">
        <div class="grid2">
          <div class="field"><label>系列（选填，仅主站）</label><input type="text" id="tr-series" placeholder="留空 = 不挂系列"></div>
          <div class="field"><label>系列内排序（选填）</label><input type="number" id="tr-series-order" placeholder="数字，越小越靠前"></div>
        </div>
      </div>
      ${directives.length ? `<div class="field" id="tr-dir-warn">
        <p class="hint" style="color:#d97706">⚠ 正文用了 MDX 指令糖（${esc(directives.join('、'))}），目标站没有这套渲染管线，原样搬过去会露出指令原文。</p>
        <label class="pill"><input type="checkbox" id="tr-dir-ok"> 已知晓，仍要转投（自动转成普通 Markdown 近似呈现）</label></div>` : ''}
      <div class="field hidden" id="tr-pw-warn">
        <p style="color:#dc2626;font-weight:700">⚠ 这篇文章设有访问密码。旧站没有 password 字段，转投过去密码会被丢弃、文章将变公开。</p>
        <label class="pill"><input type="checkbox" id="tr-pw-ok"> 已知晓，仍要转投旧站</label></div>
      <p class="hint" id="tr-note"></p>
      <div class="modal-ops">
        <button class="btn btn-ghost" id="tr-cancel" type="button">取消</button>
        <button class="btn" id="tr-go" type="button">执行转投</button>
      </div>
      <div id="tr-result"></div>`;

    const $q = (s) => body.querySelector(s);
    const curTarget = () => targets.find((t) => t.id === body.querySelector('input[name="tr-target"]:checked').value);
    const paintTarget = () => {
      const t = curTarget();
      const cat = $q('#tr-category');
      if (t.id === 'main') cat.value = CATEGORY_TO_MAIN[String(src.fm.category || '')] || String(src.fm.category || '');
      else cat.value = String(src.fm.category || ''); // 旧站沿用原名
      $q('#tr-series-zone').classList.toggle('hidden', t.id !== 'main');
      $q('#tr-pw-warn').classList.toggle('hidden', !(t.id === 'archive' && hasPw));
      $q('#tr-note').textContent = t.id === 'archive'
        ? '转旧站：丢弃旧站没有的 8 个字段，日期转纯日期，==高亮== 转 <mark>，图片平铺不变，文件名保留 index.md。'
        : '转主站：字段几全直传，正文图片移入 images/ 子目录并改引用，封面留根目录，==高亮== 保留。';
    };
    body.querySelectorAll('input[name="tr-target"]').forEach((r) => {
      r.onchange = () => {
        body.querySelectorAll('#tr-targets .pill').forEach((p) => p.classList.toggle('on', p.contains(r) && r.checked));
        paintTarget();
      };
    });
    paintTarget();
    $q('#tr-cancel').onclick = close;

    $q('#tr-go').onclick = async () => {
      const t = curTarget();
      const coreTarget = t.id === 'archive' ? 'fuwari' : 'main';
      if (directives.length && !$q('#tr-dir-ok').checked) { toast('正文有指令糖，请先勾选「已知晓」再转投', true); return; }
      if (coreTarget === 'fuwari' && hasPw && !$q('#tr-pw-ok').checked) { toast('加密文章转旧站会变公开，请先勾选红字确认', true); return; }
      const slug0 = $q('#tr-slug').value.trim();
      if (!slug0) { toast('请填目标目录名', true); return; }
      const btn = $q('#tr-go');
      btn.disabled = true;
      try {
        /* 1) 转换（纯逻辑） */
        const conv = convertTransfer(
          { fm: src.fm, body: src.body, files: src.files.map((f) => f.rel) },
          {
            target: coreTarget,
            category: $q('#tr-category').value.trim(),
            tags: $q('#tr-tags').value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
            draft: $q('#tr-draft').value,
            series: $q('#tr-series') ? $q('#tr-series').value.trim() : '',
            seriesOrder: $q('#tr-series-order') ? $q('#tr-series-order').value : '',
            approxDirectives: directives.length > 0,
          });
        const newText = finalizeText(serializeFrontmatter(conv.fm, conv.body), conv.fm);

        /* 2) 目标仓撞名检查：同编辑器口径顺延 (1)(2)… */
        let slug = slug0;
        for (let n = 1; n <= 50; n++) {
          let exists = false;
          try { const cur = await gh(targetPath(t, `${t.postsPath}/${slug}`)); exists = Array.isArray(cur); } catch (e) {}
          if (!exists) break;
          slug = `${slug0}(${n})`;
        }
        if (slug !== slug0) toast(`目标站已有同名目录，自动改名为 ${slug}`);

        /* 3) 组装文件：md 用转换后文本，其余文件取源仓 base64 原样搬 */
        const files = [];
        for (const p of conv.plan) {
          if (p.kind === 'md') {
            files.push({ path: `${t.postsPath}/${slug}/${p.to}`, content: newText, encoding: 'utf-8' });
          } else {
            const raw = await gh(repoPath(`${col.path}/${dirName}/${p.from}`));
            files.push({ path: `${t.postsPath}/${slug}/${p.to}`, content: String(raw.content || '').replace(/\n/g, ''), encoding: 'base64' });
          }
        }
        const r = await ghCommitMulti(files, `转投文章 ${slug}（自灵感屋 ${dirName}）[管理台]`, { owner: t.owner, repo: t.repo, branch: t.branch });

        /* 4) 回读验仓：目标 md 内容与转换结果一致才算成功 */
        const mdPlan = conv.plan.find((p) => p.kind === 'md');
        const back = await gh(targetPath(t, `${t.postsPath}/${slug}/${mdPlan.to}`));
        const backText = b64decodeUnicode(String(back.content || '').replace(/\n/g, ''));
        if (backText !== newText) throw new Error('目标仓回读内容不一致，已中止（原稿未动）');

        try { oplogRecord('文章', '转投', dirName, `转投到${t.label} ${slug}`); } catch (e) {}
        $q('#tr-result').innerHTML = `
          <p class="hint" style="margin-top:10px">✅ 已转投到 ${esc(t.label)}：${esc(t.postsPath)}/${esc(slug)}/（commit ${esc(String(r.commitSha).slice(0, 7))}）</p>
          <div class="modal-ops">
            <button class="btn" id="tr-keep" type="button">保留原稿，完成</button>
            <button class="btn btn-danger" id="tr-del" type="button">删除灵感屋原稿</button>
          </div>`;
        btn.classList.add('hidden');
        $q('#tr-keep').onclick = () => { close(); toast('转投完成，原稿已保留'); router(); };
        $q('#tr-del').onclick = async () => {
          if (!confirm(`确定删除灵感屋原稿「${dirName}」的全部 ${src.files.length} 个文件？删了只能从 git 历史找回。`)) return;
          const delBtn = $q('#tr-del');
          delBtn.disabled = true;
          try {
            for (const f of src.files) {
              await ghDelFile(`${col.path}/${dirName}/${f.rel}`, f.sha, `转投后删除原稿 ${dirName}/${f.rel} [管理台]`);
            }
            try { oplogRecord('文章', '转投删原稿', dirName, `已转投到${t.label} ${slug}`); } catch (e) {}
            close();
            toast('转投完成，原稿已删除');
            router();
          } catch (err) {
            toast('删原稿失败（转投本身已成功）：' + err.message, true);
            delBtn.disabled = false;
          }
        };
      } catch (err) {
        toast('转投失败：' + err.message, true);
        btn.disabled = false;
      }
    };
  };
})();
