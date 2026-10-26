#!/usr/bin/env python3
"""构建时生成文章元信息索引，供 Muse管家 AI 回复服务查文章上下文"""
import os, re, json, glob

posts_dir = 'src/content/posts'
index = {}

for md_file in glob.glob(f'{posts_dir}/**/*.md', recursive=True):
    if md_file.endswith('.bak'):
        continue
    with open(md_file, 'r') as f:
        content = f.read()
    m = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
    if not m:
        continue
    fm = m.group(1)
    title = re.search(r'^title:\s*(.+)$', fm, re.MULTILINE)
    desc = re.search(r'^description:\s*(.+)$', fm, re.MULTILINE)
    pub = re.search(r'^published:\s*(.+)$', fm, re.MULTILINE)
    cat = re.search(r'^category:\s*(.+)$', fm, re.MULTILINE)
    tags = []
    tm = re.search(r'^tags:\s*\n((?:\s*-\s*.+\n?)+)', fm, re.MULTILINE)
    if tm:
        tags = [t.strip().lstrip('- ').strip('\"').strip("'") for t in tm.group(1).strip().split('\n')][:3]
    if not title:
        continue
    rel = os.path.relpath(md_file, posts_dir)[:-3]  # 去掉 .md
    parts = rel.split(os.sep)
    if parts[-1].lower() == 'index':
        parts = parts[:-1]
    slug = '/'.join(p.lower().replace(' ', '-') for p in parts)
    index[f'/posts/{slug}/'] = {
        'title': title.group(1).strip().strip('"').strip("'"),
        'description': desc.group(1).strip().strip('"').strip("'") if desc else '',
        'published': pub.group(1).strip()[:10] if pub else '',
        'category': cat.group(1).strip().strip('\"').strip("'") if cat else '',
        'tags': tags,
    }

os.makedirs('public/api', exist_ok=True)
with open('public/api/post-meta.json', 'w') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)
print(f"post-meta.json 已生成，共 {len(index)} 篇")
