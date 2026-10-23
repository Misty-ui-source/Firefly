/* GET/POST /api/umami/* → 代理到 Umami 后端，解决浏览器跨域问题
 * 对应 VPS 上 nginx 的 /api/umami/ 反代，搬到 Pages 后由 Function 接管
 */
const UPSTREAM = 'https://umami.lanerc.me';

export async function onRequest({ request, params }) {
  const segs = params.path || [];
  const url = new URL(request.url);
  // 注意：前端请求形如 /api/umami/api/share/...，segs 首段已是 "api"，此处不能再拼一层 /api
  const target = `${UPSTREAM}/${segs.join('/')}${url.search}`;

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
