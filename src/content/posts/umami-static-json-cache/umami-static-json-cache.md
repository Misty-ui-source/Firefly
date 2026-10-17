---
title: Umami 统计加速：VPS 定时任务 + 静态 JSON，让统计页毫秒级加载
published: 2026-10-17
updated: 2026-10-17
description: 博客统计页直连 Umami API 太慢？用 VPS cron 每 5 分钟拉数据写成静态 JSON，前端优先读 JSON、失败降级走 API。Cloudflare CDN 缓存，毫秒级加载，附完整脚本和部署步骤。
image: ./cover.jpg
tags:
  - 博客
  - 教程
  - Umami
  - 统计
  - 性能优化
  - VPS
  - Cloudflare
category: 教程
draft: false
---

博客统计页（/analytics/）之前是浏览器直连 Umami API 拉数据。在我自己网络好的时候没问题，但在某些网络环境下（比如 PC 到 Cloudflare 的链路差），要等好几秒甚至失败。这篇讲我是怎么做加速的：**VPS 上跑定时任务，每 5 分钟拉一次 Umami 数据写成静态 JSON，前端优先读这个 JSON，读不到再降级走原来的 API**。

## 一、为什么慢

先捋一下原来的流程：

```
浏览器 → Cloudflare → umami.lanerc.me → VPS 上的 Umami → PostgreSQL 查数据 → 原路返回
```

一次页面加载要调 4 个接口：

1. `GET /api/share/{shareId}` —— 拿 websiteId 和 token（token 缓存 24h）
2. `GET /api/websites/{id}/stats?startAt=...&endAt=...` —— 30 天统计
3. `GET /api/websites/{id}/stats?...` —— 今日统计
4. `GET /api/realtime/{id}` —— 实时在线

慢的原因：

- **Umami 的 stats 查询是实时聚合**，30 天的数据要在数据库里扫一遍，本身就要几百毫秒到几秒
- **多一跳 Cloudflare**，每个请求都要过 CDN
- **浏览器到 Cloudflare 的链路**如果差，每个请求都要等

HY（9ll.uk）快是因为他的访客到 Cloudflare 的路好，架构跟我是一样的。

## 二、方案：静态 JSON 缓存

核心思路：**把慢查询挪到服务器端定时做，浏览器只读一个静态文件**。

```
VPS cron（每5分钟）→ Umami localhost（快）→ 写 /api/stats.json
浏览器 → Cloudflare CDN（缓存）→ /api/stats.json（毫秒级）
```

好处：

- 浏览器只拉一个几百字节的 JSON，走 CDN 缓存，基本是毫秒级
- Umami 的慢查询在服务器端做，用户无感
- 数据最多 5 分钟延迟，对统计页来说完全够用

代价：

- 不是严格实时，有 5 分钟延迟（但比之前刷不出来强多了）
- 需要 VPS 上多一个 cron 任务

## 三、VPS 定时脚本

脚本放在 VPS 上，比如 `/opt/umami-stats-cron.sh`：

```bash
#!/bin/bash
# Umami 统计数据定时拉取脚本
# 每 5 分钟跑一次，把数据写成静态 JSON，供博客统计页优先读取

set -e

# ===== 配置区 =====
UMAMI_BASE="https://umami.lanerc.me"
SHARE_ID="EG15WwHeRvz2lmd2"  # 换成你自己的 share ID
# 网站根目录（nginx 的 root），stats.json 会写到 $WEB_ROOT/api/stats.json
WEB_ROOT="/var/www/lanerc"
# ==================

API_DIR="$WEB_ROOT/api"
OUT_FILE="$API_DIR/stats.json"
TMP_FILE="$API_DIR/.stats.json.tmp"

mkdir -p "$API_DIR"

# 1. 拿 websiteId 和 token
SHARE_JSON=$(curl -s --max-time 15 "$UMAMI_BASE/api/share/$SHARE_ID")
WEBSITE_ID=$(echo "$SHARE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('websiteId',''))")
TOKEN=$(echo "$SHARE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -z "$WEBSITE_ID" ] || [ -z "$TOKEN" ]; then
  echo "[$(date '+%F %T')] ERROR: 获取 share token 失败"
  exit 1
fi

NOW_MS=$(date +%s)000
DAY_MS=86400000
P30_START=$(( $(date +%s) * 1000 - 30 * DAY_MS ))
TODAY_START=$(date -d "$(date +%F) 00:00:00" +%s)000

HDR=(-H "x-umami-share-token: $TOKEN" -H "x-umami-share-context: 1")

# 2. 拉 30 天统计、今日统计、实时数据（并行写临时文件）
curl -s --max-time 20 "${HDR[@]}" "$UMAMI_BASE/api/websites/$WEBSITE_ID/stats?startAt=$P30_START&endAt=$NOW_MS&unit=day&timezone=Asia/Shanghai" -o /tmp/umami_s30.json &
P1=$!
curl -s --max-time 20 "${HDR[@]}" "$UMAMI_BASE/api/websites/$WEBSITE_ID/stats?startAt=$TODAY_START&endAt=$NOW_MS&unit=day&timezone=Asia/Shanghai" -o /tmp/umami_today.json &
P2=$!
curl -s --max-time 20 "${HDR[@]}" "$UMAMI_BASE/api/realtime/$WEBSITE_ID" -o /tmp/umami_rt.json &
P3=$!
wait $P1 $P2 $P3 || true

# 3. 组装成前端需要的格式
python3 << 'PYEOF'
import json, time

def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None

s30 = load('/tmp/umami_s30.json') or {}
today = load('/tmp/umami_today.json') or {}
rt = load('/tmp/umami_rt.json') or {}

# 在线人数：5 分钟内有活动的去重 session
online = 0
try:
    seen = set()
    cutoff = time.time() * 1000 - 5 * 60 * 1000
    for e in (rt.get('events') or []):
        from datetime import datetime
        ts = e.get('createdAt', '')
        try:
            t = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000
        except Exception:
            continue
        sid = e.get('sessionId')
        if t >= cutoff and sid and sid not in seen:
            seen.add(sid)
            online += 1
except Exception:
    pass

out = {
    'totalVisitors': s30.get('visitors'),
    'totalPageviews': s30.get('pageviews'),
    'todayVisitors': today.get('visitors'),
    'todayPageviews': today.get('pageviews'),
    'online': online,
    'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime()),
}
with open('/tmp/umami_stats_out.json', 'w') as f:
    json.dump(out, f)
print('OK', out.get('generatedAt'))
PYEOF

# 4. 原子写入（先写临时文件再 mv，避免读到一半的文件）
mv /tmp/umami_stats_out.json "$TMP_FILE"
mv "$TMP_FILE" "$OUT_FILE"
chmod 644 "$OUT_FILE"
echo "[$(date '+%F %T')] stats.json 已更新"
```

### 设置 cron

```bash
# 给脚本执行权限
chmod +x /opt/umami-stats-cron.sh

# 先手动跑一次，确认能生成文件
/opt/umami-stats-cron.sh
cat /var/www/lanerc/api/stats.json

# 加到 crontab，每 5 分钟跑一次
crontab -e
# 添加这一行：
*/5 * * * * /opt/umami-stats-cron.sh >> /var/log/umami-stats.log 2>&1
```

### nginx 配置

确保 `/api/stats.json` 能被访问。如果你的 nginx root 已经是 `/var/www/lanerc`，那 `https://lanerc.me/api/stats.json` 会自动生效。不需要额外配置。

建议给这个文件加个短缓存（CDN 层面），比如 1 分钟：

```nginx
location = /api/stats.json {
    expires 1m;
    add_header Cache-Control "public, max-age=60";
}
```

## 四、前端改造

前端逻辑：**先尝试拉 `/api/stats.json`，成功就用它；失败则走原来的 Umami API**（原逻辑一行不动，作为兜底）。

我在 `analytics.astro` 里加了一个独立的 `<script>` 块，放在主逻辑之前：

```html
<script is:inline>
// 静态 JSON 优先尝试：VPS 定时任务每 5 分钟生成 /api/stats.json
// 成功则渲染并设置标志，主 script 会直接返回；失败则静默，主 script 走原有 API 逻辑
(function () {
    function fmt(n) { return Number(n || 0).toLocaleString(); }
    function renderStatic(d) {
        var map = {
            totalVisitors: d.totalVisitors,
            totalPageviews: d.totalPageviews,
            todayVisitors: d.todayVisitors,
            todayPageviews: d.todayPageviews
        };
        Object.keys(map).forEach(function (k) {
            var el = document.querySelector('[data-stat="' + k + '"]');
            if (el && map[k] != null) el.textContent = fmt(map[k]);
        });
        var onlineEl = document.getElementById("live-online");
        if (onlineEl && d.online != null) {
            onlineEl.innerHTML = '<span class="online-dot"></span>' +
                (d.online > 0 ? d.online + " 人在线" : "在线");
        }
        var updatedEl = document.getElementById("live-updated");
        if (updatedEl) {
            var t = new Date().toLocaleString("zh-CN", { hour12: false }).slice(0, 16);
            updatedEl.textContent = "实时更新于 " + t + " · 30天区间";
        }
        try {
            localStorage.setItem("lanerc-umami-live",
                JSON.stringify({ ts: Date.now(), data: d }));
        } catch (e) {}
    }
    fetch("/api/stats.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) {
            if (d && (d.totalVisitors != null || d.totalPageviews != null)) {
                renderStatic(d);
                window.__lanercStatsDone = true;  // 标记已命中
            }
        })
        .catch(function () {});  // 失败静默，主逻辑会兜底
})();
</script>
```

主 script 开头加一行检查：

```js
(function () {
    if (window.__lanercStatsDone) return;  // 静态 JSON 已命中，直接返回
    // ... 原有 Umami API 逻辑（未改动）
})();
```

关键点：

- **两个 script 块互相独立**，静态 JSON 的那个失败了不会影响主逻辑
- 用 `window.__lanercStatsDone` 做标记，避免重复渲染
- `fetch` 用 `{ cache: "no-store" }`，确保拿到的是最新的（CDN 层面可以设 1 分钟缓存，平衡实时性和速度）
- 原有 API 逻辑一行没动，JSON 文件不存在或拉取失败时自动降级

注意 `is:inline`：Astro 构建时会处理 `<script>` 标签，不加 `is:inline` 的会被打包优化掉，导致线上不执行。这个坑我踩过两次了，血的教训。

## 五、效果对比

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 请求数 | 4 个 API | 1 个静态文件 |
| 响应时间（网络好） | 1-2s | <100ms |
| 响应时间（网络差） | 5-10s 或失败 | <500ms |
| 数据延迟 | 实时 | 最多 5 分钟 |
| 失败时 | 显示构建时的旧数据 | 自动降级走 API |

## 六、踩坑记录

1. **Astro 的 `is:inline`**：内联 script 必须加 `is:inline`，否则构建时会被 Astro 处理掉，线上 JS 根本不执行。我之前已经因为这个坑修过两次统计页了。

2. **原子写入**：cron 脚本写 JSON 时先写临时文件再 `mv`，避免浏览器读到写一半的文件。

3. **时区**：Umami API 的 `timezone=Asia/Shanghai` 参数别漏，否则今日数据会对不上。

4. **在线人数计算**：realtime 接口返回的是 events 列表，需要按 sessionId 去重，只算 5 分钟内有活动的。这个逻辑在前后端都要保持一致。

## 七、总结

这个方案的核心就是**用空间换时间**：VPS 上多一个 cron 任务，换来前端毫秒级的加载体验。对于统计页这种"数据可以容忍几分钟延迟"的场景，非常划算。

如果你也在用 Umami 做博客统计，且访客网络环境复杂，可以试试这套方案。完整脚本在上面，直接拿去改改配置就能用。
