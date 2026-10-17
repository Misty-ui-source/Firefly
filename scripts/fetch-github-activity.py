#!/usr/bin/env python3
"""
构建时拉取 GitHub 全仓库推送数据
输出: src/data/github-activity.json
用法: python3 scripts/fetch-github-activity.py
需要: GitHub token 可选（环境变量 GITHUB_TOKEN，提高限额）
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

USERNAME = "Misty-ui-source"
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "github-activity.json")
TOKEN = os.environ.get("GITHUB_TOKEN", "")

def api_get(url, retries=3):
    headers = {
        "User-Agent": "lanerc-blog-build",
        "Accept": "application/vnd.github.v3+json",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read().decode("utf-8")
                if r.status == 202:
                    # GitHub 正在计算，等待重试
                    if i < retries - 1:
                        time.sleep(5)
                        continue
                    return None
                if not body.strip():
                    return None
                return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 202 and i < retries - 1:
                time.sleep(5)
                continue
            if e.code in (403, 429):
                print(f"Rate limit hit: {url}", file=sys.stderr)
                return None
            print(f"HTTP {e.code}: {url}", file=sys.stderr)
            return None
    return None

def main():
    # 1. 取公开仓库列表
    repos = api_get(f"https://api.github.com/users/{USERNAME}/repos?per_page=100&type=public")
    if not repos:
        print("无法获取仓库列表", file=sys.stderr)
        sys.exit(1)

    repo_names = [r["name"] for r in repos if not r.get("fork", False)]
    print(f"仓库: {repo_names}")

    # 2. 每个仓库取 52 周 commit_activity
    # commit_activity 返回 52 周 x 7 天的每天提交数
    weekly = {}  # week_timestamp -> [7天提交数]
    total_commits = 0
    last_push = None

    for name in repo_names:
        data = api_get(f"https://api.github.com/repos/{USERNAME}/{name}/stats/commit_activity")
        if not data:
            continue
        for w in data:
            ts = w["week"]
            days = w["days"]
            total_commits += w["total"]
            if ts not in weekly:
                weekly[ts] = [0]*7
            for d in range(7):
                weekly[ts][d] += days[d]
        # 取最近推送时间
        repo_info = api_get(f"https://api.github.com/repos/{USERNAME}/{name}")
        if repo_info and repo_info.get("pushed_at"):
            p = repo_info["pushed_at"]
            if not last_push or p > last_push:
                last_push = p
        time.sleep(1)  # 礼貌间隔

    # 3. 整理输出
    weeks = sorted(weekly.keys())
    heatmap = []
    for ts in weeks:
        heatmap.append({"week": ts, "days": weekly[ts]})

    # 计算连续推送天数（从今天往回数）
    result = {
        "username": USERNAME,
        "repos": repo_names,
        "totalCommits52w": total_commits,
        "lastPushAt": last_push,
        "heatmap": heatmap,  # 52周 x 7天
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime()),
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"已写入 {OUTPUT}，52周共 {total_commits} commits")

if __name__ == "__main__":
    main()
