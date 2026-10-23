#!/usr/bin/env python3
"""
构建时拉取 Steam 游戏数据（对标 HY 9ll.uk/steam/ 的展示字段）
输出: src/data/steam-stats.json
用法: STEAM_API_KEY=xxx STEAM_ID=xxx python3 scripts/fetch-steam-stats.py
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

API_KEY = os.environ.get("STEAM_API_KEY", "")
STEAM_ID = os.environ.get("STEAM_ID", "")
BASE = "https://api.steampowered.com"
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "steam-stats.json")
BJ = timezone(timedelta(hours=8))

def api_get(path, params=None):
    params = params or {}
    params["key"] = API_KEY
    params["format"] = "json"
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; lanerc-blog-build)",
        })
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except Exception as e:
        print(f"Error {path}: {e}", file=sys.stderr)
        return None

def fmt_last_played(ts):
    if not ts:
        return ""
    try:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(BJ)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return ""

def main():
    if not API_KEY or not STEAM_ID:
        print("需要 STEAM_API_KEY 和 STEAM_ID 环境变量", file=sys.stderr)
        sys.exit(1)

    result = {"updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime())}

    # 1. 玩家信息
    player = api_get("/ISteamUser/GetPlayerSummaries/v0002/", {"steamids": STEAM_ID})
    if player:
        players = player.get("response", {}).get("players", [])
        if players:
            p = players[0]
            result["player"] = {
                "name": p.get("personaname", ""),
                "avatar": p.get("avatarfull", ""),
                "profileUrl": p.get("profileurl", ""),
                "status": p.get("personastate", 0),  # 0离线 1在线
            }
    time.sleep(1)

    # 2. 玩家等级
    level = api_get("/ISteamUser/GetSteamLevel/v1/", {"steamid": STEAM_ID})
    if level:
        result["playerLevel"] = level.get("response", {}).get("player_level", 0)
    time.sleep(1)

    # 3. 徽章数
    badges = api_get("/ISteamUser/GetBadges/v1/", {"steamid": STEAM_ID})
    if badges:
        result["badgeCount"] = len(badges.get("response", {}).get("badges", []))
    time.sleep(1)

    # 4. 拥有游戏（全部，按游玩时长排序）
    owned = api_get("/IPlayerService/GetOwnedGames/v0001/", {
        "steamid": STEAM_ID,
        "include_appinfo": True,
        "include_played_free_games": True,
    })
    if owned:
        games = owned.get("response", {}).get("games", [])
        result["gameCount"] = owned.get("response", {}).get("game_count", 0)
        result["totalPlaytime"] = sum(g.get("playtime_forever", 0) for g in games)
        games_sorted = sorted(games, key=lambda g: g.get("playtime_forever", 0), reverse=True)
        result["allGames"] = [
            {
                "appid": g["appid"],
                "name": g.get("name", ""),
                "playtime": g.get("playtime_forever", 0),  # 分钟
                "banner": f"https://cdn.akamai.steamstatic.com/steam/apps/{g['appid']}/header.jpg",
                "storeUrl": f"https://store.steampowered.com/app/{g['appid']}/",
                "lastPlayed": fmt_last_played(g.get("rtime_last_played", 0)),
            }
            for g in games_sorted
        ]
        # 兼容旧字段
        result["topGames"] = result["allGames"][:12]
    time.sleep(1)

    # 5. 最近游玩（两周内）
    recent = api_get("/IPlayerService/GetRecentlyPlayedGames/v0001/", {
        "steamid": STEAM_ID,
        "count": 10,
    })
    if recent:
        games = recent.get("response", {}).get("games", [])
        result["recentGames"] = [
            {
                "appid": g["appid"],
                "name": g.get("name", ""),
                "playtime2weeks": g.get("playtime_2weeks", 0),
            }
            for g in games
        ]
        result["playtime2weeks"] = sum(g.get("playtime_2weeks", 0) for g in games)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"已写入 {OUTPUT}")
    print(f"玩家: {result.get('player', {}).get('name')}, 等级: {result.get('playerLevel')}, "
          f"游戏数: {result.get('gameCount')}, 徽章: {result.get('badgeCount')}, "
          f"总时长: {result.get('totalPlaytime', 0)} 分钟")

if __name__ == "__main__":
    main()
