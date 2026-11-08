/* GET/POST /api/umami/* → 代理到 Umami 后端，解决浏览器跨域问题
 * 对应 VPS 上 nginx 的 /api/umami/ 反代，搬到 Pages 后由 Function 接管
 */
const UPSTREAM = 'https://umami.lanerc.me';

// 站点统计域名白名单（2026-11-08 站长定）：数据接口强制只拉自有入口流量，
// 外站蹭 website-id 的不计入。Umami 的 hostname 过滤只认精确名单、不认通配，
// 故按规则枚举：lanerc.me 及全部子域（即 *.lanerc.me）、localhost、
// 本站 Pages 域及预览子域、HK 机 IP（8880 历史流量）。与 scripts/fetch-umami-stats.py 同口径。
// 枚举结果在函数实例内缓存 1 小时；枚举失败时回退到现行入口的静态名单。
const FALLBACK_WL = 'lanerc.me,hk.lanerc.me,origin.lanerc.me,localhost,firefly-6sp.pages.dev,20.239.49.52';
let wlCache = { ts: 0, wl: '' };

function hostAllowed(h) {
  return (
    h === 'lanerc.me' || h.endsWith('.lanerc.me')
    || h === 'localhost'
    || h === 'firefly-6sp.pages.dev' || h.endsWith('.firefly-6sp.pages.dev')
    || h === '20.239.49.52'
  );
}

async function resolveWhitelist(request, websiteId) {
  if (wlCache.wl && Date.now() - wlCache.ts < 3600_000) return wlCache.wl;
  try {
    const headers = new Headers();
    for (const [k, v] of request.headers.entries()) {
      if (k.toLowerCase().startsWith('x-umami-')) headers.set(k, v);
    }
    const qs = new URLSearchParams({
      startAt: '1728000000000',
      endAt: String(Date.now()),
      type: 'hostname',
    });
    const res = await fetch(`${UPSTREAM}/api/websites/${websiteId}/metrics?${qs}`, { headers });
    if (res.ok) {
      const rows = await res.json();
      const wl = [...new Set((rows || []).map((r) => r.x).filter((h) => h && hostAllowed(h)))].sort().join(',');
      if (wl) {
        wlCache = { ts: Date.now(), wl };
        return wl;
      }
    }
  } catch { /* 枚举失败走静态名单 */ }
  return FALLBACK_WL;
}

export async function onRequest({ request, params }) {
  const segs = params.path || [];
  const url = new URL(request.url);
  // 注意：前端请求形如 /api/umami/api/share/...，segs 首段已是 "api"，此处不能再拼一层 /api
  const targetUrl = new URL(`${UPSTREAM}/${segs.join('/')}`);
  targetUrl.search = url.search;
  const dataMatch = segs.slice(1).join('/').match(/^websites\/([^/]+)\/(stats|pageviews|metrics)$/);
  if (dataMatch) {
    targetUrl.searchParams.set('hostname', await resolveWhitelist(request, dataMatch[1]));
  }
  const target = targetUrl.toString();

  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const kl = k.toLowerCase();
    if (kl.startsWith('x-umami-') || kl === 'content-type' || kl === 'accept') {
      headers.set(k, v);
    }
  }

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
}
