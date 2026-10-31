/* POST /api/github-exchange
 * 用 OAuth code + PKCE verifier 换 GitHub access_token，
 * 或用 refresh_token 静默续期（grant_type=refresh_token）。
 * client_secret 只在服务端出现，绝不暴露给浏览器
 * 环境变量：GITHUB_CLIENT_ID_PAGES, GITHUB_CLIENT_SECRET_PAGES,
 *           GITHUB_CLIENT_ID_LANERC, GITHUB_CLIENT_SECRET_LANERC
 */
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { client_id } = body || {};
    if (!client_id) {
      return Response.json({ error: '缺少 client_id' }, { status: 400 });
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
    let payload;
    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) {
        return Response.json({ error: '缺少 refresh_token' }, { status: 400 });
      }
      payload = {
        client_id,
        client_secret,
        grant_type: 'refresh_token',
        refresh_token: body.refresh_token,
      };
    } else {
      if (!body.code || !body.code_verifier) {
        return Response.json({ error: '缺少 code 或 code_verifier' }, { status: 400 });
      }
      payload = {
        client_id,
        client_secret,
        code: body.code,
        code_verifier: body.code_verifier,
      };
    }
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error || !data.access_token) {
      return Response.json({ error: data.error_description || '换 token 失败' }, { status: 400 });
    }
    return Response.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_in: data.expires_in || null,
      refresh_token_expires_in: data.refresh_token_expires_in || null,
      scope: data.scope,
    });
  } catch (e) {
    return Response.json({ error: '服务端异常' }, { status: 500 });
  }
}
