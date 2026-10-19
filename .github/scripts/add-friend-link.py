#!/usr/bin/env python3
"""从 GitHub Issue 解析友链申请，更新 friendsConfig.ts"""
import re
import sys
import os

def parse_issue_body(body: str) -> dict:
    """解析 Issue 表单内容"""
    result = {}
    # 匹配 "### 网站名称\n\nAlexander" 这种格式
    patterns = {
        'site-name': r'### 网站名称\s*\n\s*(.+?)(?=\n###|\Z)',
        'site-url': r'### 网站链接\s*\n\s*(.+?)(?=\n###|\Z)',
        'site-desc': r'### 网站描述\s*\n\s*(.+?)(?=\n###|\Z)',
        'site-avatar': r'### 网站头像 URL\s*\n\s*(.+?)(?=\n###|\Z)',
        'site-rss': r'### RSS 订阅地址.*?\s*\n\s*(.+?)(?=\n###|\Z)',
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, body, re.DOTALL)
        if m:
            result[key] = m.group(1).strip()
            # 清理可能的 "_No response_" 
            if result[key] == "_No response_":
                result[key] = ""
    return result

def add_friend_to_config(config_path: str, info: dict) -> bool:
    """添加友链到配置文件，返回是否成功（去重）"""
    with open(config_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 去重：检查 siteurl 是否已存在
    if info['site-url'].rstrip('/') in content or info['site-url'] in content:
        print(f"友链已存在，跳过：{info['site-url']}")
        return False
    
    # 构造新条目（weight 设为 1，放在末尾区域）
    rss_line = f'\n\t\trss: "{info["site-rss"]}",' if info.get('site-rss') else ''
    new_entry = f'''\t{{
\t\ttitle: "{info['site-name']}",
\t\timgurl: "{info['site-avatar']}",
\t\tdesc: "{info['site-desc']}",
\t\tsiteurl: "{info['site-url']}",
\t\ttags: ["Blog"],
\t\tweight: 1,
\t\tenabled: true,{rss_line}
\t}},
];'''
    
    # 在最后一个 "];" 前插入（friendsConfig 数组结尾）
    # 找到 "];" 的最后一次出现（在 getEnabledFriends 之前）
    old_tail = "\t},\n];"
    if old_tail not in content:
        print("未找到 friendsConfig 数组结尾")
        return False
    
    # 替换最后一个
    idx = content.rfind(old_tail)
    new_content = content[:idx] + new_entry.replace("];", "},") + content[idx + len("\t},\n"):]
    # 上面逻辑复杂，直接用简单替换：把 "\t},\n];" 换成新条目 + "];"
    
    # 更简单的方法
    with open(config_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 在 UpXuu/浅小兮之后插入（找到最后一个 weight: 1 的条目）
    # 实际用：在 "];\n\n// 获取启用的友链" 前插入
    marker = "];\n\n// 获取启用的友链"
    if marker not in content:
        print("未找到插入标记")
        return False
    
    entry = f'''\t{{
\t\ttitle: "{info['site-name']}",
\t\timgurl: "{info['site-avatar']}",
\t\tdesc: "{info['site-desc']}",
\t\tsiteurl: "{info['site-url']}",
\t\ttags: ["Blog"],
\t\tweight: 1,
\t\tenabled: true,{rss_line}
\t}},
'''
    new_content = content.replace(marker, entry + marker)
    
    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"已添加友链：{info['site-name']} ({info['site-url']})")
    return True

if __name__ == '__main__':
    body = sys.stdin.read()
    info = parse_issue_body(body)
    
    required = ['site-name', 'site-url', 'site-desc', 'site-avatar']
    for r in required:
        if not info.get(r):
            print(f"缺少必填字段：{r}")
            sys.exit(1)
    
    config_path = os.path.join(
        os.path.dirname(__file__), 
        '../../src/config/friendsConfig.ts'
    )
    success = add_friend_to_config(config_path, info)
    sys.exit(0 if success else 2)
