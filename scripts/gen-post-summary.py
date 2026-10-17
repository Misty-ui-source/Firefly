#!/usr/bin/env python3
"""
构建时用 AI 给每篇文章生成一句话摘要，供 Muse管家 回复时参考。
需要 ZHIPU_API_KEY 环境变量。没有 key 时跳过，服务会降级用 description。
"""
import os, re, json, glob, requests, time

API_KEY = os.environ.get("ZHIPU_API_KEY", "")
API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
META_PATH = "public/api/post-meta.json"

def summarize(title, body_text):
    # 取正文前 3000 字，足够概括
    text = re.sub(r'!\[.*?\]\(.*?\)', '', body_text)  # 去图片
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)  # 去代码块
    text = text[:3000]
    r = requests.post(API_URL, headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }, json={
        "model": "glm-4-flash",
        "messages": [
            {"role": "system", "content": "你是一个博客文章摘要助手，为 AI 评论回复机器人准备文章背景。输出两句话：第一句概括这篇文章讲了什么（包含关键信息点：项目名、技术方案、核心观点）；第二句指出这篇文章最值得聊的 1-2 个点（作者的观点、亮点、槽点、或可能引发讨论的地方）。语气客观，只输出这两句话，不要加前缀。"},
            {"role": "user", "content": f"标题：{title}\n\n正文：\n{text}"},
        ],
        "max_tokens": 250,
        "temperature": 0.3,
    }, timeout=30)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()

def main():
    if not API_KEY:
        print("未设置 ZHIPU_API_KEY，跳过摘要生成")
        return
    if not os.path.exists(META_PATH):
        print(f"{META_PATH} 不存在，先跑 gen-post-meta.py")
        return

    with open(META_PATH) as f:
        index = json.load(f)

    # 读每篇文章正文
    for md_file in glob.glob('src/content/posts/*/*.md'):
        with open(md_file) as f:
            content = f.read()
        m = re.match(r'^---\n.*?\n---\n', content, re.DOTALL)
        body = content[m.end():] if m else content
        dirname = os.path.basename(os.path.dirname(md_file))
        slug = dirname.lower().replace(' ', '-')
        key = f'/posts/{slug}/'
        if key not in index:
            continue
        if index[key].get('summary'):
            print(f"跳过已有摘要: {index[key]['title']}")
            continue
        try:
            time.sleep(3)  # 避免触发限流
            summary = summarize(index[key]['title'], body)
            index[key]['summary'] = summary
            print(f"OK: {index[key]['title']} -> {summary[:40]}...")
        except Exception as e:
            print(f"FAIL: {index[key]['title']}: {e}")

    with open(META_PATH, 'w') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print("摘要已写入 post-meta.json")

if __name__ == '__main__':
    main()
