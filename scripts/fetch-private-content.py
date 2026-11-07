#!/usr/bin/env python3
"""构建前拉取私人内容：从私有仓 Misty-ui-source/lanerc-content 拉取
日记 / 动态 / 碎碎念配置（文章草稿不进，2026-11-07 站长定），写入构建目录的对应位置。

需要环境变量 PRIVATE_CONTENT_TOKEN（对 lanerc-content 只读的 fine-grained PAT）。
没有该变量时：仅警告并跳过（公开仓仍可独立构建，相关集合为空）。

写入纪律：临时文件 + 改名，避免覆盖写失败清零。
"""
import base64, json, os, sys, urllib.request, urllib.error

OWNER, REPO, BRANCH = "Misty-ui-source", "lanerc-content", "main"
TOKEN = os.environ.get("PRIVATE_CONTENT_TOKEN", "").strip()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def api(path):
    req = urllib.request.Request(f"https://api.github.com{path}", method="GET")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def write_atomic(dest, data: bytes):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp-fetch"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, dest)
    if os.path.getsize(dest) != len(data):
        raise RuntimeError(f"size mismatch after write: {dest}")


def main():
    if not TOKEN:
        print("[private-content] PRIVATE_CONTENT_TOKEN 未设置，跳过拉取（日记/动态/碎碎念将为空）")
        return
    ref = api(f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
    head = ref["object"]["sha"]
    tree = api(f"/repos/{OWNER}/{REPO}/git/trees/{head}?recursive=1")
    n = 0
    for it in tree["tree"]:
        p = it["path"]
        if it["type"] != "blob" or p == "README.md":
            continue
        d = api(f"/repos/{OWNER}/{REPO}/contents/{p}?ref={BRANCH}")
        write_atomic(os.path.join(ROOT, p), base64.b64decode(d["content"]))
        n += 1
    print(f"[private-content] 已拉取 {n} 个文件（{REPO}@{head[:8]}）")


if __name__ == "__main__":
    main()
