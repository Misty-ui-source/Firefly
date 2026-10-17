#!/usr/bin/env python3
"""构建时生成文章元信息索引，供 Muse管家 AI 回复服务查文章上下文"""
import os, re, json, glob

posts_dir = 'src/content/posts'
index = {}

for md_file in glob.glob(f'{posts_dir}/*/*.md'):
    with open(md_file, 'r') as f:
        content = f.read()
    m = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
    if not m:
        continue
    fm = m.group(1)
    title = re.search(r'^title:\s*(.+)$', fm, re.MULTILINE)
    desc = re.search(r'^description:\s*(.+)$', fm, re.MULTILINE)
    if not title:
        continue
    dirname = os.path.basename(os.path.dirname(md_file))
    slug = dirname.lower().replace(' ', '-')
    index[f'/posts/{slug}/'] = {
        'title': title.group(1).strip().strip('"').strip("'"),
        'description': desc.group(1).strip().strip('"').strip("'") if desc else '',
    }

os.makedirs('public/api', exist_ok=True)
with open('public/api/post-meta.json', 'w') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)
print(f"post-meta.json 已生成，共 {len(index)} 篇")
