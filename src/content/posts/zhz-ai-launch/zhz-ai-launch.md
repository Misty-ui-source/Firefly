---
title: 给博客装了个 AI 评论员：zhz-ai 的折腾全记录
published: 2026-10-18
updated: 2026-10-18
description: 博客评论区接入 AI 自动回复，从改名到修三个离谱 bug，再到评论区自动刷新，一天的折腾全记录。
image: ./cover.webp
tags:
  - 博客
  - Waline
  - AI
  - 折腾记录
category: 博客
draft: false
---

# 给博客装了个 AI 评论员：zhz-ai 的折腾全记录

博客评论区一直是我心里的一个结——访客留言了，我不能 24 小时蹲着回。于是有了这个想法：搞个 AI 自动回评论，简单的它搞定，难的再叫我。

说干就干，一天时间，从 0 到 1，外加三个离谱 bug。记录一下。

## 起名：从"暮色"到 zhz-ai

一开始叫"Muse"，太直白了。后改"暮色"——汉字版的 muse，有点味道。但最后还是定了 **zhz-ai**，简单直接，一看就知道是站长的 AI 分身。

头像用 QQ 邮箱头像（2099621514@qq.com），Waline 认邮箱不认 avatar 字段，踩了个小坑。

## 架构：Flask + 智谱 + 轮询兜底

服务跑在 ID 那台机子上（HK 机子内存太小了，887MB 跑不动），Flask + gunicorn 单 worker，60 秒轮询一次 Waline 的 recent API。

为啥不用 webhook？Waline 的 WEBHOOK 是服务端环境变量，配了，但真实评论就是不触发。原因没查清——先跑起来，轮询兜底。

模型试了一圈：glm-4.7-flash 过载，glm-4.5-flash 返回空，只有 **glm-4-flash** 稳定。就它了。

提示词写了双风格：随笔类短平快玩梗，技术类大胆展开给建议。之前测试时回得太水（"发给我看看"这种空话），被我骂了一顿重写了——现在技术类会针对具体技术点给建议。

## 三个离谱的 bug

### Bug 1：轮询线程从没启动过

最离谱的一个。部署了两次，AI 就是不回评论。查了半天，发现轮询启动代码写在 `if __name__ == "__main__":` 里——gunicorn 导入模块根本不执行这个块！

改成模块加载时直接启动线程。两分钟的事，找了一小时。🤡

### Bug 2：重复回复

修好轮询后，AI 开始回了——一次回两条，一模一样。

原因：webhook 处理完没把 objectId 记到已处理集合里，轮询又扫到同一条，又回一遍。修法：在生成回复**之前**先标记已处理，防竞态。

### Bug 3：改了 systemd 没生效

想把 gunicorn 从双 worker 改成单 worker（省内存），改完重启，没变化。查了半天——改错文件了！

systemd 实际用的是 `/etc/systemd/system/` 下的 service 文件，我改的是 `/opt/` 下的副本。Linux 老坑了，记录一下。

## 评论区自动刷新

访客发完评论，AI 回了，但页面不刷新，得按 F5 才看得到。这体验不行。

调研了 Waline 官方源码：`init()` 返回的 `update()` 只在 path 变化时重拉，同页调用无效。唯一靠谱的办法是 `destroy()` + 重新 `init()`。

最后方案：每 30 秒查一次服务端评论数，有新增**且**用户没在输入框打字时，才重建评论区。无新增零打扰，用户打字时不打断——草稿丢了是要骂人的。

## 小修小补

- 实验报告《Analog Basic Amplifier》的电路图乱码了：ASCII 电路图转 Markdown 时对齐全丢，换成原图
- 转换速率表格重排成标准 Markdown 表格
- 两篇报告清掉 Word 分页符残留（`\x0c`，渲染会出怪字符）
- Circuit Lab 6 的仿真截图放错了（放了张公式图），换成正确的 Multisim 截图
- 友链加了<a href="https://blog.fqzlr.top/" target="_blank"><strong>番茄主理人</strong></a>（排第一）、<a href="https://pasule.com/" target="_blank"><strong>Pasule</strong></a>

## 还没搞定的

- 轮询 60 秒还是有点慢，AI 回复要 70-80 秒才可见。想改 15 秒，还在犹豫（怕被智谱限流）
- Webhook 不触发的原因还没查清
- 统计页 Swup 导航时的数据竞态修了，等验证

折腾一天，博客又活过来一点。AI 评论员已上岗，欢迎来调戏——它现在叫 zhz-ai，别叫错了。
