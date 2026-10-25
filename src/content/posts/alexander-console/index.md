---
title: .pages.dev 飞快，自定义域名却慢得要死
category: 博客
tags:
  - 折腾记录
  - Cloudflare
  - Waline
  - 控制台
  - 网络
  - AI
series: 博客搭建
seriesOrder: 1
description: 为了让写博客这件事变得赏心悦目，我重构了整套系统：自研控制台、评论迁移，与一个未解决的难题
image: https://img.lanerc.me/covers/mvmlrz7h-1c5e7c0d463b38aa0256f1362becc554_720.webp
draft: false
pinned: false
published: 2026-10-24T23:30:00+08:00
updated: 2026-10-25T11:19:00+08:00
---
## 引子

为了让写博客这件事变得赏心悦目，我重构了整套博客系统：前端上了 Cloudflare Pages，后台让 AI 帮我写了一套，评论也迁了新家（==小猪手没迁好，小鸡限速，好难好难呜呜==），好在重要评论都还在，就是格式乱了。万事俱备之后，灵异事件来了——**我在电脑上打开自己的博客，慢得要死；手机打开，秒开。**

## 装备升级：让写作成为一种享受

后台这事我调研得很认真：Qexo、Hexo CMS 看着不够漂亮，Kirameku 的毛玻璃、Halo 的清爽、ColaMD 的主题各有各的好，但没有一个完全对胃口。最后我的选择是——**一个都不用，让 AI 帮我自己写一套**。

成果就是 [Alexander Console](https://lanerc.me/admin)。思路是：不要数据库，不要后端服务器，**GitHub 仓库就是后台**。GitHub OAuth 登录，所有内容保存即一次 commit，仓库在，数据就在。仔细检查调试之后，发现它管的东西比我预想的多：

- **全站可管**：文章、动态、相册（带加密相册和上下排序）、导航栏分组、首页 12 张卡片、书签、时间线、公告栏、碎碎念，连 Waline 评论审核都做成了内置页，躺床上拿手机就能审评论；
- **写稿不丢**：编辑器草稿自动保存，写一半杀后台回来接着写；再加一道基于文件版本的守卫，别处改过的新版本，永远不会被旧草稿覆盖；新建文件撞名自动改名顺延，删除前必须二次确认；
- **图片自由**：图床走 Cloudflare R2；四处背景（桌面/手机 × 登录/内页）都能攒多张自定义图，可固定、可进轮换、可单张删；
- **颜值与仪式感**：日夜双主题、毛玻璃细边框、波奇酱背景、CRT 开关机加虫洞切换动画，还能以 PWA 形态装到桌面和手机主屏，像个正经 App；
- **彩蛋**：它会记操作日志，月底自己弹一份小红书周报风的总结报告，告诉我这个月写了几篇、折腾了什么。

同时，站点有新增了两个板块：[时间线板块](https://lanerc.me/gallery/timeline/)（随便写写），时间线板块右上角新增了一个[碎碎念](https://lanerc.me/gallery/thoughts/)板块，记录时不时迸发的灵感，页面采用星空底，模拟脑海想法条，滑动鼠标前后移动，点开可以看到详细说明。


![图片](https://img.lanerc.me/posts/alexander-console/mvn8qp35-image.webp)


话虽如此：写作的地方顺眼，人是真的更愿意打开它码字。而这一整套，是我提需求、AI 写代码、人机配合一点点攒出来的。


![图片](https://img.lanerc.me/posts/alexander-console/mvn78p9o-image.webp)


## 基建优化：Waline 评论系统的零成本新家

评论系统 Waline 最终落在 **Vercel + MongoDB Atlas** 免费层，零成本零运维。避坑点留三个，全是实锤：

- 数据库连接参数（AI可查）必须**拆开填**：主机分片、端口数组、副本集逐项配，整串粘贴进去，部署会在你以为成功时起不来；
- 导入历史评论**绝不能带管理员令牌**，否则所有评论都会挂在博主本人名下；
- 社区有 Workers 移植版，但官方原版和 Workers 运行时不兼容，这条路我没走，看冷汐成功了[评论系统 Twikoo 好多 bug！被迫换成了 Waline](https://lengxiqwq.com/posts/%E8%AF%84%E8%AE%BA%E7%B3%BB%E7%BB%9F-twikoo-%E5%A5%BD%E5%A4%9A-bug%E8%A2%AB%E8%BF%AB%E6%8D%A2%E6%88%90%E4%BA%86-waline/)。有兴趣可以去学习下！

## 系统全景：我的博客长什么样

都已经到这个地步了，我觉得有必要先上全景。目前我的博客是一套「仓库即后台」的静态架构：

```
lanerc.me（Cloudflare Pages · Astro 静态站）
├─ 内容：GitHub 仓库（文章、动态、相册、导航全是文件）
│    └─ Alexander Console → GitHub API 读写 → 保存即 commit → 自动重建
├─ 图片/视频：Cloudflare R2（img.lanerc.me）
├─ 评论：Waline（Vercel + MongoDB Atlas）
│    └─ zhz-ai 机器人：轮询新评论，自动回复
├─ 统计：Umami 自建，前端直连公开接口
└─ 构建：数据脚本五件套 → pnpm build → Pagefind 站内搜索
```

拆开看就三层：**写作层**是控制台和仓库，我只管写，保存就是提交；**托管层**是 Pages，代码一推全站自动重建上线；**服务层**是评论、图床、统计三个独立小服务，各自跑在最适合的免费额度上，坏一个不影响其他。

更详细的可以查看站点[博客日志](https://lanerc.me/changelog/)，文章最后我也会说一下的。

## 排错：为什么 CF Pages 自定义域名「慢得要死」？

先摆现象：`.pages.dev` 默认域名飞快，绑定的自定义域名 `lanerc.me` 在电脑上巨慢，手机平板一切正常。注意前提：**没开任何代理**，电脑连的是校园网 Wi-Fi（SEU-WLAN）。

**嫌疑人一：豪华网卡阵容与跃点数。** 打开网络连接一看，好家伙：Radmin VPN、VPN Client、深信服 aTrust 的虚拟网卡，加上正在用的 WLAN，四块网卡同台竞技。


![图片](https://img.lanerc.me/posts/2026-10-24/mvml56f2-24e778f872771a63bb43c3e1e68f6481.webp)


PowerShell 一查，当场抓到异常：

```powershell
Get-NetIPInterface | Sort-Object InterfaceMetric | Format-Table InterfaceAlias, InterfaceMetric, AddressFamily
```

结果：`VPN - VPN Client` 的 IPv4 跃点数是 **1**，正在上网的 WLAN 是 **35**。Windows 的规矩是跃点数越小优先级越高——系统会优先扑向那块没在干活的虚拟网卡，DNS 查询死等超时再回退，慢就慢在这儿。听起来严丝合缝，于是继续动手查查：

```powershell
Set-NetIPInterface -InterfaceAlias "VPN - VPN Client" -InterfaceMetric 50
```



![图片](https://img.lanerc.me/posts/2026-10-24/mvmlahlp-e59b24862f023065474283f4347be726.webp)



**然后，反转来了。** 改成 50 之后，自定义域名没变快，连原本飞快的 `.pages.dev` 也跟着慢了。这说明那块虚拟网卡的低跃点数没准还在替系统扛着什么，或者这条链压根不是主因。没有对照证据，我不硬撑结论——**把跃点数改回去了**，恢复原状。

**嫌疑人二：校园网 DNS 与 IPv6。** 清掉缓存再对比解析（示例）：

```powershell
ipconfig /flushdns
nslookup lanerc.me
nslookup firefly-6sp.pages.dev
```



![图片](https://img.lanerc.me/posts/2026-10-24/mvmlb6oj-dd987cb7e90302a299062c349a7370ce.webp)



实锤：校园网 DNS（172.19.2.2）给 `lanerc.me` **先返回两个 IPv6 地址**再给 IPv4，而校园网的 IPv6 路由质量一向一言难尽；查 `.pages.dev` 时 DNS 干脆**先超时一次**才给出结果。嫌疑很大，但关 IPv6、换公共 DNS 这些候选解法，我还没逐一验证出唯一真凶，所以这一节的结论是：**未破案**。

后续看看使用cf优选ip的功能来加速国内访问速度吧！

## 总结与启发

这篇没有漂亮的破案结尾，只有一份完整的排查记录和一次老实的回滚。我的体会是：排错最忌讳把「改过参数」当成「破了案」——假设要验证，改坏了就回滚，现象记录清楚，下次接着查。折腾的乐趣有一半在坑里，愿你踩坑时手边有日志，改参数前记得留好退路。

*顺带交代一下：博客本体是[Astro](https://github.com/withastro/astro)静态站，跑在 Cloudflare Pages 上；内容全部存在[GitHub 仓库](https://github.com/Misty-ui-source/Firefly)里，我用自研的 [Alexander Console](https://lanerc.me/admin) 经 GitHub API 读写，保存即提交、提交即自动重建；图片和视频走 Cloudflare R2（img.lanerc.me），评论是 Vercel + MongoDB Atlas 上的 Waline（另有 AI 机器人自动回复），统计用自建的 Umami。整套架构只有一台服务器是为博客本体付费的（==Azure的免费学生机==）。*

