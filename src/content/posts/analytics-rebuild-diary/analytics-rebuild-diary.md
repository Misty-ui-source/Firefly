---
title: Waline 评论 + Umami 统计：从零部署到接入博客全教程
published: 2026-10-16
updated: 2026-10-16
description: 香港 VPS 上 docker 部署 Waline（评论）和 Umami（统计），nginx 反代 + Cloudflare HTTPS，博客端接入配置。踩坑全记录，命令都验证过。
image: ./cover.jpg
tags:
  - 博客
  - 教程
  - Docker
  - Cloudflare
  - Waline
  - Umami
  - 统计
category: 教程
draft: false
---

博客的评论和统计，我全用自建的：Waline 做评论，Umami 做访问统计。都在一台香港 VPS 上跑 Docker，nginx 反代，Cloudflare 做 HTTPS。这篇把部署全过程写清楚，命令都是亲测有效的。

## 一、Waline：评论系统

### 1. Docker 部署

Waline 官方镜像 `lizheming/waline`，用 SQLite 就行，不用额外数据库。

```bash
# 生成随机 JWT 密钥（在你自己的终端执行）
openssl rand -hex 32

# 启动容器（把上面生成的密钥填进去）
sudo docker run -d \
  --name waline \
  --restart always \
  -p 127.0.0.1:8360:8360 \
  -v waline-data:/app/data \
  -e SQLITE_PATH=/app/data \
  -e JWT_TOKEN=你生成的密钥 \
  -e SERVER_URL=https://waline.lanerc.me \
  lizheming/waline:latest
```

**三个必加的环境变量，一个都不能少**（都是 10-16 亲测踩坑）：

| 变量 | 值 | 不加的后果 |
|---|---|---|
| `SQLITE_PATH` | `/app/data`（必须是**目录**，不是文件） | 写成 `/app/data/waline.db` 会被当成目录，容器起不来 |
| `JWT_TOKEN` | 随机字符串 | SQLite 分支没有 fallback，登录报 `secretOrPrivateKey must have a value` |
| `SERVER_URL` | `https://waline.lanerc.me` | Cloudflare Flexible SSL 下，不设会导致管理后台混合内容被拦截 |

验证：

```bash
curl -s http://127.0.0.1:8360/api/comment | head -c 200
# 应返回 {"errno":0,...}，不是 000
```

### 2. 手动建表（必须）

Waline 镜像**不会**自动建表。首次部署后手动建三张表：

```bash
# 起个临时容器连上 waline-data 卷
sudo docker run --rm -it -v waline-data:/app/data alpine sh
apk add sqlite
sqlite3 /app/data/waline.sqlite
```

```sql
-- wl_Comment（注意必须有 sticky 列，漏了查评论列表会报错）
CREATE TABLE wl_Comment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, comment TEXT, insertedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(100), link VARCHAR(255), mail VARCHAR(255), nick VARCHAR(255),
  pid INTEGER DEFAULT 0, rid INTEGER DEFAULT 0, sticky INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'approved', like INTEGER DEFAULT 0,
  ua TEXT, url VARCHAR(255), createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wl_Counter (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, url VARCHAR(255), createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE wl_Users (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name VARCHAR(255), email VARCHAR(255), password VARCHAR(255), type VARCHAR(50) DEFAULT 'guest', url VARCHAR(255), avatar VARCHAR(255), github VARCHAR(255), twitter VARCHAR(255), facebook VARCHAR(255), google VARCHAR(255), weibo VARCHAR(255), qq VARCHAR(255), createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
```

真正的库文件是 `/app/data/waline.sqlite`（`waline.db` 是 0 字节空文件，别搞错）。

### 3. nginx 反代 + Cloudflare

`/etc/nginx/conf.d/waline.conf`：

```nginx
server {
    listen 80;
    server_name waline.lanerc.me;
    location / {
        proxy_pass http://127.0.0.1:8360;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Cloudflare 加 A 记录 `waline` → VPS IP，橙色云朵（代理），SSL 设 Flexible。

### 4. 博客端接入

`src/config/commentConfig.ts`：

```ts
export const commentConfig = {
  type: 'waline',
  waline: {
    serverURL: 'https://waline.lanerc.me',
    // 其他按需
  },
};
```

**管理员机制**：第一个注册的用户自动成为管理员。如果之前测试账号先注册占了位置，查库：

```sql
SELECT id, display_name, email, type FROM wl_Users;
-- 把测试账号删掉，真实账号 type 改成 'administrator'
UPDATE wl_Users SET type='administrator' WHERE email='你的邮箱';
```

### 5. 时间戳坑（1970 问题）

Waline 前端有个 bug：用 `createdAt` 而不用 `insertedAt` 会导致 1970 时间。博客首页的"最近评论"组件用的是 `insertedAt`，记得统一。老数据用触发器回填，存北京时间。

---

## 二、Umami：访问统计

### 1. 为什么不用 Umami Cloud

自建免费、数据在自己手里。代价是要个 PostgreSQL（Umami 不支持 SQLite/MySQL）。

### 2. Docker 部署（纯 docker run 版）

注意：我这台香港 VPS 的 Docker 29.1.3 没有 compose 插件，所以用纯 `docker run` 脚本。包在 `~/workspace/blog-build/umami/`，两个文件：`deploy-umami-docker-run.sh` + `nginx-umami.conf`。

```bash
mkdir ~/umami && cd ~/umami
# 把 umami-deploy.tar.gz 解压到这里
tar -xzf umami-deploy.tar.gz
sudo bash deploy-umami-docker-run.sh
```

脚本做的事情：
1. 自动生成 `.env`（强密码，600 权限，复跑沿用）
2. 建 `umami-net` 独立 Docker 网络
3. 起 `umami-db`（`postgres:15-alpine`，带 healthcheck，轮询等 healthy）
4. 起 `umami`（`ghcr.io/umami-software/umami:3.4.0`，只绑 `127.0.0.1:8362`）
5. 等 `/api/heartbeat` 通

关键环境变量（脚本自动处理，手动部署时注意）：

```bash
# umami 容器必需
-e DATABASE_URL=postgresql://umami:密码@umami-db:5432/umami
-e APP_SECRET=随机字符串  # 必须显式设置，不设静默降级有安全隐患
```

首次启动自动建表 + 创建 `admin` / `umami` 账号——**立刻改掉默认密码**。

数据不丢：PostgreSQL 用命名卷 `umami-db-data`，重装容器数据还在。

### 3. nginx 反代

`nginx-umami.conf`（脚本包里自带，拷到 `/etc/nginx/conf.d/`）：

```nginx
server {
    listen 80;
    server_name umami.lanerc.me;
    location / {
        proxy_pass http://127.0.0.1:8362;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Cloudflare 加 A 记录 `umami` → VPS IP，橙色云朵。

### 4. 创建网站 + 拿 Website ID

登录 `https://umami.lanerc.me` → Settings → Websites → Add website，填域名 `lanerc.me`。创建后点进网站详情，URL 里那串 UUID 就是 Website ID。

博客 `src/config/analyticsConfig.ts`：

```ts
export const analyticsConfig = {
  umami: {
    enabled: true,
    websiteId: '你的-website-id',
    scriptUrl: 'https://umami.lanerc.me/script.js',
    // 会话回放（可选，v3.1+）
    replays: {
      enabled: true,
      scriptUrl: 'https://umami.lanerc.me/recorder.js',
    },
  },
};
```

### 5. 构建时拉数据（给统计页用）

统计页 `/analytics/` 的数据是构建时从 Umami API 拉的，不是实时查：

```bash
# 在你自己的终端（不要贴 key 到聊天里）
export UMAMI_API_KEY="你的api-key"
python3 scripts/fetch-umami-stats.py
```

脚本拉取：
- 90 天 daily（给 7/30/90 天切换）
- 30 天 hourly（给 7×24 热力图）
- devices / browsers / topPages / referrers

输出 `src/data/umami-stats.json`。

**两个坑**：
1. **403 限流**：Umami 对密集请求返回 403，不是 key 错。脚本里每个请求间隔 2 秒。
2. **type 参数**：metrics 接口用 `type=path`，`type=url` 会 400。realtime 接口路径是 `/api/realtime/{websiteId}`。

API Key 在 Umami 后台 Settings → API Keys 创建。**Key 只显示一次，丢了就重新生成**。

---

## 三、统计页前端：SVG 环形图

数据有了，前端展示。学 HY 的 donut 图，不用 ECharts，SVG 手画：

```astro
---
const R = 54, C = 2 * Math.PI * R;
let offset = 25;
const segs = items.map((item, i) => {
  const len = (item.count / total) * C;
  const el = (
    <circle cx="70" cy="70" r={R} fill="none"
      stroke={colors[i]} stroke-width="18"
      stroke-dasharray={`${len} ${C - len}`}
      stroke-dashoffset={-offset}
      transform="rotate(-90 70 70)" />
  );
  offset += len;
  return { el, pct: Math.round((item.count / total) * 100) };
});
---
<svg viewBox="0 0 140 140">
  <circle cx="70" cy="70" r={R} fill="none" stroke="#f3f0ea" stroke-width="18" />
  {segs.map(s => s.el)}
</svg>
```

原理：`stroke-dasharray` 控制每段弧的显示长度，`stroke-dashoffset` 累加实现拼接，`rotate(-90)` 让起点从顶部开始。

淡背景图必须用 CSS `background-image`，不要用 `<img>` 绝对定位：

```css
.device-card {
  background-image:
    linear-gradient(rgba(255,255,255,0.9), rgba(255,255,255,0.9)),
    url('/images/analytics/card-11.jpg');
  background-size: cover;
  background-position: center;
}
```

---

## 踩坑总表

| 坑 | 症状 | 解法 |
|---|---|---|
| Waline `SQLITE_PATH` 写成文件路径 | 容器起不来 | 必须是目录 `/app/data` |
| Waline 不设 `JWT_TOKEN` | 登录报 `secretOrPrivateKey must have a value` | SQLite 无 fallback，必须设 |
| Waline 不设 `SERVER_URL` | CF Flexible 下后台混合内容被拦 | 设为 `https://` 开头 |
| Waline 不建表 | `no such table: wl_Comment` | 手动建三张表，别漏 `sticky` 列 |
| 第一个注册的不是你 | 你变成 guest | SQL 把 type 改成 administrator |
| Umami 403 | 拉数据失败 | 请求间隔 2 秒 |
| Umami `type=url` | 400 | 用 `type=path` |
| 部署完没变化 | 看到旧页面 | 清 Cloudflare 缓存 |
| img 当背景 | 被骂重做 | 用 CSS background-image |

---

两套服务跑下来，评论和统计全在自己手里，不依赖第三方 SaaS。备份记得带上 `waline-data` 和 `umami-db-data` 两个 Docker 卷。

---

## 四、站点统计页：设计思路

### 为什么学 HY

HY 的 [9ll.uk/analytics](https://www.9ll.uk/analytics/) 是我见过最好看的个人站统计页。核心三招：

1. **双栏错落**：左宽右窄，卡片高低错开，不是一排排堆下去——单栏看着像后台管理系统，双栏才像"展示页"。
2. **环形图 + 条排布**：设备、浏览器用 donut 图，左边图右边图例（彩色圆点 + 名称 + 百分比），信息密度高又不挤。
3. **淡背景**：二次元妹子图 8-10% 透明度铺底，若隐若现。纯白卡片太素，全图背景太吵，淡化是中间解。

### 卡片规划（11 张）

| # | 卡片 | 数据源 | 备注 |
|---|---|---|---|
| 1 | Hero（站点统计） | Umami allTime | 大标题 + 妹子图，不折腾 |
| 2-5 | 数字卡×4 | Umami | 累计访客/浏览、今日访客/浏览 |
| 6 | 访问脉冲 | Umami daily | 7/30/90 天切换 + 热门页面 |
| 7 | 推送节奏 | GitHub API | 52 周热力图 + 4 统计 |
| 8 | 访客活跃时间 | Umami hourly | 7×24 点阵 + 4 统计 |
| 9 | 设备与浏览器 | Umami | 两个 donut 图 |
| 10 | 访客地域分布 | Umami | 暂无数据，占位 |
| 11 | 流量来源 | Umami | 暂无数据，占位 |
| 12 | 最近评论 | Waline API | 复用首页组件 |

地域和来源暂无数据（站太新），先上架子等数据——总比"即将上线"强。

### 技术选型

- **不用 ECharts**：donut 图用 SVG 原生 `<circle>` + `stroke-dasharray` 手画，零依赖，加载快。
- **构建时拉数据**：Umami 和 GitHub 都是构建时跑 Python 脚本写 JSON，页面纯静态。坏处是不是实时，好处是访问快、不怕 API 挂。
- **Waline 评论客户端拉**：评论需要实时性，用 `client:load` + 2 分钟本地缓存。

---

## 五、调试过程：三次翻车

### 翻车一：Cloudflare 缓存（两次）

**症状**：部署完 v46，打开网站一看——导航栏没有"站点统计"按钮。本地构建明明有。

**排查**：
```bash
# 查线上 HTML
curl -s https://lanerc.me/ | grep -c 'href="/analytics/"'
# 输出 0

# 查 8880 直连（不走 Cloudflare）
curl -s http://20.239.49.52:8880/ | grep -c 'href="/analytics/"'
# 输出 2
```

8880 有，lanerc.me 没有——Cloudflare 把旧 HTML 缓存了。

**解法**：Cloudflare 后台 purge 缓存。或者先用 8880 验证，确认没问题再清缓存看正式站。

**教训**：部署完第一件事不是问"看到了吗"，而是先 purge。

### 翻车二：img 冒充背景图

**症状**：设备卡和推送卡的淡背景图，我用 `<img class="device-bg">` 绝对定位实现。一看效果：这叫背景图？语义完全错了，重做。

**原因**：`<img>` 绝对定位虽然视觉上像背景，但语义错了，而且要额外处理 z-index、pointer-events。CSS `background-image` 才是正解。

**修复**：
```css
/* 错误示范（已删） */
.device-bg { position: absolute; inset: 0; opacity: 0.1; }

/* 正确做法 */
.device-card {
  background-image:
    linear-gradient(rgba(255,255,255,0.9), rgba(255,255,255,0.9)),
    url('/images/analytics/card-11.jpg');
  background-size: cover;
}
```

### 翻车三：图片被裁得只剩一条

**症状**：推送卡热力图下方加了张樱花图，设了 `height: 120px` + `object-fit: cover`，结果一看：这叫调整大小？？？整个图片被裁得只剩中间一条。

**原因**：想着固定高度更整齐，但我要的是完整图片。`object-fit: cover` 会裁掉上下，16:9 的图只剩中间一条。

**修复**：`height: auto`，宽度 100% 顶满，完整显示。

**教训**：图片展示这事，整齐和完整只能二选一，先想清楚你要哪个。

---

## 六、优化过程：v46 → v62

一晚上 16 个版本，每个版本只改一件事：

| 版本 | 改动 |
|---|---|
| v46 | 基座：双栏、7/30/90 切换、7×24 热力图 |
| v47 | 访问脉冲加淡背景，8 小框统一样式 |
| v48 | 8 框统一 72px 高，字体缩小防截断 |
| v49 | 设备/浏览器改 SVG 环形图 + 右侧图例 |
| v50 | 热门页面改成可点击 `<a>` 跳转 |
| v51 | 流量来源加樱花背景 + 环形图，6 号卡起字体调小 |
| v52 | Hero 图边缘渐变 + 光晕，GitHub 真实数据接入 |
| v53 | 除前 5 卡外全部加落樱动画 |
| v54 | 设备卡加暗黑妹子背景（img 版，错的） |
| v55 | 推送卡按 HY 重构 2x2 色块 |
| v56 | 设备卡/推送卡改 CSS background（重做 v54 的错） |
| v57 | 删推送卡底部"小蛇蛇"那段话 |
| v58 | 地域卡加 Q 版妹子背景 |
| v59 | 推送卡加樱花图（裁剪版，错的） |
| v60 | 樱花图改完整显示（重做 v59 的错） |
| v61 | 追踪仓库显示 folia-major |
| v62 | 最终版 |

**优化原则**：
1. **一次只改一件事**：方便回滚，v56 重做 v54、v60 重做 v59 都是这么来的。
2. **截图即需求**：自己截图标红的地方，就是下一版的改动点，不用猜。
3. **字体只调小不调大**：从第 6 张卡开始，标题 1.35rem、小节 0.95rem，信息密度上来了就不吵了。
4. **动画克制**：落樱每个卡 3 片，opacity 0.45，多了就是杀马特。

---

源码在 `src/pages/analytics.astro`，单个文件 800+ 行。想抄的直接看文件，比看这篇管用。

---

## 七、后续方向：国内访问加速

目前博客在国内访问很慢，这是下一步要解决的。思路：

**先分析原因**：到底是 Cloudflare 边缘节点问题、VPS 到国内的线路问题，还是纯粹的备案缺失导致的绕路？得先抓数据——不同地区、不同运营商的延迟和丢包率，找出瓶颈在哪。这部分分析后续补充。

**备案的打算**：如果分析下来是线路问题，考虑给域名做 ICP 备案，然后上国内 CDN。但备案意味着服务器要迁回国内，整套 Docker（Waline、Umami）都要跟着迁，成本不小。还在看，先把原因分析清楚再决定。

总之：先诊断，再开药。盲目上 CDN 烧钱没意义。
