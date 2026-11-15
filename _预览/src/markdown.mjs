/*!
 * markdown.mjs — 零依赖 Markdown 渲染器（CommonMark 子集 + GFM 表格/任务列表/删除线）
 *
 * 设计取舍：为「中文技术笔记」优化——表格多、围栏代码多、`<br>` 内联、Typora 风格锚点。
 * 不追求 100% 规范对齐，只保证这些文档渲染正确、不吞内容。
 */

import { highlight } from './highlight.mjs';

/* ---------------- 基础工具 ---------------- */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const CJK = /[\u2e80-\u303f\u3040-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3000-\u3009]/;
const CJK_END = /[\u2e80-\u303f\u3040-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;
const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

function expandTabs(line) {
  if (!line.includes('\t')) return line;
  let out = '';
  let col = 0;
  for (const ch of line) {
    if (ch === '\t') {
      const n = 4 - (col % 4);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

export function slugify(text) {
  let s = String(text)
    .toLowerCase()
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim()
    .replace(/[^\p{L}\p{N}\s.\-]/gu, '')
    .replace(/\./g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

/** 去掉行内 markdown 标记，得到纯文本（用于目录、搜索） */
export function stripInline(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------- 块级识别 ---------------- */

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const RE_ATX = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const RE_QUOTE = /^ {0,3}>/;
const RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RE_TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;
const RE_HTML_BLOCK = /^ {0,3}<(?:!--|\/?)(?:div|table|thead|tbody|tr|td|th|p|details|summary|figure|figcaption|section|article|aside|header|footer|pre|script|style|blockquote|ul|ol|li|dl|dt|dd|h[1-6]|iframe|video|audio|canvas|center|font|span)\b/i;

function isBlank(l) {
  return !l || !l.trim();
}

function isTableStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  const head = lines[i];
  if (!head.includes('|')) return false;
  return RE_TABLE_DELIM.test(lines[i + 1]);
}

function isBlockStart(lines, i) {
  const l = lines[i];
  if (RE_FENCE.test(l)) return true;
  if (RE_ATX.test(l)) return true;
  if (RE_HR.test(l)) return true;
  if (RE_QUOTE.test(l)) return true;
  if (RE_LIST.test(l)) return true;
  if (isTableStart(lines, i)) return true;
  if (RE_HTML_BLOCK.test(l)) return true;
  return false;
}

/* ---------------- 主入口 ---------------- */

/**
 * @param {string} src markdown 原文
 * @param {object} ctx  { docPath, resolveLink(dest, kind), resolveImage(src), headingPrefix }
 * @returns {{html:string, headings:Array<{level:number,text:string,id:string}>}}
 */
export function renderMarkdown(src, ctx = {}) {
  const text = String(src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map(expandTabs);
  const headings = [];
  const usedIds = Object.create(null);
  const env = {
    ctx,
    headings,
    id(text) {
      const base = slugify(text);
      let id = base;
      let k = 1;
      while (usedIds[id]) id = base + '-' + k++;
      usedIds[id] = true;
      return id;
    },
  };
  const html = renderBlocks(lines, env, { tight: false, inList: false });
  return { html, headings };
}

/* ---------------- 块级渲染 ---------------- */

function renderBlocks(lines, env, opts = {}) {
  const out = [];
  const n = lines.length;
  let i = 0;

  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    /* --- 围栏代码 --- */
    let m = RE_FENCE.exec(line);
    if (m) {
      const ch = m[1][0];
      const len = m[1].length;
      const info = (m[2] || '').trim();
      const lang = (info.split(/[\s{]/)[0] || '').toLowerCase();
      const body = [];
      let j = i + 1;
      const closer = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + len + ',}[ \\t]*$');
      while (j < n && !closer.test(lines[j])) {
        body.push(lines[j]);
        j++;
      }
      out.push(codeBlock(body.join('\n'), lang));
      i = j + 1;
      continue;
    }

    /* --- 分隔线 --- */
    if (RE_HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    /* --- ATX 标题 --- */
    m = RE_ATX.exec(line);
    if (m) {
      const level = m[1].length;
      let content = m[2].replace(/\s+#+\s*$/, '').trim();
      out.push(heading(level, content, env));
      i++;
      continue;
    }

    /* --- Setext 标题（下一行 === / --- ） --- */
    if (i + 1 < n && !isBlockStart(lines, i) && !isTableStart(lines, i)) {
      const sm = RE_SETEXT.exec(lines[i + 1]);
      if (sm && !isBlank(line)) {
        const level = sm[1][0] === '=' ? 1 : 2;
        out.push(heading(level, line.trim(), env));
        i += 2;
        continue;
      }
    }

    /* --- 引用块 --- */
    if (RE_QUOTE.test(line)) {
      const body = [];
      let j = i;
      while (j < n) {
        const l = lines[j];
        if (RE_QUOTE.test(l)) {
          body.push(l.replace(/^ {0,3}>[ ]?/, ''));
          j++;
          continue;
        }
        if (isBlank(l) && j + 1 < n && RE_QUOTE.test(lines[j + 1])) {
          body.push('');
          j++;
          continue;
        }
        break;
      }
      const inner = renderBlocks(body, env, { tight: false, inList: opts.inList });
      out.push('<blockquote>\n' + inner + '\n</blockquote>');
      i = j;
      continue;
    }

    /* --- 列表 --- */
    if (RE_LIST.test(line)) {
      const r = renderList(lines, i, env);
      out.push(r.html);
      i = r.next;
      continue;
    }

    /* --- 表格 --- */
    if (isTableStart(lines, i)) {
      const r = renderTable(lines, i, env);
      out.push(r.html);
      i = r.next;
      continue;
    }

    /* --- HTML 块（原样透传） --- */
    if (RE_HTML_BLOCK.test(line)) {
      const body = [];
      let j = i;
      while (j < n && !isBlank(lines[j])) { body.push(lines[j]); j++; }
      out.push(body.join('\n'));
      i = j;
      continue;
    }

    /* --- 段落 --- */
    const buf = [];
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) break;
      if (buf.length && isBlockStart(lines, i)) break;
      if (buf.length && RE_SETEXT.test(l)) break;
      buf.push(l.replace(/^[ \t]+/, ''));
      i++;
    }
    if (!buf.length) { i++; continue; }
    const inlineHtml = renderInline(buf.join('\n'), env);
    out.push(opts.tight ? inlineHtml : '<p>' + inlineHtml + '</p>');
  }

  return out.join('\n');
}

function heading(level, content, env) {
  const plain = stripInline(content);
  const id = env.id(plain);
  env.headings.push({ level, text: plain, id });
  const anchorHref = '#' + (env.ctx.docPath || '') + '::' + id;
  return (
    '<h' + level + ' id="' + escapeHtml(id) + '">' +
    renderInline(content, env, true) +
    '<a class="h-anchor" href="' + escapeHtml(anchorHref) + '" title="本节链接">#</a>' +
    '</h' + level + '>'
  );
}

function codeBlock(code, lang) {
  const cls = 'code-block' + (lang ? ' has-lang' : '');
  const head = lang ? '<div class="code-head"><span class="code-lang">' + escapeHtml(lang) + '</span></div>' : '';
  return (
    '<div class="' + cls + '" data-lang="' + escapeHtml(lang || '') + '">' +
    head +
    '<button class="code-copy" type="button" title="复制代码">复制</button>' +
    '<pre><code class="language-' + escapeHtml(lang || 'text') + '">' + highlight(code, lang) + '</code></pre>' +
    '</div>'
  );
}

/* ---------------- 列表 ---------------- */

function renderList(lines, start, env) {
  const first = RE_LIST.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  let j = start;
  let pendingBlanks = 0;
  const n = lines.length;

  while (j < n) {
    const line = lines[j];
    if (isBlank(line)) { pendingBlanks++; j++; continue; }

    const m = RE_LIST.exec(line);
    const sameKind = m && /\d/.test(m[2]) === ordered && m[1].length <= baseIndent + 1;
    if (sameKind) {
      if (items.length && pendingBlanks > 0) loose = true;
      pendingBlanks = 0;
      const contentIndent = m[1].length + m[2].length + Math.max(1, m[3].length);
      items.push({ lines: [m[4]], contentIndent });
      j++;
      continue;
    }

    if (!items.length) break;
    const cur = items[items.length - 1];
    const indent = /^ */.exec(line)[0].length;

    if (isBlank(line)) continue;

    if (pendingBlanks > 0 && indent >= cur.contentIndent) {
      cur.lines.push('');
      loose = true;
      pendingBlanks = 0;
    } else if (pendingBlanks > 0 && indent < cur.contentIndent) {
      // 列表之后的独立块
      if (isBlockStart(lines, j) || /^ {0,3}#{1,6}\s/.test(line)) break;
      cur.lines.push('');
      loose = true;
      pendingBlanks = 0;
    }
    pendingBlanks = 0;

    if (indent >= cur.contentIndent) {
      cur.lines.push(line.slice(cur.contentIndent));
      j++;
      continue;
    }
    if (indent > baseIndent) {
      cur.lines.push(line.slice(Math.min(indent, cur.contentIndent)));
      j++;
      continue;
    }
    if (isBlockStart(lines, j)) break;
    // 惰性续行
    cur.lines.push(line.trim());
    j++;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ' start="' + startNum + '"' : '';
  const lis = items.map((it) => {
    let task = null;
    const tm = /^\[([ xX])\][ \t]+(.*)$/.exec(it.lines[0] || '');
    if (tm) {
      task = tm[1].toLowerCase() === 'x';
      it.lines[0] = tm[2];
    }
    const inner = renderBlocks(it.lines, env, { tight: !loose, inList: true });
    const box = task === null ? '' : '<input type="checkbox" class="task-box" disabled' + (task ? ' checked' : '') + '>';
    return '<li' + (task === null ? '' : ' class="task-item"') + '>' + box + inner + '</li>';
  });

  return { html: '<' + tag + startAttr + ' class="md-list">\n' + lis.join('\n') + '\n</' + tag + '>', next: j };
}

/* ---------------- 表格 ---------------- */

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let tick = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '`') tick = 1 - tick;
    if (ch === '|' && !tick) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function renderTable(lines, start, env) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => {
    const t = c.trim();
    if (/^:-+:$/.test(t)) return 'center';
    if (/^-+:$/.test(t)) return 'right';
    if (/^:-+$/.test(t)) return 'left';
    return '';
  });
  const rows = [];
  let j = start + 2;
  while (j < lines.length && !isBlank(lines[j]) && lines[j].includes('|') && !RE_FENCE.test(lines[j])) {
    if (RE_ATX.test(lines[j]) || RE_HR.test(lines[j])) break;
    rows.push(splitRow(lines[j]));
    j++;
  }
  const th = head.map((c, k) => '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + renderInline(c, env) + '</th>');
  const tb = rows.map((cells) => {
    const tds = head.map((_, k) => '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + renderInline(cells[k] || '', env) + '</td>');
    return '<tr>' + tds.join('') + '</tr>';
  });
  const html =
    '<div class="table-wrap"><table>\n<thead><tr>' + th.join('') + '</tr></thead>\n<tbody>' +
    tb.join('\n') +
    '</tbody></table></div>';
  return { html, next: j };
}

/* ---------------- 行内渲染 ---------------- */

const RE_AUTOLINK = /^<((?:https?|mailto|ftp):[^<>\s]+)>/i;
const RE_MAILLINK = /^<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>/;
/* 只放行白名单标签，避免 Java 泛型 <T>、<String> 之类被当成 HTML 吞掉 */
const RE_HTAG = /^<\/?(?:br|b|i|u|s|em|strong|del|ins|mark|sup|sub|kbd|code|small|big|span|font|center|a|img|p|div|hr|details|summary|table|thead|tbody|tr|td|th|ul|ol|li|blockquote|pre|figure|figcaption|iframe|video|audio|source|picture)\b(?:\s[^<>]*)?\/?>/i;
const RE_COMMENT = /^<!--[\s\S]*?-->/;
const RE_BARE_URL = /^https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/;

function renderInline(text, env, inHeading = false) {
  let out = '';
  let plain = '';
  let i = 0;
  const n = text.length;
  const flush = () => { if (plain) { out += escapeHtml(plain); plain = ''; } };

  while (i < n) {
    const c = text[i];

    /* 转义 */
    if (c === '\\' && i + 1 < n && PUNCT.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    /* 行内代码 */
    if (c === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, i + run);
      if (close >= 0) {
        let inner = text.slice(i + run, close);
        if (inner.length > 1 && inner[0] === ' ' && inner[inner.length - 1] === ' ' && inner.trim()) {
          inner = inner.slice(1, -1);
        }
        flush();
        out += '<code>' + escapeHtml(inner) + '</code>';
        i = close + run;
        continue;
      }
    }

    /* 图片 */
    if (c === '!' && text[i + 1] === '[') {
      const parsed = parseLinkLike(text, i + 1);
      if (parsed) {
        flush();
        out += renderImage(parsed, env);
        i = parsed.end;
        continue;
      }
    }

    /* 链接 */
    if (c === '[') {
      const parsed = parseLinkLike(text, i);
      if (parsed) {
        flush();
        out += renderLink(parsed, env);
        i = parsed.end;
        continue;
      }
    }

    /* 自动链接 / 内联 HTML */
    if (c === '<') {
      const slice = text.slice(i);
      let m2 = RE_COMMENT.exec(slice);
      if (m2) { flush(); out += m2[0]; i += m2[0].length; continue; }
      m2 = RE_AUTOLINK.exec(slice);
      if (m2) {
        flush();
        out += '<a href="' + escapeHtml(m2[1]) + '" target="_blank" rel="noopener">' + escapeHtml(m2[1]) + '</a>';
        i += m2[0].length;
        continue;
      }
      m2 = RE_MAILLINK.exec(slice);
      if (m2) {
        flush();
        out += '<a href="mailto:' + escapeHtml(m2[1]) + '">' + escapeHtml(m2[1]) + '</a>';
        i += m2[0].length;
        continue;
      }
      m2 = RE_HTAG.exec(slice);
      if (m2 && !inHeading) {
        flush();
        out += m2[0];
        i += m2[0].length;
        continue;
      }
    }

    /* 强调 */
    if (c === '*' || c === '_' || c === '~' || c === '=') {
      const r = tryEmphasis(text, i, env, inHeading);
      if (r) { flush(); out += r.html; i = r.end; continue; }
    }

    /* 裸链接 */
    if (c === 'h' && RE_BARE_URL.test(text.slice(i))) {
      const prev = i === 0 ? '' : text[i - 1];
      if (!prev || /[\s([<"'“（]/.test(prev)) {
        const m2 = RE_BARE_URL.exec(text.slice(i));
        let url = m2[0];
        let tail = '';
        const trimmed = url.replace(/[.,;:。，；：、)】」』]+$/, '');
        if (trimmed !== url) tail = url.slice(trimmed.length);
        url = trimmed;
        flush();
        out += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>';
        plain += tail;
        i += m2[0].length;
        continue;
      }
    }

    /* 换行 */
    if (c === '\n') {
      const prev = text[i - 1] || '';
      const next = text[i + 1] || '';
      if (prev === ' ' && text[i - 2] === ' ') {
        out = out.replace(/ +$/, '');
        plain = plain.replace(/ +$/, '');
        flush();
        out += '<br>';
        i++;
        continue;
      }
      flush();
      if (CJK_END.test(prev) && !/[A-Za-z0-9]/.test(next)) {
        /* 中文之后的软换行直接吞掉，避免中文里出现多余空格 */
      } else if (/[A-Za-z0-9]/.test(prev) && CJK.test(next)) {
        /* 英文单词紧跟中文：保留一个空格 */
        out += ' ';
      } else {
        out += '\n';
      }
      i++;
      continue;
    }

    plain += c;
    i++;
  }
  flush();
  return out;
}

function tryEmphasis(text, i, env, inHeading) {
  const c = text[i];
  const three = text.slice(i, i + 3);
  const two = text.slice(i, i + 2);

  // ~~删除线~~
  if (two === '~~') return emphasise(text, i, 2, '~~', 'del', env, inHeading);
  // ==高亮==（要求两侧无空格、内容不含空格开头，避开 a == b）
  if (two === '==') return emphasise(text, i, 2, '==', 'mark', env, inHeading);
  // ***加粗斜体***（必须先于 ** 判断）
  if (three === '***') {
    const r = emphasise(text, i, 3, '***', 'strong-em', env, inHeading);
    if (r) return r;
  }
  // **加粗** / __加粗__
  if (two === '**') return emphasise(text, i, 2, '**', 'strong', env, inHeading);
  if (two === '__') return emphasise(text, i, 2, '__', 'strong', env, inHeading);
  // *斜体* / _斜体_
  if (c === '*') return emphasise(text, i, 1, '*', 'em', env, inHeading);
  if (c === '_') {
    const prev = text[i - 1] || '';
    if (/[A-Za-z0-9]/.test(prev)) return null;
    return emphasise(text, i, 1, '_', 'em', env, inHeading);
  }
  return null;
}

function emphasise(text, i, len, delim, tag, env, inHeading) {
  const start = i + len;
  const first = text[start];
  if (!first || first === ' ' || first === '\n' || first === '\t') return null;
  let search = start;
  while (true) {
    const close = text.indexOf(delim, search);
    if (close < 0) return null;
    if (close === start) { search = close + len; continue; }
    const before = text[close - 1];
    if (before === ' ' || before === '\n') { search = close + len; continue; }
    // 避免把 *** 拆成 ** + *
    if (len === 1 && (text[close - 1] === delim || text[close + 1] === delim)) { search = close + len; continue; }
    if (delim === '==' && text.slice(start, close).includes('=')) return null;
    if (delim === '_' && /[A-Za-z0-9]/.test(text[close + len] || '')) { search = close + len; continue; }
    const inner = text.slice(start, close);
    const innerHtml = renderInline(inner, env, inHeading);
    const cls = tag === 'strong-em' ? '<strong><em>' : '<' + tag + '>';
    const clsEnd = tag === 'strong-em' ? '</em></strong>' : '</' + tag + '>';
    return { html: cls + innerHtml + clsEnd, end: close + len };
  }
}

/** 找到与 text[start] === '[' 配对的 ']'（跳过行内代码与转义） */
function findLabelEnd(text, start) {
  let depth = 0;
  let j = start;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === '`') {
      let run = 1;
      while (text[j + run] === '`') run++;
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, j + run);
      j = close > 0 ? close + run : j + run;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return j; }
    j++;
  }
  return -1;
}

/**
 * 解析 [label](dest "title")
 * 注意：本笔记库链接里的**空格不编码**（Typora 写法），所以不能按 CommonMark
 * 在第一个空格处截断——一路扫到配对的 ')' 再拆 title。
 */
function parseLinkLike(text, start) {
  const close = findLabelEnd(text, start);
  if (close < 0) return null;
  const label = text.slice(start + 1, close);
  let k = close + 1;
  if (text[k] !== '(') return null;
  k++;
  while (text[k] === ' ' || text[k] === '\t' || text[k] === '\n') k++;

  let dest = '';
  let title = '';
  if (text[k] === '<') {
    const gt = text.indexOf('>', k);
    if (gt < 0) return null;
    dest = text.slice(k + 1, gt).trim();
    k = gt + 1;
    while (text[k] === ' ' || text[k] === '\t' || text[k] === '\n') k++;
    if (text[k] !== ')') {
      let q = '';
      if (text[k] === '"' || text[k] === "'") {
        q = text[k];
        const tc = text.indexOf(q, k + 1);
        if (tc < 0) return null;
        title = text.slice(k + 1, tc);
        k = tc + 1;
        while (text[k] === ' ' || text[k] === '\t') k++;
      }
    }
    if (text[k] !== ')') return null;
    return { label, dest, title, end: k + 1 };
  }

  let depth = 0;
  let end = -1;
  let m = k;
  while (m < text.length) {
    const ch = text[m];
    if (ch === '\\') { m += 2; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) { end = m; break; }
      depth--;
    }
    m++;
    if (m - k > 800) break;
  }
  // 兜底：路径里有不成对的 "(" 时（如未编码的文件名），取本行最后一个 ")"
  if (end < 0) {
    const lineEnd = text.indexOf('\n', k) < 0 ? text.length : text.indexOf('\n', k);
    const last = text.lastIndexOf(')', lineEnd);
    if (last >= k) end = last;
  }
  if (end < 0) return null;

  let inner = text.slice(k, end).trim();
  const tm = /^([\s\S]*?)\s+(?:"([^"]*)"|'([^']*)')$/.exec(inner);
  if (tm && tm[1].trim()) {
    dest = tm[1].trim();
    title = tm[2] !== undefined ? tm[2] : tm[3];
  } else {
    dest = inner;
  }
  return { label, dest, title, end: end + 1 };
}

function renderImage(parsed, env) {
  const alt = parsed.label || '';
  const res = env.ctx.resolveImage ? env.ctx.resolveImage(parsed.dest, env.ctx.docPath) : { url: parsed.dest };
  const url = res && res.url;
  if (!url) {
    return '<span class="img-missing" title="' + escapeHtml(parsed.dest) + '">⚠ 图片缺失：' + escapeHtml(alt || parsed.dest) + '</span>';
  }
  const title = parsed.title || (res.title || '');
  return (
    '<img class="md-img" src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '"' +
    (title ? ' title="' + escapeHtml(title) + '"' : '') +
    ' loading="lazy" decoding="async">'
  );
}

function renderLink(parsed, env) {
  const labelHtml = renderInline(parsed.label, env);
  const res = env.ctx.resolveLink
    ? env.ctx.resolveLink(parsed.dest, env.ctx.docPath)
    : { href: parsed.dest, kind: 'external' };

  if (!res || res.kind === 'broken') {
    const tip = res && res.title ? res.title : parsed.dest;
    return '<a class="link-broken" href="#" data-broken="' + escapeHtml(parsed.dest) + '" title="' + escapeHtml(tip) + '">' + labelHtml + '</a>';
  }
  if (res.kind === 'external') {
    return '<a href="' + escapeHtml(res.href) + '" target="_blank" rel="noopener noreferrer">' + labelHtml + '</a>';
  }
  if (res.kind === 'file') {
    return '<a href="' + escapeHtml(res.href) + '" target="_blank" rel="noopener" title="本地文件">' + labelHtml + '</a>';
  }
  // 内部文档
  const title = res.titleAttr ? ' title="' + escapeHtml(res.titleAttr) + '"' : '';
  return '<a class="doc-link" href="' + escapeHtml(res.href) + '" data-doc="' + escapeHtml(res.doc || '') + '"' + (res.anchor ? ' data-anchor="' + escapeHtml(res.anchor) + '"' : '') + title + '>' + labelHtml + '</a>';
}
