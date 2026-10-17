#!/usr/bin/env python3
"""
构建时拉取 Umami 统计数据
输出: src/data/umami-stats.json
用法: UMAMI_API_KEY=xxx python3 scripts/fetch-umami-stats.py
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

API_KEY = os.environ.get("UMAMI_API_KEY", "")
WEBSITE_ID = "fd50ff34-e2c4-4110-888e-a40093cbe582"
BASE = "https://umami.lanerc.me"
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "umami-stats.json")

def api_get(path, params=None):
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; lanerc-blog-build)",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            # 可能是限流，等待后重试一次
            print(f"403, 等待 5 秒重试: {path}", file=sys.stderr)
            time.sleep(5)
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=20) as r:
                    return json.load(r)
            except Exception as e2:
                print(f"重试失败 {path}: {e2}", file=sys.stderr)
                return None
        print(f"HTTP {e.code}: {path}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Error {path}: {e}", file=sys.stderr)
        return None

def ms(days_ago=0):
    """返回 days_ago 天前的毫秒时间戳（北京时间 00:00）"""
    # 简单起见用 UTC 天
    t = time.time() - days_ago * 86400
    return int(t * 1000)

def main():
    if not API_KEY:
        print("需要 UMAMI_API_KEY 环境变量", file=sys.stderr)
        sys.exit(1)

    now = ms(0)
    result = {"updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime())}

    def paced_get(path, params=None):
        """带间隔的请求，避免触发 Umami 限流"""
        r = api_get(path, params)
        time.sleep(2)
        return r

    # 1. 累计数据（从网站创建时间到现在）
    # Umami 没有直接的 all-time，用一个很大的范围
    all_stats = paced_get(f"/api/websites/{WEBSITE_ID}/stats", {
        "startAt": 1728000000000,  # 2024-10-01
        "endAt": now,
    })
    if all_stats:
        result["allTime"] = {
            "visitors": all_stats.get("visitors", 0),
            "pageviews": all_stats.get("pageviews", 0),
            "visits": all_stats.get("visits", 0),
        }

    # 2. 今日数据（北京时间 00:00 到现在）
    # 取今天 00:00（UTC+8）的毫秒
    import datetime
    beijing = datetime.timezone(datetime.timedelta(hours=8))
    today_start = datetime.datetime.now(beijing).replace(hour=0, minute=0, second=0, microsecond=0)
    today_ms = int(today_start.timestamp() * 1000)
    today_stats = paced_get(f"/api/websites/{WEBSITE_ID}/stats", {
        "startAt": today_ms,
        "endAt": now,
    })
    if today_stats:
        result["today"] = {
            "visitors": today_stats.get("visitors", 0),
            "pageviews": today_stats.get("pageviews", 0),
        }

    # 3. 90天每日数据（图表用，前端按 7/30/90 天切换）
    pv = paced_get(f"/api/websites/{WEBSITE_ID}/pageviews", {
        "startAt": ms(90),
        "endAt": now,
        "unit": "day",
    })
    if pv:
        result["daily"] = [
            {"date": p.get("x"), "pageviews": p.get("y", 0), "visitors": p.get("z", 0) if "z" in p else 0}
            for p in (pv.get("pageviews", []) if isinstance(pv, dict) else [])
        ]
        # pageviews 接口返回格式可能是 {pageviews: [...], sessions: [...]}
        if not result["daily"] and isinstance(pv, dict):
            result["daily"] = pv.get("pageviews", [])

    # 3.5 小时级数据（访客活跃时间热力图用，近30天按小时聚合）
    hourly = paced_get(f"/api/websites/{WEBSITE_ID}/pageviews", {
        "startAt": ms(30),
        "endAt": now,
        "unit": "hour",
    })
    if hourly:
        pv_list = hourly.get("pageviews", []) if isinstance(hourly, dict) else []
        result["hourly"] = [
            {"date": p.get("x"), "pageviews": p.get("y", 0)}
            for p in pv_list
        ]

    # 4. 热门页面（注意：Umami v2 用 type=path，不是 url）
    urls = paced_get(f"/api/websites/{WEBSITE_ID}/metrics", {
        "startAt": ms(30),
        "endAt": now,
        "type": "path",
    })
    if urls:
        result["topPages"] = [
            {"url": u.get("x"), "views": u.get("y", 0)}
            for u in (urls if isinstance(urls, list) else [])
        ][:8]

    # 5. 设备
    devices = paced_get(f"/api/websites/{WEBSITE_ID}/metrics", {
        "startAt": ms(30),
        "endAt": now,
        "type": "device",
    })
    if devices:
        result["devices"] = [
            {"name": d.get("x"), "count": d.get("y", 0)}
            for d in (devices if isinstance(devices, list) else [])
        ]

    # 6. 浏览器
    browsers = paced_get(f"/api/websites/{WEBSITE_ID}/metrics", {
        "startAt": ms(30),
        "endAt": now,
        "type": "browser",
    })
    if browsers:
        result["browsers"] = [
            {"name": b.get("x"), "count": b.get("y", 0)}
            for b in (browsers if isinstance(browsers, list) else [])
        ]

    # 7. 地域（国家/地区）
    regions = paced_get(f"/api/websites/{WEBSITE_ID}/metrics", {
        "startAt": ms(30),
        "endAt": now,
        "type": "region",
    })
    if regions:
        result["regions"] = [
            {"name": r.get("x"), "count": r.get("y", 0)}
            for r in (regions if isinstance(regions, list) else [])
        ][:10]

    # 8. 来源
    referrers = paced_get(f"/api/websites/{WEBSITE_ID}/metrics", {
        "startAt": ms(30),
        "endAt": now,
        "type": "referrer",
    })
    if referrers:
        result["referrers"] = [
            {"name": r.get("x"), "count": r.get("y", 0)}
            for r in (referrers if isinstance(referrers, list) else [])
        ][:10]

    # 9. 实时在线
    realtime = paced_get(f"/api/realtime/{WEBSITE_ID}")
    if realtime:
        result["online"] = len(realtime) if isinstance(realtime, list) else 0

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"已写入 {OUTPUT}")
    print(f"累计: {result.get('allTime', {})}, 今日: {result.get('today', {})}")

if __name__ == "__main__":
    main()
