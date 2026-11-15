/* ==========================================================================
   笔记预览 · 交互
   ========================================================================== */
(function () {
  'use strict';

  var DATA = window.__NOTES__ || { docs: [] };
  var DOCS = DATA.docs || [];
  var byPath = new Map();
  var byLower = new Map();
  var orderIndex = new Map();
  DOCS.forEach(function (d, i) {
    byPath.set(d.p, d);
    byLower.set(d.p.toLowerCase(), d);
    orderIndex.set(d.p, i);
  });

  /* ---------------- 小工具 ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var store = {
    get: function (k, def) {
      try {
        var v = localStorage.getItem('bnote.' + k);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem('bnote.' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
    }
  };

  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  function debounce(fn, ms) {
    var timer = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function naturalCompare(a, b) {
    return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
  }

  function fmtNum(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
    return String(n);
  }

  function timeAgo(ms) {
    var diff = Date.now() - ms;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 30) return Math.floor(diff / 86400000) + ' 天前';
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && window.isSecureContext !== false) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallback()); });
      } else {
        resolve(fallback());
      }
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        } catch (e) { return false; }
      }
    });
  }

  /* ---------------- 主题 / 字号 / 侧栏宽度 ---------------- */

  var root = document.documentElement;

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    store.set('theme', theme);
    var btn = $('#theme-btn');
    if (btn) {
      btn.innerHTML = theme === 'dark' ? iconSun() : iconMoon();
      btn.title = theme === 'dark' ? '切换到浅色' : '切换到深色';
    }
  }

  function currentTheme() { return root.getAttribute('data-theme') || 'light'; }

  function applyFont(size) {
    size = Math.max(13, Math.min(21, size));
    root.style.setProperty('--fs', size + 'px');
    store.set('fs', size);
    return size;
  }

  function applySidebarWidth(w) {
    w = Math.max(220, Math.min(460, w));
    root.style.setProperty('--sw', w + 'px');
    store.set('sw', w);
    return w;
  }

  /* ---------------- 图标 ---------------- */

  function iconSun() {
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"/></svg>';
  }
  function iconMoon() {
    return '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.4 8.4 0 1 0 10.5 10.5z"/></svg>';
  }
  function iconSearch() {
    return '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.4 4.4"/></svg>';
  }
  function iconMenu() {
    return '<svg viewBox="0 0 24 24"><path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/></svg>';
  }
  function iconToc() {
    return '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h11M4 18h7"/></svg>';
  }

  /* ---------------- 树 ---------------- */

  var treeEl, filterInput;
  var expanded = new Set(store.get('expanded', []));
  var expandedInited = store.get('expanded') !== undefined;
  var treeData = null;

  function buildTree() {
    var root = { type: 'dir', name: '', path: '', depth: -1, children: [], map: new Map() };
    DOCS.forEach(function (d) {
      var parts = d.p.split('/');
      var cur = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var name = parts[i];
        var p = parts.slice(0, i + 1).join('/');
        var child = cur.map.get(name);
        if (!child) {
          child = { type: 'dir', name: name, path: p, depth: i, children: [], map: new Map(), count: 0 };
          cur.children.push(child);
          cur.map.set(name, child);
        }
        child.count++;
        cur = child;
      }
      cur.children.push({
        type: 'file',
        name: parts[parts.length - 1],
        path: d.p,
        depth: parts.length - 1,
        doc: d
      });
    });
    return root;
  }

  function isExpandedDir(node) {
    if (expandedInited) return expanded.has(node.path);
    if (node.depth === 0) return !node.path.startsWith('.photo');
    return false;
  }

  function saveExpanded() { store.set('expanded', Array.from(expanded)); }

  function expandAncestors(path) {
    var parts = path.split('/');
    for (var i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
  }

  function fileRow(d, indent) {
    var name = d.p.split('/').pop().replace(/\.md$/i, '');
    return '<li><a class="row file-row" href="#' + encodeURI(d.p) + '" data-path="' + esc(d.p) + '" title="' + esc(d.p) + '"' +
      (indent ? ' style="padding-left:' + indent + 'px"' : '') + '>' +
      '<span class="caret"></span><span class="ico">·</span><span class="nm">' + esc(name) + '</span></a></li>';
  }

  function dirHtml(node) {
    var open = isExpandedDir(node);
    var inner = node.children.map(function (c) {
      return c.type === 'dir' ? dirHtml(c) : fileRow(c.doc);
    }).join('');
    return '<li class="' + (open ? '' : 'collapsed ') + 'tree-dir" data-path="' + esc(node.path) + '">' +
      '<button class="row dir-row" type="button" data-dir="' + esc(node.path) + '" title="' + esc(node.path) + '">' +
      '<span class="caret">▸</span><span class="ico">' + (node.path.startsWith('.') ? '◇' : '▣') + '</span>' +
      '<span class="nm">' + esc(node.name) + '</span><span class="cnt">' + node.count + '</span></button>' +
      '<ul class="children">' + inner + '</ul></li>';
  }

  function renderTree() {
    if (!treeEl) return;
    var q = (filterInput && filterInput.value || '').trim();
    if (!q) {
      treeEl.innerHTML = '<ul class="tree-root">' + treeData.children.map(function (c) {
        return c.type === 'dir' ? dirHtml(c) : fileRow(c.doc);
      }).join('') + '</ul>';
    } else {
      var lq = q.toLowerCase();
      var hits = DOCS.filter(function (d) {
        return (d.t + ' ' + d.p).toLowerCase().indexOf(lq) >= 0;
      });
      if (!hits.length) {
        treeEl.innerHTML = '<div class="tree-empty">没有匹配的笔记<br>试试 Ctrl+K 全文搜索</div>';
      } else {
        var groups = new Map();
        hits.forEach(function (d) {
          if (!groups.has(d.d)) groups.set(d.d, []);
          groups.get(d.d).push(d);
        });
        var out = [];
        groups.forEach(function (list, dir) {
          out.push('<li class="filter-group"><div class="grp-name">' + esc(dir || '根目录') + ' <span class="cnt">' + list.length + '</span></div><ul>' + list.map(function (d) { return fileRow(d); }).join('') + '</ul></li>');
        });
        treeEl.innerHTML = '<ul class="tree-root">' + out.join('') + '</ul><div class="tree-empty">共 ' + hits.length + ' 篇匹配</div>';
      }
    }
    highlightActive();
  }

  function highlightActive() {
    $$('.tree .row.active').forEach(function (el) { el.classList.remove('active'); });
    var cur = state.path;
    if (!cur) return;
    var el = treeEl.querySelector('.row[data-path="' + cssEsc(cur) + '"]');
    if (!el) return;
    el.classList.add('active');
    if (!filterInput.value.trim()) {
      var li = el.closest('li.tree-dir');
      // 展开祖先
      var p = cur.split('/');
      for (var i = 1; i < p.length; i++) {
        var anc = treeEl.querySelector('li.tree-dir[data-path="' + cssEsc(p.slice(0, i).join('/')) + '"]');
        if (anc) anc.classList.remove('collapsed');
      }
      var r = el.getBoundingClientRect();
      var box = treeEl.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) {
        el.scrollIntoView({ block: 'center' });
      }
    }
  }

  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  /* ---------------- 文档渲染 ---------------- */

  var docEl, tocEl, crumbsEl, pagerEl, homeEl;
  var state = { path: '', anchor: '' };
  var scrollMemory = new Map();
  var restoringScroll = false;

  function go(path, anchor) {
    var h = '#' + encodeURI(path) + (anchor ? '::' + anchor : '');
    if (location.hash === h) { route(); return; }
    location.hash = h;
  }

  function findDoc(path) {
    return byPath.get(path) || byLower.get(String(path).toLowerCase()) || null;
  }

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return null;
    try { h = decodeURIComponent(h); } catch (e) { /* 保持原样 */ }
    var i = h.indexOf('::');
    if (i >= 0) return { path: h.slice(0, i), anchor: h.slice(i + 2) };
    return { path: h, anchor: '' };
  }

  function route() {
    var parsed = parseHash();
    if (!parsed || !parsed.path) {
      renderHome();
      return;
    }
    var doc = findDoc(parsed.path);
    if (!doc) {
      toast('找不到这篇笔记：' + parsed.path);
      renderHome();
      return;
    }
    if (doc.p === state.path) {
      if (parsed.anchor) scrollToAnchor(parsed.anchor, true);
      return;
    }
    if (state.path) scrollMemory.set(state.path, window.scrollY);
    state.path = doc.p;
    state.anchor = parsed.anchor;
    renderDoc(doc, parsed.anchor);
  }

  function scrollToAnchor(id, smooth) {
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) { toast('找不到锚点：' + id); return; }
    var top = el.getBoundingClientRect().top + window.scrollY - 62;
    window.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'instant' });
    el.style.transition = 'background-color .6s';
    el.style.backgroundColor = 'var(--mark)';
    setTimeout(function () { el.style.backgroundColor = ''; }, 900);
  }

  function scrollToTop(y) {
    window.scrollTo({ top: y || 0, behavior: 'instant' });
  }

  function renderDoc(doc, anchor) {
    document.body.classList.remove('side-open');
    document.body.classList.remove('home');
    homeEl.hidden = true;
    docEl.hidden = false;

    docEl.innerHTML = doc.h;

    document.title = doc.t + ' · 笔记预览';
    renderCrumbs(doc);
    renderToc(doc);
    renderPager(doc);
    wireDoc();

    var pos = anchor ? null : scrollMemory.get(doc.p);
    if (anchor) {
      requestAnimationFrame(function () { scrollToAnchor(anchor, false); });
    } else {
      scrollToTop(pos || 0);
    }
    setTopbarMode(true);
    highlightActive();
    rememberRecent(doc.p);
    if (window.innerWidth <= 900) document.body.classList.remove('side-open');
  }

  function renderCrumbs(doc) {
    var parts = doc.p.split('/');
    var dirs = parts.slice(0, -1);
    var last = parts[parts.length - 1];
    var html = ['<a href="#" data-home="1" title="全部笔记">首页</a>'];
    var push = function (text, tip) {
      html.push('<span class="sep">/</span>');
      html.push('<span class="crumb" title="' + esc(tip || text) + '">' + esc(text) + '</span>');
    };

    if (dirs.length > 2) {
      push(dirs[0], dirs[0]);
      html.push('<span class="sep">/</span>');
      html.push('<span class="crumb crumb-dots" title="' + esc(dirs.join(' / ')) + '">…</span>');
      push(dirs[dirs.length - 1], dirs[dirs.length - 1]);
    } else {
      dirs.forEach(function (d) { push(d, d); });
    }

    html.push('<span class="sep">/</span>');
    html.push('<span class="crumb cur" title="' + esc(doc.p) + '">' + esc(last.replace(/\.md$/i, '')) + '</span>');
    crumbsEl.innerHTML = html.join('');
  }

  function renderToc(doc) {
    var list = doc.c || [];
    if (!list.length) {
      tocEl.innerHTML = '<div class="toc-empty" style="padding:6px 8px;color:var(--text-faint)">本篇没有小标题</div>';
      return;
    }
    var html = '<ul>';
    list.forEach(function (item) {
      var lvl = item[0], text = item[1], id = item[2];
      html += '<li><a class="lv' + lvl + '" href="#' + encodeURI(doc.p) + '::' + encodeURIComponent(id) + '" data-id="' + esc(id) + '" title="' + esc(text) + '">' + esc(text) + '</a></li>';
    });
    html += '</ul>';
    tocEl.innerHTML = html;
  }

  function renderPager(doc) {
    var i = orderIndex.get(doc.p);
    var prev = i > 0 ? DOCS[i - 1] : null;
    var next = i < DOCS.length - 1 ? DOCS[i + 1] : null;
    pagerEl.innerHTML =
      (prev ? '<a class="prev" href="#' + encodeURI(prev.p) + '"><span class="dir">← 上一篇</span><span class="t">' + esc(prev.t) + '</span></a>' : '<a class="prev empty"></a>') +
      (next ? '<a class="next" href="#' + encodeURI(next.p) + '"><span class="dir">下一篇 →</span><span class="t">' + esc(next.t) + '</span></a>' : '<a class="next empty"></a>');
  }

  var HEADINGS = [];

  function wireDoc() {
    HEADINGS = $$('h1[id],h2[id],h3[id],h4[id]', docEl).map(function (h) {
      return { el: h, id: h.id, lvl: +h.tagName.charAt(1) };
    });

    $$('img.md-img', docEl).forEach(function (img) {
      img.addEventListener('error', function () {
        var span = document.createElement('span');
        span.className = 'img-missing';
        span.title = img.getAttribute('src') || '';
        span.textContent = '图片无法加载：' + String(img.getAttribute('src') || '').split('/').pop();
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      }, { once: true });
      if (img.complete && img.naturalWidth === 0) {
        var span = document.createElement('span');
        span.className = 'img-missing';
        span.title = img.getAttribute('src') || '';
        span.textContent = '图片无法加载：' + String(img.getAttribute('src') || '').split('/').pop();
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      }
    });

    $$('h1[id],h2[id],h3[id],h4[id]', docEl).forEach(function (h) {
      var a = h.querySelector('.h-anchor');
      if (!a) return;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var target = h.id;
        var hash = '#' + encodeURI(state.path) + '::' + encodeURIComponent(target);
        try {
          history.replaceState(null, '', hash);
        } catch (err) {
          /* file:// 下可能不允许改 URL，忽略 */
        }
        scrollToAnchor(target, true);
        copyText(location.href.split('#')[0] + hash).then(function (ok) {
          if (ok) toast('已复制本节链接');
        });
      });
    });
  }

  /* ---------------- 文档区域事件 ---------------- */

  function bindDocEvents() {
    docEl.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('img.md-img');
      if (img) { openLightbox(img.src); return; }

      var copyBtn = e.target.closest && e.target.closest('.code-copy');
      if (copyBtn) {
        var block = copyBtn.closest('.code-block');
        var code = block && block.querySelector('pre code');
        if (!code) return;
        copyText(code.textContent).then(function (ok) {
          if (!ok) { toast('复制失败，请手动选择'); return; }
          copyBtn.textContent = '已复制';
          copyBtn.classList.add('done');
          setTimeout(function () {
            copyBtn.textContent = '复制';
            copyBtn.classList.remove('done');
          }, 1400);
        });
        return;
      }

      var a = e.target.closest && e.target.closest('a');
      if (!a) return;

      if (a.dataset.home) { e.preventDefault(); goHome(); return; }

      if (a.classList.contains('doc-link')) {
        e.preventDefault();
        go(a.dataset.doc, a.dataset.anchor || '');
        return;
      }
      if (a.classList.contains('link-broken')) {
        e.preventDefault();
        toast('链接目标不存在：' + (a.dataset.broken || ''));
        return;
      }
      if (a.classList.contains('h-anchor')) return;
      if (a.dataset.id) {
        // 目录里的锚点
        e.preventDefault();
        go(state.path, a.dataset.id);
        return;
      }
    });

    crumbsEl.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-home]');
      if (a) { e.preventDefault(); goHome(); }
    });
  }

  function goHome() {
    state.path = '';
    if (location.hash && location.hash !== '#') {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {
        /* file:// 下可能不允许改 URL，忽略 */
      }
    }
    renderHome();
  }

  /* ---------------- 首页 ---------------- */

  function renderHome() {
    document.title = '笔记预览 · ' + DOCS.length + ' 篇';
    document.body.classList.add('home');
    docEl.hidden = true;
    homeEl.hidden = false;
    setTopbarMode(false);
    crumbsEl.innerHTML = '<span class="crumb cur">全部笔记</span>';
    tocEl.innerHTML = '';
    pagerEl.innerHTML = '';

    var totalWords = DOCS.reduce(function (a, d) { return a + d.w; }, 0);
    var recent = store.get('recent', []);
    var last = recent.length ? findDoc(recent[0]) : null;

    var groups = new Map();
    DOCS.forEach(function (d) {
      var top = d.p.indexOf('/') >= 0 ? d.p.split('/')[0] : '根目录';
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push(d);
    });

    var html = '<div class="hero">';
    html += '<h1>全部笔记</h1>';
    html += '<p class="lead">' + esc(DATA.root || '') + '</p>';
    html += '<div class="stats">' +
      '<div class="stat"><b>' + DOCS.length + '</b><span>篇笔记</span></div>' +
      '<div class="stat"><b>' + fmtNum(totalWords) + '</b><span>字</span></div>' +
      '<div class="stat"><b>' + groups.size + '</b><span>个分类</span></div>' +
      '<div class="stat"><b>' + timeAgo(new Date(DATA.built).getTime()) + '</b><span>上次生成</span></div>' +
      '</div>';
    html += '<div class="hero-actions">';
    if (last) html += '<a class="btn primary" href="#' + encodeURI(last.p) + '">继续阅读：' + esc(last.t) + '</a>';
    html += '<button class="btn" data-act="search">' + iconSearch() + ' 全文搜索 <kbd style="margin-left:4px;font-size:11px;opacity:.6">Ctrl K</kbd></button>';
    html += '<button class="btn" data-act="random">随便看一篇</button>';
    html += '</div></div>';

    if (recent.length > 1) {
      html += '<div class="section-title">最近阅读</div><div class="recent">';
      recent.slice(0, 8).forEach(function (p) {
        var d = findDoc(p);
        if (!d) return;
        html += '<a href="#' + encodeURI(d.p) + '"><span class="rtitle">' + esc(d.t) + '</span><span class="rpath">' + esc(d.d || '根目录') + '</span></a>';
      });
      html += '</div>';
    }

    html += '<div class="section-title">分类 <small>' + groups.size + ' 组</small></div><div class="groups">';
    groups.forEach(function (list, name) {
      var shown = list.slice(0, 5);
      html += '<div class="group-card"><div class="gc-head"><span class="gc-name">' + esc(name) + '</span><span class="gc-count">' + list.length + ' 篇</span></div><ul>';
      shown.forEach(function (d) {
        html += '<li><a href="#' + encodeURI(d.p) + '" title="' + esc(d.p) + '">' + esc(d.t) + '</a></li>';
      });
      html += '</ul>';
      if (list.length > shown.length) html += '<div class="more">还有 ' + (list.length - shown.length) + ' 篇（在左侧目录里展开）</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '<div class="hint"><b>怎么用：</b>左边目录点进去看，<kbd>Ctrl</kbd>+<kbd>K</kbd> 全文搜索，<kbd>[</kbd> / <kbd>]</kbd> 翻上一篇下一篇，点代码块右上角复制，点图片看大图。<br>' +
      '这个页面是离线生成的快照：<b>改完笔记要重新生成一次</b>才会出现新内容——双击 <code>_预览/更新预览.bat</code> 即可（也可以在 <code>_预览</code> 里跑 <code>node src/build.mjs</code>）。</div>';

    homeEl.innerHTML = html;
    homeEl.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        if (act === 'search') openSearch('');
        if (act === 'random') {
          var d = DOCS[Math.floor(Math.random() * DOCS.length)];
          go(d.p);
        }
      });
    });
    highlightActive();
    scrollToTop(0);
  }

  function rememberRecent(p) {
    var recent = store.get('recent', []);
    recent = recent.filter(function (x) { return x !== p; });
    recent.unshift(p);
    store.set('recent', recent.slice(0, 16));
  }

  function setTopbarMode(inDoc) {
    var tocBtn = $('#toc-btn');
    if (tocBtn) tocBtn.style.display = inDoc && window.innerWidth > 1180 ? '' : 'none';
    var pager = $('#pager');
    if (pager) pager.style.display = inDoc ? '' : 'none';
  }

  /* ---------------- 搜索 ---------------- */

  var overlay, searchInput, resultsEl;
  var searchItems = [];
  var searchSel = -1;
  var searchIndex = null;

  function buildSearchIndex() {
    searchIndex = DOCS.map(function (d) {
      return {
        d: d,
        title: d.t.toLowerCase(),
        path: d.p.toLowerCase(),
        body: (d.x || '').toLowerCase()
      };
    });
  }

  function highlightText(text, tokens) {
    var out = esc(text);
    tokens.forEach(function (t) {
      if (!t) return;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<em>$1</em>');
    });
    return out;
  }

  function runSearch(q) {
    q = q.trim();
    if (!q) return [];
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    var res = [];
    for (var i = 0; i < searchIndex.length; i++) {
      var it = searchIndex[i];
      var score = 0;
      var ok = true;
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        var inTitle = it.title.indexOf(tok) >= 0;
        var inPath = it.path.indexOf(tok) >= 0;
        var pos = it.body.indexOf(tok);
        if (!inTitle && !inPath && pos < 0) { ok = false; break; }
        if (inTitle) score += 60;
        if (inPath) score += 14;
        if (pos >= 0) score += 6;
      }
      if (!ok) continue;
      if (it.title === q.toLowerCase()) score += 200;
      else if (it.title.indexOf(q.toLowerCase()) === 0) score += 80;
      res.push({ it: it, score: score });
    }
    res.sort(function (a, b) { return b.score - a.score || a.it.d.p.localeCompare(b.it.d.p, 'zh-CN'); });

    return res.slice(0, 30).map(function (r) {
      var it = r.it;
      var body = it.d.x || '';
      var low = body.toLowerCase();
      var pos = -1;
      for (var t = 0; t < tokens.length; t++) {
        var p = low.indexOf(tokens[t]);
        if (p >= 0 && (pos < 0 || p < pos)) pos = p;
      }
      var snippet = '';
      if (pos >= 0) {
        var start = Math.max(0, pos - 46);
        var end = Math.min(body.length, pos + 110);
        snippet = (start > 0 ? '…' : '') + body.slice(start, end).replace(/\s+/g, ' ') + (end < body.length ? '…' : '');
      } else {
        snippet = (body.slice(0, 120) || '').replace(/\s+/g, ' ');
      }
      return { d: it.d, snippet: snippet };
    });
  }

  function renderSearchResults(q) {
    var hits = runSearch(q);
    searchItems = hits;
    searchSel = hits.length ? 0 : -1;
    if (!q.trim()) {
      var recent = store.get('recent', []).slice(0, 6).map(findDoc).filter(Boolean);
      resultsEl.innerHTML = '<div class="rs-head">最近阅读</div>' + (recent.length ? recent.map(function (d) {
        return resultHtml(d, '');
      }).join('') : '<div class="search-empty">输入关键词搜索全文（标题、路径、正文）</div>');
      searchItems = recent;
      searchSel = recent.length ? 0 : -1;
      markSelected();
      return;
    }
    if (!hits.length) {
      resultsEl.innerHTML = '<div class="search-empty">没有找到「' + esc(q) + '」<br><span style="font-size:12px">多个关键词用空格分隔</span></div>';
      return;
    }
    resultsEl.innerHTML = '<div class="rs-head">' + hits.length + ' 个结果</div>' + hits.map(function (h) {
      return resultHtml(h.d, h.snippet);
    }).join('');
    markSelected();
  }

  function resultHtml(d, snippet) {
    var tokens = (searchInput.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return '<a class="sr" href="#' + encodeURI(d.p) + '" data-path="' + esc(d.p) + '">' +
      '<span class="sr-top"><span class="sr-title">' + highlightText(d.t, tokens) + '</span>' +
      '<span class="sr-path">' + esc(d.d || '根目录') + '</span></span>' +
      (snippet ? '<span class="sr-snip">' + highlightText(snippet, tokens) + '</span>' : '') +
      '</a>';
  }

  function markSelected() {
    $$('.sr', resultsEl).forEach(function (el, i) {
      el.classList.toggle('sel', i === searchSel);
      if (i === searchSel) {
        var r = el.getBoundingClientRect();
        var b = resultsEl.getBoundingClientRect();
        if (r.bottom > b.bottom || r.top < b.top) el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function openSearch(initial) {
    overlay.hidden = false;
    searchInput.value = initial || '';
    renderSearchResults(searchInput.value);
    setTimeout(function () { searchInput.focus(); searchInput.select(); }, 10);
  }

  function closeSearch() {
    overlay.hidden = true;
    searchInput.value = '';
  }

  function bindSearch() {
    searchInput.addEventListener('input', debounce(function () {
      renderSearchResults(searchInput.value);
    }, 90));

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (searchSel < searchItems.length - 1) { searchSel++; markSelected(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (searchSel > 0) { searchSel--; markSelected(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var item = searchItems[searchSel];
        if (item) {
          var path = item.p || (item.d && item.d.p);
          if (path) { closeSearch(); go(path); }
        }
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });

    resultsEl.addEventListener('click', function (e) {
      var a = e.target.closest('a.sr');
      if (!a) return;
      closeSearch();
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSearch();
    });
  }

  /* ---------------- 图片放大 ---------------- */

  function openLightbox(src) {
    var lb = $('#lightbox');
    var img = $('#lightbox .lb-img');
    img.src = src;
    lb.hidden = false;
  }

  function closeLightbox() {
    var lb = $('#lightbox');
    lb.hidden = true;
    $('#lightbox .lb-img').src = '';
  }

  /* ---------------- 滚动：进度 + scrollspy ---------------- */

  var rafPending = false;

  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
      var bar = $('#progress');
      if (bar) bar.style.width = pct.toFixed(1) + '%';

      if (!HEADINGS.length) return;
      var top = window.scrollY + 90;
      var active = null;
      for (var i = 0; i < HEADINGS.length; i++) {
        var hd = HEADINGS[i];
        var y = hd.el.getBoundingClientRect().top + window.scrollY;
        if (y <= top) active = hd; else break;
      }
      var links = tocEl.querySelectorAll('a');
      for (var j = 0; j < links.length; j++) {
        links[j].classList.toggle('active', !!active && links[j].dataset.id === active.id);
      }
    });
  }

  /* ---------------- 键盘 ---------------- */

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === 'Escape') {
        if (!overlay.hidden) { closeSearch(); return; }
        if (!$('#lightbox').hidden) { closeLightbox(); return; }
        if (document.body.classList.contains('side-open')) document.body.classList.remove('side-open');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openSearch('');
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        openSearch('');
        return;
      }
      if (e.key === '[' && state.path) {
        var i = orderIndex.get(state.path);
        if (i > 0) go(DOCS[i - 1].p);
        return;
      }
      if (e.key === ']' && state.path) {
        var k = orderIndex.get(state.path);
        if (k < DOCS.length - 1) go(DOCS[k + 1].p);
        return;
      }
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var th = currentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(th);
      }
    });
  }

  /* ---------------- 拖拽侧栏 & 移动端 ---------------- */

  function bindChrome() {
    var resizer = $('#resizer');
    var dragging = false;
    resizer.addEventListener('pointerdown', function (e) {
      dragging = true;
      resizer.classList.add('dragging');
      resizer.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    resizer.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      applySidebarWidth(e.clientX);
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      resizer.addEventListener(ev, function () {
        if (!dragging) return;
        dragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    });

    var sideToggle = $('#side-toggle');
    if (sideToggle) sideToggle.addEventListener('click', function () { document.body.classList.toggle('side-open'); });
    var sideClose = $('#side-close');
    if (sideClose) sideClose.addEventListener('click', function () { document.body.classList.remove('side-open'); });

    $('#theme-btn').addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
    $('#font-inc').addEventListener('click', function () {
      applyFont(parseFloat(getComputedStyle(root).getPropertyValue('--fs')) + 1);
    });
    $('#font-dec').addEventListener('click', function () {
      applyFont(parseFloat(getComputedStyle(root).getPropertyValue('--fs')) - 1);
    });
    $('#search-btn').addEventListener('click', function () { openSearch(''); });

    var tocBtn = $('#toc-btn');
    if (tocBtn) tocBtn.addEventListener('click', function () {
      document.body.classList.toggle('no-toc');
      var hidden = document.body.classList.contains('no-toc');
      tocBtn.classList.toggle('on', !hidden);
      store.set('tocHidden', hidden);
    });

    var printBtn = $('#print-btn');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', debounce(function () {
      setTopbarMode(!!state.path);
      document.body.classList.remove('side-open');
    }, 150));

    $('#lightbox').addEventListener('click', closeLightbox);
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    docEl = $('#doc');
    homeEl = $('#home');
    tocEl = $('#toc');
    crumbsEl = $('#crumbs');
    pagerEl = $('#pager');
    treeEl = $('#tree');
    filterInput = $('#filter');
    overlay = $('#overlay');
    searchInput = $('#search-input');
    resultsEl = $('#search-results');

    if (store.get('tocHidden', false)) document.body.classList.add('no-toc');

    treeData = buildTree();

    renderTree();
    buildSearchIndex();
    bindDocEvents();
    bindSearch();
    bindKeys();
    bindChrome();

    filterInput.addEventListener('input', debounce(renderTree, 80));
    filterInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        openSearch(filterInput.value);
      }
      if (e.key === 'Escape') {
        filterInput.value = '';
        renderTree();
        filterInput.blur();
      }
    });

    treeEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button.dir-row');
      if (btn) {
        var li = btn.parentNode;
        li.classList.toggle('collapsed');
        var p = btn.dataset.dir;
        if (li.classList.contains('collapsed')) expanded.delete(p);
        else { expanded.add(p); expandedInited = true; }
        saveExpanded();
        return;
      }
    });

    var brand = $('.brand');
    if (brand) {
      brand.style.cursor = 'pointer';
      brand.title = '回到全部笔记';
      brand.addEventListener('click', function () { goHome(); });
    }

    window.addEventListener('hashchange', route);
    applyTheme(store.get('theme', window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    applyFont(parseFloat(store.get('fs', 16)));
    applySidebarWidth(parseFloat(store.get('sw', 292)));

    if (location.hash) route();
    else renderHome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
