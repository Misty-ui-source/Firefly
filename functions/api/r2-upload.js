/* POST /api/r2-upload
 * 表单：dir（R2 目录）, files（多个文件）
 * 鉴权：Authorization: Bearer <GitHub OAuth token>，服务端校验 token 有效且能访问目标仓库
 * 环境变量：R2 bucket 绑定名为 R2_BUCKET；R2_PUBLIC_BASE（如 https://img.lanerc.me）
 *            GITHUB_OWNER, GITHUB_REPO（校验用）
 */
export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const ghToken = auth.replace(/^Bearer\s+/i, '');
    if (!ghToken) return Response.json({ error: '未登录' }, { status: 401 });

    // 校验 GitHub token：必须能读到目标仓库（有 public_repo 权限的本人 token 才行）
    const check = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${ghToken}` } }
    );
    if (!check.ok) return Response.json({ error: 'GitHub 鉴权失败' }, { status: 401 });

    const form = await request.formData();
    const dir = String(form.get('dir') || '').replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');
    if (!dir) return Response.json({ error: '缺少 R2 目录名' }, { status: 400 });
    // fixedName：固定文件名（不含目录），传了则覆盖同名文件，用于头像这类固定路径场景
    const fixedName = String(form.get('fixedName') || '').replace(/^\/+|\/+$/g, '').replace(/\.\./g, '').replace(/\//g, '');
    const files = form.getAll('files');
    if (!files.length) return Response.json({ error: '没有文件' }, { status: 400 });

    const urls = [];
    const stamp = Date.now().toString(36);
    for (const f of files) {
      if (typeof f === 'string') continue;
      const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = fixedName ? `${dir}/${fixedName}` : `${dir}/${stamp}-${safeName}`;
      await env.R2_BUCKET.put(key, f.stream(), {
        httpMetadata: { contentType: f.type || 'application/octet-stream' },
      });
      urls.push(`${env.R2_PUBLIC_BASE.replace(/\/+$/, '')}/${key}`);
    }
    return Response.json({ urls });
  } catch (e) {
    return Response.json({ error: '上传异常' }, { status: 500 });
  }
}
