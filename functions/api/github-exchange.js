/* POST /api/github-exchange
 * 用 OAuth code + PKCE verifier 换 GitHub access_token
 * client_secret 只在服务端出现，绝不暴露给浏览器
 * 环境变量：GITHUB_CLIENT_ID_PAGES, GITHUB_CLIENT_SECRET_PAGES,
 *           GITHUB_CLIENT_ID_LANERC, GITHUB_CLIENT_SECRET_LANERC
 */
export async function onRequestPost({ request, env }) {
  try {
    const { code, code_verifier, client_id } = await request.json();
    if (!code || !code_verifier || !client_id) {
      return Response.json({ error: '缺少 code、code_verifier 或 client_id' }, { status: 400 });
    }
    // 按 client_id 选对应的 secret
    const secretMap = {
      [env.GITHUB_CLIENT_ID_PAGES]: env.GITHUB_CLIENT_SECRET_PAGES,
      [env.GITHUB_CLIENT_ID_LANERC]: env.GITHUB_CLIENT_SECRET_LANERC,
    };
    const client_secret = secretMap[client_id];
    if (!client_secret) {
      return Response.json({ error: '未知的 client_id' }, { status: 400 });
    }
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id,
        client_secret,
        code,
        code_verifier,
      }),
    });
    const data = await res.json();
    if (data.error || !data.access_token) {
      return Response.json({ error: data.error_description || '换 token 失败' }, { status: 400 });
    }
    return Response.json({ access_token: data.access_token, scope: data.scope });
  } catch (e) {
    return Response.json({ error: '服务端异常' }, { status: 500 });
  }
}
