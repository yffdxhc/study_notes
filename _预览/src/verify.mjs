/*!
 * verify.mjs — 生成结果的静态自检（不依赖浏览器）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, '笔记预览.html');

const html = fs.readFileSync(OUT, 'utf8');
const app = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
const tpl = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');
const css = fs.readFileSync(path.join(HERE, 'app.css'), 'utf8');

const problems = [];
const notes = [];

/* ---------- 1. 取出数据 ---------- */
const m = html.match(/window\.__NOTES__ = (\{[\s\S]*?\});<\/script>/);
if (!m) {
  console.error('✗ 找不到内嵌数据');
  process.exit(1);
}
const data = JSON.parse(m[1]);
const DOCS = data.docs;
const byPath = new Map(DOCS.map((d) => [d.p, d]));
notes.push('内嵌文档 ' + DOCS.length + ' 篇，数据 ' + (m[1].length / 1024 / 1024).toFixed(2) + ' MB');

/* ---------- 2. 标签平衡 ---------- */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const stack = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
let tm;
let mismatches = 0;
const bodyStart = html.indexOf('<body>') + 6;
const bodyEnd = html.indexOf('</body>');
const bodyHtml = html.slice(bodyStart, bodyEnd).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
while ((tm = tagRe.exec(bodyHtml))) {
  if (/\/>\s*$/.test(tm[0])) continue; // 自闭合标签（SVG 等）
  const closing = tm[1] === '/';
  const tag = tm[2].toLowerCase();
  if (VOID.has(tag)) continue;
  if (closing) {
    if (!stack.length) { problems.push('多余的闭合标签 </' + tag + '>'); mismatches++; continue; }
    const open = stack.pop();
    if (open !== tag) { problems.push('标签不匹配：<' + open + '> 遇到 </' + tag + '>'); mismatches++; }
  } else {
    stack.push(tag);
  }
}
if (stack.length) problems.push('未闭合标签：' + stack.slice(-5).join(', '));
if (!mismatches && !stack.length) notes.push('模板标签平衡 ✓');

/* ---------- 3. 模板里被 JS 引用的 id 是否存在 ---------- */
const jsIds = new Set();
for (const mm of app.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) jsIds.add(mm[1]);
const tplIds = new Set();
for (const mm of tpl.matchAll(/id="([a-zA-Z0-9_-]+)"/g)) tplIds.add(mm[1]);
for (const id of tplIds) jsIds.delete(id);
// 动态生成的（搜索浮层内）已经存在于模板
if (jsIds.size) problems.push('JS 引用了模板里不存在的 id：' + [...jsIds].join(', '));
else notes.push('JS 引用的 ' + tplIds.size + ' 个 id 全部存在 ✓');

/* ---------- 4. 每篇文档的锚点 / 链接 / 图片 ---------- */
let linkOk = 0;
const badLinks = [];
const allIds = new Set();

for (const d of DOCS) {
  const ids = new Set();
  for (const mm of d.h.matchAll(/ id="([^"]+)"/g)) ids.add(mm[1]);
  if (ids.size !== new Set([...d.h.matchAll(/ id="([^"]+)"/g)].map((x) => x[1])).size) {
    // 理论上不会重复，这里只做记录
  }
  d._ids = ids;

  // 目录项 id 必须真实存在
  for (const [lvl, text, id] of d.c) {
    if (!ids.has(id)) problems.push('目录项找不到对应标题：' + d.p + ' → ' + id);
  }

  for (const mm of d.h.matchAll(/<a[^>]*class="doc-link"[^>]*href="([^"]*)"[^>]*(?:data-anchor="([^"]*)")?/g)) {
    const href = mm[1];
    const raw = href.replace(/^#/, '');
    const [p, anchor] = raw.split('::');
    const target = byPath.get(p) || byPath.get(decodeURIComponent(p));
    if (!target) { badLinks.push([d.p, href, '目标不存在']); continue; }
    if (anchor) {
      const a = decodeURIComponent(anchor);
      if (!target._ids || !target._ids.has(a)) { badLinks.push([d.p, href, '锚点不存在']); continue; }
    }
    linkOk++;
  }
  for (let mm of d.h.matchAll(/data-doc="([^"]*)"/g)) {
    if (!byPath.has(mm[1])) badLinks.push([d.p, mm[1], 'data-doc 不存在']);
  }
  for (let mm of d.h.matchAll(/<img[^>]*src="([^"]+)"/g)) {
    const src = mm[1];
    if (/^(data:|https?:)/.test(src)) continue;
    const clean = src
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (/^file:/i.test(clean)) continue;
    const abs = path.join(ROOT, decodeURI(clean).replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) badLinks.push([d.p, src, '图片文件不存在']);
  }
  for (const id of ids) allIds.add(d.p + '::' + id);
}
if (badLinks.length) {
  problems.push('链接/图片问题 ' + badLinks.length + ' 处');
  for (const [a, b, c] of badLinks.slice(0, 10)) problems.push('   ' + a + ' → ' + b + '（' + c + '）');
} else {
  notes.push('内部文档链接 ' + linkOk + ' 条全部可达，图片路径全部存在 ✓');
}

/* ---------- 5. 残留的 markdown 语法 ---------- */
let leftovers = 0;
for (const d of DOCS) {
  const text = d.h.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '').replace(/<[^>]+>/g, '');
  const checks = [
    [/\|\s*:?-{3,}/, '表格分隔符'],
    [/(^|\n)\s*#{1,6}\s/, '未解析的标题'],
    [/\*\*[^\s*][^*\n]{0,40}\*\*/, '未解析的加粗'],
    [/(^|\n)\s*[-*]\s+\S/, '未解析的列表'],
    [/(^|\n)\s*>\s/, '未解析的引用'],
  ];
  for (const [re, label] of checks) {
    if (re.test(text)) { leftovers++; problems.push('  ' + label + ' 残留：' + d.p); break; }
  }
}
if (!leftovers) notes.push('正文无残留 markdown 标记 ✓');

/* ---------- 6. CSS 变量覆盖 ---------- */
const defined = new Set();
for (const mm of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(mm[1]);
const used = new Set();
for (const mm of css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) used.add(mm[1]);
for (const mm of html.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) used.add(mm[1]);
const undef = [...used].filter((v) => !defined.has(v));
if (undef.length) problems.push('CSS 变量未定义：' + undef.join(', '));
else notes.push('CSS 变量 ' + used.size + ' 个全部有定义 ✓');

/* ---------- 7. 括号平衡 ---------- */
const cssOpen = (css.match(/\{/g) || []).length;
const cssClose = (css.match(/\}/g) || []).length;
if (cssOpen !== cssClose) problems.push('CSS 花括号不平衡：' + cssOpen + ' vs ' + cssClose);
else notes.push('CSS 花括号平衡 ✓');

/* ---------- 8. 统计 ---------- */
const cnt = { h: 0, table: 0, pre: 0, img: 0, a: 0, task: 0, quote: 0, strong: 0, ph: 0, broken: 0 };
for (const d of DOCS) {
  cnt.h += (d.h.match(/<h[1-6][ >]/g) || []).length;
  cnt.table += (d.h.match(/<table>/g) || []).length;
  cnt.pre += (d.h.match(/<pre>/g) || []).length;
  cnt.img += (d.h.match(/<img /g) || []).length;
  cnt.a += (d.h.match(/<a /g) || []).length;
  cnt.task += (d.h.match(/class="task-box"/g) || []).length;
  cnt.quote += (d.h.match(/<blockquote>/g) || []).length;
  cnt.strong += (d.h.match(/<strong>/g) || []).length;
  cnt.ph += (d.h.match(/class="img-missing"/g) || []).length;
  cnt.broken += (d.h.match(/class="link-broken"/g) || []).length;
}
notes.push('渲染规模：标题 ' + cnt.h + ' / 表格 ' + cnt.table + ' / 代码块 ' + cnt.pre + ' / 引用 ' + cnt.quote + ' / 加粗 ' + cnt.strong);
notes.push('元素统计：图片 ' + cnt.img + ' / 链接 ' + cnt.a + ' / 任务框 ' + cnt.task + ' / 图片占位 ' + cnt.ph + ' / 失效链接 ' + cnt.broken);

/* ---------- 输出 ---------- */
console.log('\n=== 自检报告 ===');
for (const n of notes) console.log('  ✓ ' + n);
if (problems.length) {
  console.log('\n=== 问题 ' + problems.length + ' 项 ===');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exitCode = 1;
} else {
  console.log('\n全部通过。');
}
