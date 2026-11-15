/*!
 * build.mjs — 把整个笔记库渲染成一个自包含的静态网页
 * 用法： node _预览/src/build.mjs [--check]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './markdown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = HERE;
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, '笔记预览.html');

const SKIP_DIRS = new Set(['_预览', 'node_modules', '.git', '.idea', '.vscode', '$RECYCLE.BIN', 'System Volume Information']);
const MD_EXT = /\.(md|markdown)$/i;
const isCheck = process.argv.includes('--check');

/* ---------------- 扫描 ---------------- */

function walk(dir, rel = '') {
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const relPath = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name), relPath));
    } else if (e.isFile()) {
      if (!MD_EXT.test(e.name) || e.name.startsWith('~$')) continue;
      out.push({ rel: relPath, abs: path.join(dir, e.name) });
    }
  }
  return out;
}

const toNative = (p) => p.replace(/\//g, path.sep);

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* ---------------- 链接 / 图片解析 ---------------- */

function normaliseDest(dest) {
  let d = String(dest || '').trim();
  if (d.startsWith('<') && d.endsWith('>')) d = d.slice(1, -1);
  return d.replace(/\\/g, '/');
}

function splitAnchor(d) {
  const idx = d.indexOf('#');
  return idx < 0 ? [d, ''] : [d.slice(0, idx), d.slice(idx + 1)];
}

function resolveRelative(fromDoc, destPath) {
  const fromDir = path.posix.dirname(fromDoc);
  const joined = path.posix.normalize(path.posix.join(fromDir === '.' ? '' : fromDir, destPath));
  return joined.replace(/^\.\//, '');
}

function isInsideRoot(abs) {
  const a = path.resolve(abs).toLowerCase();
  const r = path.resolve(ROOT).toLowerCase();
  return a === r || a.startsWith(r + path.sep);
}

/** 把写死的绝对路径（D:\... 或 file:///D:/...）变成相对笔记根目录的路径 */
function toRootRelative(rawPath) {
  let p = String(rawPath || '').replace(/\\/g, '/');
  p = p.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '');
  p = safeDecode(p).replace(/^\/([A-Za-z]:\/)/, '$1');
  if (!/^[A-Za-z]:\//.test(p)) return null;
  const native = p.replace(/\//g, path.sep);
  return isInsideRoot(native) ? path.relative(ROOT, native).replace(/\\/g, '/') : null;
}

function absoluteToFileUrl(rawPath) {
  const p = safeDecode(String(rawPath).replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '').replace(/^\/+/, ''));
  return 'file:///' + encodeURI(p);
}

function fileExists(rel) {
  try {
    return fs.statSync(path.join(ROOT, toNative(rel))).isFile();
  } catch {
    return false;
  }
}

function makeResolvers(existingDocs, stats) {
  const url = (rel) => encodeURI(rel);

  function resolveImage(dest, docPath) {
    const d = normaliseDest(dest);
    if (!d) return null;
    if (/^(data:|https?:|\/\/)/i.test(d)) {
      stats.imgRemote++;
      return { url: d };
    }
    const local = safeDecode(splitAnchor(d)[0]);
    if (!local) return null;

    const isAbsolute = /^file:/i.test(d) || /^[A-Za-z]:[\\/]/.test(local) || /^\/[A-Za-z]:\//.test(local);
    if (isAbsolute) {
      const rel = toRootRelative(local);
      if (rel && fileExists(rel)) {
        stats.imgOk++;
        return { url: url(rel) };
      }
      stats.imgMissing.push([docPath, dest]);
      return { url: absoluteToFileUrl(local) };
    }

    const rel = local.startsWith('/') ? local.slice(1) : resolveRelative(docPath || '', local);
    if (fileExists(rel)) {
      stats.imgOk++;
      return { url: url(rel) };
    }
    stats.imgMissing.push([docPath, dest]);
    return null;
  }

  function resolveLink(dest, docPath) {
    const d = normaliseDest(dest);
    if (!d) return { kind: 'broken', title: '空链接' };
    if (/^(https?:|mailto:|tel:)/i.test(d)) return { kind: 'external', href: d };

    if (d.startsWith('#')) {
      const anchor = safeDecode(d.slice(1));
      return { kind: 'doc', doc: docPath, anchor, href: '#' + docPath + (anchor ? '::' + anchor : '') };
    }

    const [rawPath, anchor] = splitAnchor(d);
    if (!rawPath) return { kind: 'doc', doc: docPath, anchor, href: '#' + docPath + '::' + anchor };

    const local = safeDecode(rawPath);
    let rel;
    if (/^file:/i.test(d) || /^[A-Za-z]:[\\/]/.test(local) || /^\/[A-Za-z]:\//.test(local)) {
      rel = toRootRelative(local);
      if (!rel) return { kind: 'file', href: absoluteToFileUrl(local), titleAttr: '本地文件（笔记库之外）' };
    } else if (local.startsWith('/')) {
      rel = local.slice(1);
    } else {
      rel = resolveRelative(docPath, local);
    }

    if (MD_EXT.test(rel)) {
      if (existingDocs.has(rel.toLowerCase())) {
        return {
          kind: 'doc',
          doc: rel,
          anchor,
          href: '#' + rel + (anchor ? '::' + anchor : ''),
          titleAttr: '打开 ' + rel
        };
      }
      return { kind: 'broken', title: '找不到：' + rel };
    }
    if (fileExists(rel)) return { kind: 'file', href: url(rel), titleAttr: '本地文件：' + rel };
    return { kind: 'broken', title: '找不到：' + (rel || d) };
  }

  return { resolveImage, resolveLink };
}

/* ---------------- 纯文本 ---------------- */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
  '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&times;': '×'
};

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countWords(plain) {
  const cjk = (plain.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (plain.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9_$]+/g) || []).length;
  return cjk + latin;
}

function unescapeAttr(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
}

/* ---------------- 排序 ---------------- */

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 单段比较：数字开头 → 英文开头 → 中文（拼音）→ 点开头 */
function segCompare(x, y) {
  const dotX = x.startsWith('.');
  const dotY = y.startsWith('.');
  if (dotX !== dotY) return dotX ? 1 : -1;
  const numX = /^\d/.test(x);
  const numY = /^\d/.test(y);
  if (numX !== numY) return numX ? -1 : 1;
  const latX = /^[A-Za-z]/.test(x);
  const latY = /^[A-Za-z]/.test(y);
  if (latX !== latY) return latX ? -1 : 1;
  return collator.compare(x, y);
}

/** 逐段比较路径，让同一层目录里「文件/文件夹」的排序一致 */
function pathCompare(a, b) {
  const as = a.split('/');
  const bs = b.split('/');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const c = segCompare(as[i], bs[i]);
    if (c !== 0) return c;
  }
  return as.length - bs.length;
}

/* ---------------- 主流程 ---------------- */

function build() {
  const t0 = Date.now();
  const files = walk(ROOT).sort((a, b) => pathCompare(a.rel, b.rel));
  const existingDocs = new Set(files.map((f) => f.rel.toLowerCase()));
  const stats = { imgOk: 0, imgRemote: 0, imgMissing: [], docLinks: 0, extLinks: 0, broken: [] };
  const { resolveImage, resolveLink } = makeResolvers(existingDocs, stats);

  const docs = [];
  const warnings = [];

  for (const f of files) {
    let raw = fs.readFileSync(f.abs, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

    const dir = path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel);
    const base = path.posix.basename(f.rel).replace(MD_EXT, '');
    const { html, headings } = renderMarkdown(raw, { docPath: f.rel, resolveImage, resolveLink });
    const st = fs.statSync(f.abs);
    const plain = htmlToText(html);

    const h1s = headings.filter((h) => h.level === 1);
    const title = ((h1s[0] && h1s[0].text) || base).trim() || base;
    const toc = headings
      .filter((h) => h.level === 2 || h.level === 3 || (h1s.length > 1 && h.level === 1))
      .slice(0, 150);

    docs.push({
      p: f.rel,
      t: title,
      d: dir,
      b: base,
      h: html,
      c: toc.map((x) => [x.level, x.text, x.id]),
      x: plain,
      w: countWords(plain),
      m: st.mtimeMs,
      s: st.size
    });

    stats.docLinks += (html.match(/class="doc-link"/g) || []).length;
    stats.extLinks += (html.match(/target="_blank"/g) || []).length;
    for (const m of html.matchAll(/data-broken="([^"]*)"/g)) stats.broken.push([f.rel, unescapeAttr(m[1])]);

    const textOnly = html
      .replace(/<pre[\s\S]*?<\/pre>/g, '')
      .replace(/<code[\s\S]*?<\/code>/g, '')
      .replace(/<[^>]+>/g, '');
    if (!plain.trim()) warnings.push('空文档: ' + f.rel);
    if (/```/.test(html)) warnings.push('残留围栏: ' + f.rel);
    if (/\]\(/.test(textOnly)) warnings.push('残留链接: ' + f.rel);
    if (/\*\*[^*\n]+\*\*/.test(textOnly)) warnings.push('残留加粗: ' + f.rel);
  }

  const version = crypto
    .createHash('sha1')
    .update(docs.map((d) => d.p + d.m + d.s).join('|'))
    .digest('hex')
    .slice(0, 8);

  const payload = { built: new Date().toISOString(), version, root: ROOT, docs };

  if (isCheck) {
    report(docs, warnings, stats, t0);
    return payload;
  }

  const tpl = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8');
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');

  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const html = tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__DATA__*/', () => 'window.__NOTES__ = ' + json + ';')
    .replace('/*__APP__*/', () => app)
    .replace(/__COUNT__/g, String(docs.length))
    .replace(/__BUILT__/g, new Date().toLocaleString('zh-CN', { hour12: false }))
    .replace(/__VERSION__/g, version);

  fs.writeFileSync(OUT, html, 'utf8');

  report(docs, warnings, stats, t0);
  console.log('\n✔ 已生成：' + OUT);
  console.log('  体积：' + (Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2) + ' MB');

  if (process.argv.includes('--open')) {
    try {
      spawn('cmd.exe', ['/c', 'start', '', OUT], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* 打不开浏览器就忽略 */
    }
  }
  return payload;
}

function report(docs, warnings, stats, t0) {
  const totalWords = docs.reduce((a, d) => a + d.w, 0);
  const totalChars = docs.reduce((a, d) => a + d.x.length, 0);
  console.log('文档：' + docs.length + ' 篇');
  console.log('字数：' + totalWords + '（纯文本 ' + (totalChars / 1024).toFixed(0) + ' KB）');
  console.log('耗时：' + (Date.now() - t0) + ' ms');
  console.log('图片：' + stats.imgOk + ' 正常 / ' + stats.imgMissing.length + ' 缺失 / ' + stats.imgRemote + ' 远程');
  console.log('链接：' + stats.docLinks + ' 内部 / ' + stats.extLinks + ' 外部 / ' + stats.broken.length + ' 失效');
  if (stats.imgMissing.length) {
    console.log('\n图片缺失（笔记里引用了但文件不在）：');
    for (const [doc, dest] of stats.imgMissing.slice(0, 6)) console.log('  ' + doc + '  →  ' + dest);
  }
  if (stats.broken.length) {
    console.log('\n失效链接：');
    for (const [doc, dest] of stats.broken.slice(0, 6)) console.log('  ' + doc + '  →  ' + dest);
  }
  if (warnings.length) {
    console.log('\n⚠ 检查项（' + warnings.length + '）：');
    for (const w of warnings.slice(0, 25)) console.log('  ' + w);
  } else {
    console.log('\n✔ 无异常');
  }
}

build();
