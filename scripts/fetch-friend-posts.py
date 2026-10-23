#!/usr/bin/env python3
"""抓取友链 RSS，生成朋友圈聚合数据。

从 src/config/friendsConfig.ts 读取带 rss 字段的友链，
抓取各自 RSS，输出到 src/data/friend-posts.json。
构建时运行，失败不中断构建（保留旧数据）。
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "src" / "config" / "friendsConfig.ts"
OUTPUT = ROOT / "src" / "data" / "friend-posts.json"
MAX_PER_FEED = 10  # 每个站点最多取 10 篇


def parse_friends():
    text = CONFIG.read_text(encoding="utf-8")
    # 简单解析：找 title / imgurl / siteurl / rss 四元组
    pattern = re.compile(
        r'title:\s*"([^"]+)"[^{]*?imgurl:\s*"([^"]+)"[^{]*?siteurl:\s*"([^"]+)"[^{]*?rss:\s*"([^"]+)"',
        re.DOTALL,
    )
    friends = []
    for m in pattern.finditer(text):
        friends.append({
            "name": m.group(1),
            "avatar": m.group(2),
            "site": m.group(3),
            "rss": m.group(4),
        })
    return friends


def fetch_rss(url, timeout=15):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; lanerc.me friend-circle bot)",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    # 尝试常见格式
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def strip_html(html):
    text = re.sub(r"<[^>]+>", "", html or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:200]


def parse_feed(xml_bytes, source_name, source_site, source_avatar):
    posts = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return posts

    # RSS 2.0
    items = root.findall(".//item")
    # Atom
    if not items:
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            title = (entry.findtext("atom:title", namespaces=ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.get("href", "") if link_el is not None else ""
            if not link:
                link = entry.findtext("atom:id", namespaces=ns) or ""
            published = (
                entry.findtext("atom:published", namespaces=ns)
                or entry.findtext("atom:updated", namespaces=ns)
            )
            summary = (
                entry.findtext("atom:summary", namespaces=ns)
                or entry.findtext("atom:content", namespaces=ns)
                or ""
            )
            posts.append({
                "title": title,
                "link": link,
                "date": parse_date(published),
                "excerpt": strip_html(summary),
                "source": source_name,
                "source_site": source_site,
                "avatar": source_avatar,
            })
            if len(posts) >= MAX_PER_FEED:
                break
        return posts

    for item in items[:MAX_PER_FEED]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = item.findtext("pubDate") or item.findtext("dc:date")
        desc = item.findtext("description") or ""
        posts.append({
            "title": title,
            "link": link,
            "date": parse_date(pub),
            "excerpt": strip_html(desc),
            "source": source_name,
            "source_site": source_site,
            "avatar": source_avatar,
        })
    return posts


def main():
    friends = parse_friends()
    print(f"找到 {len(friends)} 个带 RSS 的友链", flush=True)

    all_posts = []
    ok_sources = 0
    for f in friends:
        try:
            xml = fetch_rss(f["rss"])
            posts = parse_feed(xml, f["name"], f["site"], f["avatar"])
            print(f"  ✓ {f['name']}: {len(posts)} 篇", flush=True)
            all_posts.extend(posts)
            if posts:
                ok_sources += 1
        except Exception as e:
            print(f"  ✗ {f['name']}: {e}", flush=True)

    # 按日期倒序
    all_posts.sort(key=lambda p: p["date"] or "", reverse=True)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(all_posts),
        "sources": ok_sources,
        "posts": all_posts,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"共 {len(all_posts)} 篇，来自 {ok_sources} 个站点，已写入 {OUTPUT}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 任何未预期异常都不中断构建：保留旧数据，退出码 0
        print(f"fetch-friend-posts 异常（已忽略，不影响构建）: {e}", flush=True)
    sys.exit(0)
