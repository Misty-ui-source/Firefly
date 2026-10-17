#!/bin/bash
# 博客全自动构建脚本
# 步骤：清理缓存 → 生成文章索引 → 生成AI摘要 → Astro构建 → Pagefind索引
set -e
cd "$(dirname "$0")"

echo "=== 1/5 清理缓存 ==="
rm -rf node_modules/.astro .astro

echo "=== 2/5 生成文章索引 ==="
python3 scripts/gen-post-meta.py

echo "=== 3/5 生成AI摘要（新文章） ==="
if [ -f .env.local ]; then
    export $(cat .env.local | xargs)
fi
python3 scripts/gen-post-summary.py || echo "摘要生成跳过（无Key或限流），用简介兜底"

echo "=== 4/5 Astro 构建 ==="
./node_modules/.bin/astro build

echo "=== 5/5 Pagefind 索引 ==="
npx tsx scripts/run-pagefind.ts

echo ""
echo "构建完成 ✅"
