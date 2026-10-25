/* 友链申请自动处理：解析 Issue 表单内容，写入 src/config/friendsConfig.ts
 * 由 .github/workflows/friend-link-apply.yml 调用，无第三方依赖（Node 18+）。
 * 输入（环境变量）：ISSUE_BODY（Issue 正文）、ISSUE_NUMBER
 * 输出（GITHUB_OUTPUT）：applied=true/false、reason、name、siteurl
 * 申请本身不合规（缺字段/未勾确认/重复）时 applied=false 且 exit 0，由 workflow 回帖说明；
 * 程序异常才非 0 退出，让运行记录标红便于排查。 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const CONFIG = process.env.CONFIG_PATH || 'src/config/friendsConfig.ts';
const body = process.env.ISSUE_BODY || '';

function out(k, v) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v).replace(/\n/g, ' ')}\n`);
}
function notApplied(reason) {
  out('applied', 'false');
  out('reason', reason);
  console.log('NOT APPLIED:', reason);
  process.exit(0);
}

/* ---------- 解析 Issue 表单（GitHub 表单渲染成 ### 标题 + 内容） ---------- */
function parseSections(md) {
  const map = {};
  const parts = String(md).split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    if (nl < 0) continue;
    const head = part.slice(0, nl).trim();
    let val = part.slice(nl + 1).trim();
    if (val === '_No response_') val = '';
    map[head] = val;
  }
  return map;
}
const sec = parseSections(body);
const pick = (...heads) => {
  for (const h of heads) {
    for (const k of Object.keys(sec)) if (k.startsWith(h)) return sec[k];
  }
  return '';
};
const name = pick('网站名称', '站点名称').split('\n')[0].trim();
const siteurlRaw = pick('网站链接', '站点链接').split('\n')[0].trim();
const desc = pick('网站描述', '站点描述').replace(/\s*\n\s*/g, ' ').trim();
const avatar = pick('网站头像').split('\n')[0].trim();
const rss = pick('RSS').split('\n')[0].trim();
const confirmText = pick('确认事项') || body;

/* ---------- 校验 ---------- */
if (!/- \[x\]/i.test(confirmText)) notApplied('未勾选确认事项（需先在你的友链页添加本站链接）');
if (!name) notApplied('网站名称为空');
if (!/^https?:\/\/\S+$/i.test(siteurlRaw)) notApplied('网站链接不是有效的 http(s) 地址');
if (!desc) notApplied('网站描述为空');
if (!/^https?:\/\/\S+$/i.test(avatar)) notApplied('网站头像 URL 不是有效的 http(s) 地址');
if (rss && !/^https?:\/\/\S+$/i.test(rss)) notApplied('RSS 地址不是有效的 http(s) 地址');
const siteurl = siteurlRaw.endsWith('/') ? siteurlRaw : siteurlRaw + '/';

/* ---------- 读配置、查重、算权重 ---------- */
const src = readFileSync(CONFIG, 'utf8');
const arrMark = 'export const friendsConfig';
const ks = src.indexOf(arrMark);
if (ks < 0) { console.error('找不到 friendsConfig'); process.exit(1); }
const eq = src.indexOf('=', ks);
const openIdx = src.indexOf('[', eq);
if (openIdx < 0) { console.error('找不到友链数组'); process.exit(1); }

const norm = (u) => u.trim().replace(/\/+$/, '').toLowerCase();
const existing = [...src.matchAll(/siteurl:\s*"([^"]+)"/g)].map((m) => norm(m[1]));
if (existing.includes(norm(siteurl))) notApplied('这个站点已经在友链里了');
const weights = [...src.matchAll(/weight:\s*(-?\d+)/g)].map((m) => parseInt(m[1], 10));
const weight = (weights.length ? Math.max(...weights) : 0) + 1;

/* ---------- 拼新条目并插入数组开头 ---------- */
const q = (s) => `"${String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const entry = [
  '\t{',
  `\t\ttitle: ${q(name)},`,
  `\t\timgurl: ${q(avatar)},`,
  `\t\tdesc: ${q(desc)},`,
  `\t\tsiteurl: ${q(siteurl)},`,
  '\t\ttags: ["Blog"],',
  `\t\tweight: ${weight},`,
  '\t\tenabled: true,',
  `\t\trss: ${q(rss)},`,
  '\t},',
].join('\n');
const next = src.slice(0, openIdx + 1) + '\n' + entry + src.slice(openIdx + 1);
writeFileSync(CONFIG, next);

out('applied', 'true');
out('name', name);
out('siteurl', siteurl);
console.log(`APPLIED: ${name} (${siteurl}) weight=${weight}`);
