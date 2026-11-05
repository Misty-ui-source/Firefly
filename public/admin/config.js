/* 管理台配置：按自己情况改这里即可 */
window.ADMIN_CONFIG = {
  // GitHub 仓库
  owner: 'Misty-ui-source',
  repo: 'Firefly',
  branch: 'main',

  // GitHub OAuth App 的 Client ID（按域名自动切换）
  // 每个域名用各自的 App（pages.dev / lanerc.me / hk / origin 四套）
  // 回调地址填：https://你的域名/admin/
  githubClientId: (() => {
    const ids = {
      'firefly-6sp.pages.dev': 'Ov23lizGLBB3dIulw6ss',
      'lanerc.me': 'Ov23liLl7QdL6nfcgOLR',
      'hk.lanerc.me': 'Ov23liiRyNo94HxHZipe',
      'origin.lanerc.me': 'Ov23liYVP2sJg75AWX2c'
    };
    return ids[location.hostname] || ids['lanerc.me'];
  })(),

  // 多站管理：sites[0] 是主站（用上面的顶层 owner/repo/branch/collections）；
  // 其他站点自带仓库与集合配置，在顶栏切换。GitHub 令牌共用一份
  // （登录账号对各站仓库有写权限即可，如协作者）。
  sites: [
    { id: 'main', label: '🏠 主站' },
    {
      id: 'idea', label: '💡 灵感屋',
      owner: 'halozray', repo: 'my-blog', branch: 'master',
      oplog: false, // 该仓库不写操作日志文件，保存走单文件直存
      ideas: true, // 开「点子」视图（posts 的 draft 筛选）
      pages: ['dashboard', 'posts', 'ideas', 'edit', 'login'], // 只开放这些页面，其余路由回首页
      dashHint: '选个集合开始干活。保存后会自动 commit 到 GitHub，构建发版走 Vercel。',
      collections: {
        posts: {
          label: '文章',
          path: 'src/content/posts',
          mode: 'dir', // 每篇文章一个目录
          fields: ['title', 'published', 'updated', 'description', 'image', 'tags', 'category', 'draft', 'pinned', 'password', 'passwordHint'],
        },
      },
      navLayout: {
        primary: ['dashboard', 'posts', 'ideas'],
        secondary: [],
        homeCards: ['posts'],
        labels: { posts: '📝 文章', ideas: '💡 点子' },
      },
      navExternal: { blog: 'https://idea.lanerc.me/' },
      quickLinks: [
        { icon: '🌐', label: '灵感屋首页', url: 'https://idea.lanerc.me/' },
        { icon: '🐙', label: 'GitHub 仓库', url: 'https://github.com/halozray/my-blog' },
        { icon: '▲', label: 'Vercel', url: 'https://vercel.com/dashboard' },
      ],
    },
  ],

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
    diary: {
      label: '日记',
      path: 'src/content/diary',
      mode: 'file', // 每篇日记一个 .md 文件，博客展示在 /diary/
      fields: ['title', 'published', 'location', 'pinned', 'draft', 'password', 'passwordHint'],
      newFileName: () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.md`;
      },
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
      fields: ['title', 'published', 'description', 'image', 'status', 'tags', 'draft'],
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
    secondary: ['images', 'music', 'gallery', 'announce', 'friends', 'booknav', 'blog', 'waline', 'umami', 'search', 'medialib', 'tags', 'fonts', 'theme', 'navmgr', 'videos', 'profile', 'banner', 'timeline', 'thoughts', 'sitenav', 'diary'],
    homeCards: ['posts', 'dynamic', 'projects', 'spec', 'friends', 'gallery', 'timeline', 'thoughts', 'music', 'waline', 'blog', 'umami'],
    labels: { diary: '📓日记' },
  },

  // 右侧栏快捷入口：仅「左侧边栏 / 混合」布局 + PC 宽屏（≥1680）时显示，
  // 在控制台「🧭 导航」页里自由增删改。
  quickLinks: [
    { icon: '🌐', label: '博客首页', url: 'https://lanerc.me/' },
    { icon: '🐙', label: 'GitHub 仓库', url: 'https://github.com/Misty-ui-source/Firefly' },
    { icon: '☁️', label: 'Cloudflare', url: 'https://dash.cloudflare.com' },
    { icon: '▲', label: 'Vercel', url: 'https://vercel.com/dashboard' },
    { icon: '💬', label: 'Waline 后台', url: 'https://waline.lanerc.me/ui' },
    { icon: '📊', label: 'Umami 统计', url: 'https://umami.lanerc.me/share/EG15WwHeRvz2lmd2' },
    { icon: '✨', label: 'Muse', url: 'https://muse.ai' },
    { icon: '🐧', label: 'Linux.do', url: 'https://linux.do/' },
    { icon: '🕰️', label: '旧站', url: 'https://www.lanerc.me' },
    { icon: '📝', label: '写作报告', url: '#/stats' },
  ],

  // 外部跳转入口：导航栏点击在新标签页打开，不走控制台内部路由
  navExternal: {
    blog: 'https://lanerc.me/',
    umami: 'https://umami.lanerc.me/share/EG15WwHeRvz2lmd2',
  },
};
