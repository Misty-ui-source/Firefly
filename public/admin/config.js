/* 管理台配置：按自己情况改这里即可 */
window.ADMIN_CONFIG = {
  // GitHub 仓库
  owner: 'Misty-ui-source',
  repo: 'Firefly',
  branch: 'main',

  // GitHub OAuth App 的 Client ID（在 github.com/settings/developers 新建 OAuth App 后填入）
  // 回调地址填：https://你的域名/admin/
  githubClientId: 'Ov23lizGLBB3dIulw6ss',

  // R2 图床公开访问前缀（Function 返回的 URL 会拼成 公开前缀 + 路径）
  // 例如绑定了自定义域名 img.lanerc.me，就填 https://img.lanerc.me
  r2PublicBase: 'https://img.lanerc.me',

  // 管理台登录页背景图（public/admin/ 下的文件名；在「图片管理 → 控制台背景」里切换）
  adminBg: 'login-art.jpg',

  // 内容集合
  collections: {
    posts: {
      label: '文章',
      path: 'src/content/posts',
      mode: 'dir', // 每篇文章一个目录
      fields: ['title', 'published', 'updated', 'description', 'image', 'tags', 'category', 'draft', 'pinned', 'password', 'passwordHint'],
    },
    dynamic: {
      label: '动态',
      path: 'src/content/dynamic',
      mode: 'file', // 平铺 .md 文件
      fields: ['published', 'pinned', 'location'],
      newFileName: () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.md`;
      },
    },
    projects: {
      label: '项目',
      path: 'src/content/projects',
      mode: 'file',
      fields: ['title', 'published', 'description', 'image', 'tags', 'draft'],
    },
    spec: {
      label: '单页',
      path: 'src/content/spec',
      mode: 'file',
      fields: ['title', 'description'],
    },
  },
};
