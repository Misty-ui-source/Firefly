/* POST /api/r2-delete
 * 删除 R2 中的对象。body: { keys: [...] }
 * 鉴权：Authorization: Bearer <GitHub OAuth token>（与 r2-upload 同规则）
 */
export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const ghToken = auth.replace(/^Bearer\s+/i, '');
    if (!ghToken) return Response.json({ error: '未登录' }, { status: 401 });

    const check = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'AlexanderConsole' } }
    );
    if (!check.ok) return Response.json({ error: '鉴权失败' }, { status: 401 });

    const { keys } = await request.json();
    if (!Array.isArray(keys) || !keys.length) return Response.json({ error: '没有指定文件' }, { status: 400 });
    // 安全：只允许删除 videos/ 下的文件
    const safe = keys.filter((k) => typeof k === 'string' && k.startsWith('videos/') && !k.includes('..'));
    await Promise.all(safe.map((k) => env.R2_BUCKET.delete(k)));
    return Response.json({ deleted: safe.length });
  } catch (e) {
    return Response.json({ error: e.message || '未知错误' }, { status: 500 });
  }
}
