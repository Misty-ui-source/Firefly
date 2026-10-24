/* Alexander 管理台：评论管理（comments.js，在 gallery.js 之后加载）
 * 原理：Waline 是独立服务（waline.lanerc.me），评论存它自己的 MongoDB，
 * 管理员账号也是它数据库里的记录，与 GitHub 账号无关（GitHub 只在部署时拉代码构建）。
 * 官方后台就是个调它 API 的网页；本页做同样的事，界面换成手机友好的：
 * 用 Waline 管理员邮箱+密码向 /api/token 换令牌（密码只发给 Waline、不存储），
 * 令牌存本机 localStorage（与官方后台同做法），之后列表/审核/删除/回复都带令牌调 API。 */
'use strict';

const WALINE_BASE = 'https://waline.lanerc.me';
const WL_TOKEN_KEY = 'waline-admin-token';
const WL_EMAIL_KEY = 'waline-admin-email';
const wlToken = () => { try { return localStorage.getItem(WL_TOKEN_KEY) || ''; } catch (e) { return ''; } };

async function walineFetch(path, opts = {}) {
  const res = await fetch(WALINE_BASE + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(wlToken() ? { Authorization: `Bearer ${wlToken()}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || j.errno === 401) {
    try { localStorage.removeItem(WL_TOKEN_KEY); } catch (e) {}
    throw new Error('Waline 登录已过期，请重新登录');
  }
  if (j.errno) throw new Error(j.errmsg || `Waline 接口错误 ${j.errno}`);
  return j.data;
}

/* 评论管理样式（自带一小块，避免动 style.css） */
function wlEnsureStyle() {
  if (document.getElementById('wl-style')) return;
  const s = document.createElement('style');
  s.id = 'wl-style';
  s.textContent = `
    .wl-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
    .wl-tabs .btn.on{background:var(--accent,#c0392b);color:#fff}
    .wl-head{display:flex;gap:10px;align-items:center}
    .wl-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none;background:#ddd}
    .wl-nick{font-weight:700}
    .wl-badge{font-size:11px;padding:1px 6px;border-radius:99px;background:#fde68a;color:#92400e;margin-left:6px}
    .wl-badge.admin{background:#fecaca;color:#991b1b}
    .wl-meta{font-size:12px;opacity:.7;word-break:break-all}
    .wl-content{margin:8px 0;word-break:break-word;line-height:1.6}
    .wl-content img{max-width:100%}
    .wl-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .wl-search{display:flex;gap:6px;margin:10px 0}
    .wl-search input{flex:1}
    .wl-reply{margin-top:8px}
    .wl-status{font-size:11px;padding:1px 6px;border-radius:99px;background:#e5e7eb}
    .wl-status.waiting{background:#fde68a;color:#92400e}
    .wl-status.spam{background:#fecaca;color:#991b1b}
    .wl-status.approved{background:#bbf7d0;color:#065f46}`;
  document.head.appendChild(s);
}

routes['waline'] = async () => {
  wlEnsureStyle();
  if (!wlToken()) {
    const lastEmail = (() => { try { return localStorage.getItem(WL_EMAIL_KEY) || ''; } catch (e) { return ''; } })();
    view.innerHTML = `
    <div class="card"><h2>💬 评论管理 <span class="sub">Waline</span></h2>
      <p class="hint">用你的 Waline 管理员账号登录一次即可。密码只发给 waline.lanerc.me 换取令牌、不会存储；令牌存本机，之后打开直接进列表。评论数据在 Waline 自己的数据库里，跟 GitHub 账号无关。</p>
      <div class="field"><label>管理员邮箱</label><input type="email" id="wl-email" value="${esc(lastEmail || '2829247825@qq.com')}" autocomplete="username"></div>
      <div class="field"><label>密码</label><input type="password" id="wl-pass" autocomplete="current-password" placeholder="Waline 管理员密码"></div>
      <button class="btn" id="wl-login">登录</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost" id="wl-official" type="button">官方后台（电脑版）↗</button>
    </div>`;
    $('#wl-official').onclick = () => window.open(WALINE_BASE + '/ui', '_blank', 'noopener');
    const doLogin = async () => {
      const email = $('#wl-email').value.trim();
      const password = $('#wl-pass').value;
      if (!email || !password) { toast('邮箱和密码都要填', true); return; }
      const btn = $('#wl-login'); btn.disabled = true;
      try {
        const data = await walineFetch('/api/token', { method: 'POST', body: { email, password } });
        if (!data || !data.token) throw new Error('登录失败：没拿到令牌');
        try { localStorage.setItem(WL_TOKEN_KEY, data.token); localStorage.setItem(WL_EMAIL_KEY, email); } catch (e) {}
        toast(`欢迎回来，${data.display_name || email}`);
        router();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
    $('#wl-login').onclick = doLogin;
    $('#wl-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    return;
  }

  /* ---------- 已登录：评论列表 ---------- */
  let status = '';        // '' 全部 | waiting | approved | spam
  let keyword = '';
  let page = 1, totalPages = 1;

  view.innerHTML = `
  <div class="toolbar">
    <button class="btn btn-ghost" id="wl-official2" type="button">官方后台 ↗</button>
    <span class="spacer"></span>
    <button class="btn btn-ghost" id="wl-logout" type="button">退出 Waline</button>
  </div>
  <div class="card"><h2>💬 评论管理 <span class="sub" id="wl-count"></span></h2>
    <div class="wl-tabs" id="wl-tabs">
      <button class="btn btn-small on" data-s="">全部</button>
      <button class="btn btn-small" data-s="waiting">待审核</button>
      <button class="btn btn-small" data-s="approved">已通过</button>
      <button class="btn btn-small" data-s="spam">垃圾</button>
    </div>
    <div class="wl-search">
      <input type="text" id="wl-kw" placeholder="搜内容/昵称/邮箱">
      <button class="btn btn-small" id="wl-search-btn" type="button">搜索</button>
      <button class="btn btn-small btn-ghost" id="wl-refresh" type="button">↻ 刷新</button>
    </div>
    <div id="wl-list"><p class="hint">加载中…</p></div>
    <div class="toolbar"><span class="spacer"></span><button class="btn btn-small hidden" id="wl-more" type="button">加载更多</button><span class="spacer"></span></div>
  </div>`;
  $('#wl-official2').onclick = () => window.open(WALINE_BASE + '/ui', '_blank', 'noopener');
  $('#wl-logout').onclick = () => { try { localStorage.removeItem(WL_TOKEN_KEY); } catch (e) {} toast('已退出 Waline'); router(); };

  const listEl = $('#wl-list');
  const fmtTime = (v) => { try { return new Date(v).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return v || ''; } };
  const statusChip = (c) => {
    const map = { waiting: '待审核', approved: '已通过', spam: '垃圾' };
    return `<span class="wl-status ${esc(c.status || 'approved')}">${map[c.status] || c.status || '已通过'}</span>${c.sticky ? ' <span class="wl-badge">置顶</span>' : ''}`;
  };

  function cardHtml(c) {
    const pageUrl = 'https://lanerc.me' + (c.url || '');
    const avatar = c.avatar ? `<img class="wl-avatar" src="${esc(c.avatar)}" alt="" loading="lazy">` : '';
    return `<div class="card" data-oid="${esc(c.objectId)}">
      <div class="wl-head">${avatar}<div>
        <span class="wl-nick">${esc(c.nick || '匿名')}</span>${c.type === 'administrator' ? '<span class="wl-badge admin">博主</span>' : ''}
        <div class="wl-meta">${fmtTime(c.insertedAt)} · ${statusChip(c)}</div>
      </div></div>
      <div class="wl-content">${c.comment || ''}</div>
      <div class="wl-meta">页面：<a href="${esc(pageUrl)}" target="_blank" rel="noopener">${esc(c.url || '')}</a>${c.mail ? ` · ${esc(c.mail)}` : ''}${c.ip ? ` · IP ${esc(c.ip)}` : ''}</div>
      <div class="wl-actions">
        ${c.status !== 'approved' ? '<button class="btn btn-small" data-a="approve">通过</button>' : ''}
        ${c.status !== 'waiting' ? '<button class="btn btn-small" data-a="waiting">待审核</button>' : ''}
        ${c.status !== 'spam' ? '<button class="btn btn-small" data-a="spam">垃圾</button>' : ''}
        <button class="btn btn-small" data-a="sticky">${c.sticky ? '取消置顶' : '置顶'}</button>
        <button class="btn btn-small" data-a="reply">回复</button>
        <button class="btn btn-small btn-danger" data-a="del">删除</button>
      </div>
      <div class="wl-reply hidden">
        <div class="field"><textarea rows="3" placeholder="以博主身份回复 ${esc(c.nick || '')}…"></textarea></div>
        <button class="btn btn-small" data-a="send-reply">发送回复</button>
      </div>
    </div>`;
  }

  function wireCard(el, c) {
    const act = async (fn, okMsg) => {
      try { await fn(); toast(okMsg); load(true); }
      catch (e) { toast(e.message, true); }
    };
    el.querySelector('[data-a=approve]') && (el.querySelector('[data-a=approve]').onclick = () => act(() => walineFetch(`/api/comment/${c.objectId}`, { method: 'PUT', body: { status: 'approved' } }), '已通过'));
    el.querySelector('[data-a=waiting]') && (el.querySelector('[data-a=waiting]').onclick = () => act(() => walineFetch(`/api/comment/${c.objectId}`, { method: 'PUT', body: { status: 'waiting' } }), '已移到待审核'));
    el.querySelector('[data-a=spam]') && (el.querySelector('[data-a=spam]').onclick = () => act(() => walineFetch(`/api/comment/${c.objectId}`, { method: 'PUT', body: { status: 'spam' } }), '已标为垃圾'));
    el.querySelector('[data-a=sticky]').onclick = () => act(() => walineFetch(`/api/comment/${c.objectId}`, { method: 'PUT', body: { sticky: !c.sticky } }), c.sticky ? '已取消置顶' : '已置顶');
    el.querySelector('[data-a=del]').onclick = () => {
      if (!confirm(`删除「${c.nick || '匿名'}」的这条评论？删了不能恢复。`)) return;
      act(() => walineFetch(`/api/comment/${c.objectId}`, { method: 'DELETE' }), '已删除');
    };
    const replyBox = el.querySelector('.wl-reply');
    el.querySelector('[data-a=reply]').onclick = () => { replyBox.classList.toggle('hidden'); const ta = replyBox.querySelector('textarea'); if (ta) ta.focus(); };
    el.querySelector('[data-a=send-reply]').onclick = () => {
      const ta = replyBox.querySelector('textarea');
      const text = ta.value.trim();
      if (!text) { toast('回复内容不能为空', true); return; }
      act(() => walineFetch('/api/comment', { method: 'POST', body: { url: c.url, comment: text, pid: c.objectId, rid: c.rid || c.objectId, at: c.nick || '' } }), '已回复');
    };
  }

  async function load(reset) {
    if (reset) { page = 1; listEl.innerHTML = '<p class="hint">加载中…</p>'; }
    try {
      const qs = `type=list&pageSize=20&page=${page}${status ? `&status=${status}` : ''}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`;
      const data = await walineFetch(`/api/comment?${qs}`);
      totalPages = data.totalPages || 1;
      $('#wl-count').textContent = `共 ${data.count ?? ''} 条`;
      const rows = data.data || [];
      if (reset) listEl.innerHTML = rows.length ? '' : '<p class="hint">这个分类下还没有评论。</p>';
      rows.forEach((c) => {
        const div = document.createElement('div');
        div.innerHTML = cardHtml(c);
        const card = div.firstElementChild;
        listEl.appendChild(card);
        wireCard(card, c);
      });
      $('#wl-more').classList.toggle('hidden', page >= totalPages);
    } catch (e) {
      if (reset) listEl.innerHTML = `<p class="hint">加载失败：${esc(e.message)}</p>`;
      toast(e.message, true);
      if (/过期/.test(e.message)) router();
    }
  }
  $('#wl-more').onclick = () => { page++; load(false); };
  $('#wl-tabs').querySelectorAll('[data-s]').forEach((b) => {
    b.onclick = () => {
      status = b.dataset.s;
      $('#wl-tabs').querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
      load(true);
    };
  });
  const doSearch = () => { keyword = $('#wl-kw').value.trim(); load(true); };
  $('#wl-search-btn').onclick = doSearch;
  $('#wl-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('#wl-refresh').onclick = () => load(true);
  load(true);
};
