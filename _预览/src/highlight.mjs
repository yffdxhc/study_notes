/*!
 * highlight.mjs — 极简语法着色（零依赖）
 * 只做保守的 token 化：注释 / 字符串 / 数字 / 关键字 / 预处理器 / 注解。
 * 目标不是 IDE 级准确，而是「代码块不刺眼、结构能看出来」。
 */

const KW = {
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL nullptr',
  cpp: 'auto break case char const constexpr continue default do double else enum explicit extern float for friend goto if inline int long namespace new nullptr operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while bool true false class delete',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null',
  kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while by catch finally get set import init',
  dart: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get if implements import in is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
  bash: 'if then else elif fi for while do done case esac function return local export source echo cd set unset readonly exit shift in',
  powershell: 'if else elseif foreach for while do until switch function param return try catch finally throw begin process end filter in not',
  sql: 'select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as and or not null distinct union',
  xml: 'xml version encoding',
  json: 'true false null',
};

const ALIAS = {
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', 'c++': 'cpp', hpp: 'cpp',
  java: 'java', kt: 'kotlin', kotlin: 'kotlin', dart: 'dart',
  py: 'python', python: 'python', py3: 'python',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  ps1: 'powershell', powershell: 'powershell', pwsh: 'powershell',
  sql: 'sql', json: 'json', makefile: 'makefile', cmake: 'makefile',
  js: 'java', javascript: 'java', ts: 'java', typescript: 'java', gradle: 'java', groovy: 'java',
  yaml: 'yaml', yml: 'yaml', ini: 'yaml', toml: 'yaml',
};

function profile(lang) {
  const key = ALIAS[String(lang || '').toLowerCase()];
  if (!key) return null;
  const kw = new Set((KW[key] || '').split(/\s+/).filter(Boolean));
  return {
    kw,
    lineComment: key === 'python' || key === 'bash' || key === 'makefile' || key === 'yaml' ? ['#'] : key === 'sql' ? ['--'] : ['//'],
    blockComment: key === 'python' || key === 'bash' || key === 'makefile' || key === 'yaml' || key === 'sql' ? [] : [['/*', '*/']],
    strings: key === 'powershell' || key === 'bash' ? ['"', "'"] : ['"', "'"],
    preprocessor: key === 'c' || key === 'cpp',
    annotation: key === 'java' || key === 'kotlin',
    numbers: true,
  };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export function canHighlight(lang) {
  return !!profile(lang);
}

export function highlight(code, lang) {
  const p = profile(lang);
  if (!p) return esc(code);

  const out = [];
  let plain = '';
  const flush = () => {
    if (plain) { out.push(esc(plain)); plain = ''; }
  };
  const emit = (cls, text) => { flush(); out.push('<span class="tok-' + cls + '">' + esc(text) + '</span>'); };

  let i = 0;
  const n = code.length;
  let atLineStart = true;

  while (i < n) {
    const rest = code.slice(i);

    // 预处理器（C/C++ 的 #include 等，行首）
    if (p.preprocessor && atLineStart) {
      const m = /^[ \t]*#[^\n]*/.exec(rest);
      if (m) { emit('pp', m[0]); i += m[0].length; atLineStart = false; continue; }
    }

    // 块注释
    if (p.blockComment.length) {
      let matched = false;
      for (const [open, close] of p.blockComment) {
        if (rest.startsWith(open)) {
          const end = code.indexOf(close, i + open.length);
          const stop = end < 0 ? n : end + close.length;
          emit('cmt', code.slice(i, stop));
          atLineStart = code.slice(i, stop).endsWith('\n');
          i = stop;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    // 行注释
    {
      let hit = false;
      for (const mark of p.lineComment) {
        if (rest.startsWith(mark)) {
          const end = code.indexOf('\n', i);
          const stop = end < 0 ? n : end;
          emit('cmt', code.slice(i, stop));
          i = stop;
          atLineStart = false;
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }

    // 字符串
    const q = rest[0];
    if (p.strings.includes(q)) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === q) { j++; break; }
        if (code[j] === '\n') break;
        j++;
      }
      emit('str', code.slice(i, j));
      i = j;
      atLineStart = false;
      continue;
    }

    // 注释里常出现的 javadoc 标记 <p> 等：交给下游转义，不处理

    if (p.annotation && q === '@') {
      const m = /^@[A-Za-z_][\w.]*/.exec(rest);
      if (m) { emit('ann', m[0]); i += m[0].length; atLineStart = false; continue; }
    }

    if (p.numbers && /[0-9]/.test(q)) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[fFlLuUdD]*/.exec(rest);
      if (m) { emit('num', m[0]); i += m[0].length; atLineStart = false; continue; }
    }

    if (/[A-Za-z_$]/.test(q)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(rest);
      const word = m[0];
      if (p.kw.has(word)) emit('kw', word);
      else if (p.kw.has(word.toLowerCase()) && p.kw.size > 0 && ['C', 'NULL', 'TRUE', 'FALSE'].includes(word)) emit('kw', word);
      else plain += word;
      i += word.length;
      atLineStart = false;
      continue;
    }

    if (q === '\n') { flush(); out.push('\n'); atLineStart = true; i++; continue; }

    plain += q;
    if (!/[ \t]/.test(q)) atLineStart = false;
    i++;
  }
  flush();
  return out.join('');
}
