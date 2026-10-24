/* 管理台配置：按自己情况改这里即可 */
window.ADMIN_CONFIG = {
  // GitHub 仓库
  owner: 'Misty-ui-source',
  repo: 'Firefly',
  branch: 'main',

  // GitHub OAuth App 的 Client ID（按域名自动切换）
  // firefly-6sp.pages.dev 用旧 App，lanerc.me 用新 App
  // 回调地址填：https://你的域名/admin/
  githubClientId: (() => {
    const ids = {
      'firefly-6sp.pages.dev': 'Ov23lizGLBB3dIulw6ss',
      'lanerc.me': 'Ov23liLl7QdL6nfcgOLR'
    };
    return ids[location.hostname] || ids['lanerc.me'];
  })(),

  // R2 图床公开访问前缀（Function 返回的 URL 会拼成 公开前缀 + 路径）
  // 例如绑定了自定义域名 img.lanerc.me，就填 https://img.lanerc.me
  r2PublicBase: 'https://img.lanerc.me',

  // 管理台登录页背景图（public/admin/ 下的文件名；在「图片管理 → 控制台背景」里切换）
  adminBg: 'login-art.jpg',
  // 管理台内部（登录后）背景：默认多张轮换（login-art.jpg / login-art-alt.jpg / login-art-sketch.png
  // + 用户上传的 admin-inner-bg.jpg）；在「图片管理 → 控制台内部背景」里用开关控制开/关

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

  // 控制台导航栏布局：在「··· → 🧭 导航」里可视化调整（顺序/改名/主栏与···分组）
  // key 说明：dashboard=首页 stats=写作 posts/dynamic/projects/spec=内容集合
  //           images=图片 music=音乐 gallery=相册 announce=公告 friends=友链 booknav=书签
  navLayout: {
    primary: ['dashboard', 'stats', 'posts', 'dynamic', 'projects', 'spec'],
    secondary: ['images', 'music', 'gallery', 'announce', 'friends', 'booknav', 'blog', 'waline', 'umami'],
    homeCards: ['posts', 'dynamic', 'projects', 'spec', 'friends', 'gallery', 'timeline', 'thoughts', 'music', 'waline', 'blog', 'umami'],
    labels: {}, // 自定义名称，如 { dashboard: '🏠 主页' }；不填则用默认
  },

  // 外部跳转入口：导航栏点击在新标签页打开，不走控制台内部路由
  navExternal: {
    blog: 'https://lanerc.me/',
    umami: 'https://umami.lanerc.me/share/EG15WwHeRvz2lmd2',
  },
};
