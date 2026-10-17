---
title: 博客重建：从 Fuwari 到 Firefly，一天的折腾记录
published: 2026-10-15
updated: 2026-10-15
description: 把博客从 Fuwari 搬到 Firefly，踩了一堆坑：Astro content 缓存、VPS 构建内存爆炸、Live2D 的 DOM 定位、下载站的反爬。记录一下。
image: ./cover.png
tags:
  - 博客
  - 折腾
  - Astro
  - 迁移
category: 博客
draft: false
---

旧博客是 Fuwari 主题，用了一阵子，越看越觉得功能不够施展。今天一咬牙，整个搬到 Firefly——同样是 Astro 生态，但卡片风格、轮播横幅、自带音乐播放器和 Live2D，可玩性高得多。

## 迁移：11 篇文章，一次过

Firefly 用 Astro 的 content collections 管内容，文章丢进 `src/content/posts/` 就行。旧站 11 篇文章加 About 页，图片路径改成相对路径，构建一次通过，没出幺蛾子。新域名 `lanerc.me`，旧站留着 `www.lanerc.me`，导航栏加个"开往旧站"，体面分手。

## 构建：别在 VPS 上作死

第一个坑出现在构建环节。`pnpm build` 会先跑一堆联网的生成脚本（GitHub 卡片数据、封面抓取之类的），在网络差的环境直接卡死。解决办法：只改内容的时候直接跑 `./node_modules/.bin/astro build`，跳过那些脚本。

第二个坑更狠：之前试过在 VPS 上直接构建，结果 Node 进程被 OOM killer 干掉，exit 133。887MB 内存的小鸡就别想本地构建这种事了。从此定下规矩：**本地构建 dist，VPS 只做静态托管**，nginx 伺候。

还有个玄学坑：删掉 `src/content/posts/` 下的 md 文件后重新构建，dist 里居然还有已删除文章的残留——Astro 的 content 层缓存在 `node_modules/.astro` 里没失效。删文件后构建前先 `rm -rf node_modules/.astro`，百试百灵。

## 样式：3px 黑边框的执念

看中了某个站长的方框质感，卡片统一改成 `3px solid #1c1c1c` 粗黑边框，hue 调到 174 的青绿色。favicon 换成双猫图，深浅色自动切换——最骚的是把主题里所有旧 favicon 文件名的内容全都替换成新图，防止任何回退路径冒出旧图标。别问，问就是被浏览器缓存坑过。

页脚加了萌 ICP 备案和实时运行时间计数器。侧栏的建站时长一开始显示 653 天，原因是 `siteStartDate` 写着 2025-01-01，改成今天，世界清净了。

## 音乐：下载站的攻防战

站内播放器加了三首歌。下载的时候发现下载站耍花招："下载"按钮实际是打开新标签页播放，根本不触发文件下载。绕过去的办法是让它暴露音频直链，然后 `curl` 直接抓——网易云的签名 URL 有效期大概一小时，手要快。

更绝的是这站现在加了"口令解锁"，要拿快手极速版扫码。行吧，以后再下歌就手动过。

## Live2D：从五个到一个

主角色雪初音常驻，旁边最多的时候摆了五个小伙伴：白猫 tororo、金发 z16、chitose、shizuku、wanko。中间还闹过笑话——把西装男 chitose 认成 z16 删错了，又换回来。

技术上有个坑：`l2d-widget` 的根节点是个没有 class 的 `position: fixed` div，没法用常规选择器定位。最后用的办法是记录组件创建前后的 DOM 差集，找到带 canvas 的 fixed div 来定位每个小伙伴。

最后还是决定做减法：只留金发 z16 一个站在右下角，和主角色左右对称。五个确实太吵了。

## 项目页与书签：从占位到自家东西

主题自带的"Firefly 主题模版"和"示例项目"两个占位直接删掉，换上自己的五个：Folia、Komari Monitor、哪吒管理面板、Cloud Mail、IP 检测工具，每个都配了主页截图。Komari 的介绍里专门写了后台可视化和 WebSSH——电脑没电的时候，手机平板开网页就能 SSH 连服务器，这体验谁用谁知道。

书签导航加了"论坛"分组（Linux Do、NodeSeek、NodeLoc、奶昔论坛），工具分组塞了硬核指南，图标一个不少。

## 部署：一键脚本

写了个 `deploy.sh`，做几件事：装 nginx、删 Debian 默认站点、解压 dist、修权限防 403、监听 80 和 8880（高位端口方便直连预览）。VPS 上跑一遍，完事。

一天下来发了 22 个版本，博客算是彻底换了个样子。剩下的就是慢慢写文章了。
