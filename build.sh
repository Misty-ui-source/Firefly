#!/bin/bash
# 博客全自动构建脚本
# 步骤：清理缓存 → 拉取统计数据 → 拉取GitHub数据 → 生成文章索引 → 生成AI摘要 → Astro构建 → Pagefind索引
set -e
cd "$(dirname "$0")"

echo "=== 1/7 清理缓存 ==="
rm -rf node_modules/.astro .astro

# 提前加载环境变量，供后续拉取脚本使用
if [ -f .env.local ]; then
    export $(cat .env.local | xargs)
fi

echo "=== 2/7 拉取 Umami 统计数据 ==="
python3 scripts/fetch-umami-stats.py || echo "统计数据拉取失败，用旧数据兜底"

echo "=== 3/7 拉取 Steam 游戏数据 ==="
python3 scripts/fetch-steam-stats.py || echo "Steam 数据拉取跳过（无 Key），用旧数据兜底"

echo "=== 4/8 拉取 GitHub 推送数据 ==="
python3 scripts/fetch-github-activity.py || echo "GitHub 数据拉取失败，用旧数据兜底"

echo "=== 5/8 拉取友链朋友圈文章 ==="
python3 scripts/fetch-friend-posts.py || echo "朋友圈数据拉取失败，用旧数据兜底"

echo "=== 6/8 生成文章索引 ==="
python3 scripts/gen-post-meta.py

echo "=== 7/8 生成AI摘要（新文章） ==="
python3 scripts/gen-post-summary.py || echo "摘要生成跳过（无Key或限流），用简介兜底"

echo "=== 8/8 Astro 构建 ==="
./node_modules/.bin/astro build

echo "=== Pagefind 索引 ==="
npx tsx scripts/run-pagefind.ts

echo ""
echo "构建完成 ✅"
