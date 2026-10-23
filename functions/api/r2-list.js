/* GET /api/r2-list?prefix=<前缀>&limit=<数量>
 * 列出 R2 存储桶中的对象（用于控制台视频/文件管理）。
 * 鉴权：Authorization: Bearer <GitHub OAuth token>（与 r2-upload 同规则）
 */
export async function onRequestGet({ request, env }) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const ghToken = auth.replace(/^Bearer\s+/i, '');
    if (!ghToken) return Response.json({ error: '未登录' }, { status: 401 });

    // 校验 GitHub token（与 r2-upload 一致）
    const check = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'AlexanderConsole' } }
    );
    if (!check.ok) return Response.json({ error: '鉴权失败' }, { status: 401 });

    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);
    const cursor = url.searchParams.get('cursor') || undefined;

    const listed = await env.R2_BUCKET.list({ prefix, limit, cursor });
    const base = (env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');
    const objects = (listed.objects || []).map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
      url: base ? `${base}/${o.key}` : '',
    }));
    return Response.json({ objects, truncated: listed.truncated, cursor: listed.truncated ? listed.cursor : null });
  } catch (e) {
    return Response.json({ error: e.message || '未知错误' }, { status: 500 });
  }
}
