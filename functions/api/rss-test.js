/* GET /api/rss-test?url=<rss地址>
 * 测试 RSS/Atom 订阅是否有效，返回文章数与最新几篇标题。
 * 鉴权：Authorization: Bearer <GitHub OAuth token>（与 r2-upload 同规则）
 * 设计：只做探测，不抛错；单个源失效绝不影响构建（构建脚本另有兜底）。
 */
export async function onRequestGet({ request, env }) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const ghToken = auth.replace(/^Bearer\s+/i, '');
    if (!ghToken) return Response.json({ ok: false, error: '未登录' }, { status: 401 });

    const url = new URL(request.url).searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(url)) return Response.json({ ok: false, error: '地址格式不对' });

    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'AlexanderConsole/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      return Response.json({ ok: false, error: '抓取失败：' + (e.message || '网络错误') });
    }
    if (!res.ok) return Response.json({ ok: false, error: `HTTP ${res.status}` });
    const xml = await res.text();

    // 粗解析：数 <item> / <entry>，取前 3 个标题
    const items = xml.match(/<(item|entry)[\s>]/g) || [];
    const titles = [];
    const re = /<(item|entry)[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/g;
    let m;
    while ((m = re.exec(xml)) && titles.length < 3) {
      let t = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
      if (t) titles.push(t.slice(0, 60));
    }
    if (!items.length) return Response.json({ ok: false, error: '抓到了但不是有效的 RSS/Atom（没找到文章条目）' });
    return Response.json({ ok: true, count: items.length, titles });
  } catch (e) {
    return Response.json({ ok: false, error: e.message || '未知错误' });
  }
}
