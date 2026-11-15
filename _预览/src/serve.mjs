/*!
 * serve.mjs — 本地实时预览服务
 *   node _预览/src/serve.mjs
 *   · 静态托管笔记库（图片等相对资源可用）
 *   · 监听 *.md 变化 → 自动重新生成 → 浏览器自动刷新
 *   · 只绑定 127.0.0.1
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, '笔记预览.html');
const BUILD = path.join(HERE, 'build.mjs');
const NO_OPEN = process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

let pageHtml = '';
let version = '';
let building = false;
let pending = false;

function rebuild(reason) {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  const t0 = Date.now();
  try {
    execFileSync(process.execPath, [BUILD], { cwd: ROOT, stdio: 'pipe' });
    pageHtml = fs.readFileSync(OUT, 'utf8');
    const m = pageHtml.match(/\"version\":\"([^\"]+)\"/);
    version = m ? m[1] : String(Date.now());
    console.log('✔ 已重新生成（' + (reason || '手动') + '，' + (Date.now() - t0) + ' ms，版本 ' + version + '）');
    broadcast();
  } catch (err) {
    console.error('✗ 生成失败：');
    if (err.stdout) process.stderr.write(String(err.stdout));
    if (err.stderr) process.stderr.write(String(err.stderr));
  } finally {
    building = false;
    if (pending) {
      pending = false;
      setTimeout(() => rebuild('排队'), 60);
    }
  }
}

/* ---------------- 自动刷新（SSE） ---------------- */

const clients = new Set();

function broadcast() {
  for (const res of clients) {
    try {
      res.write('data: ' + version + '\n\n');
    } catch {
      clients.delete(res);
    }
  }
}

function handleReload(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
  res.write('retry: 1000\n\n');
  res.write('data: ' + version + '\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

const LIVE_SNIPPET = `<script>
(function(){
  try{
    var es = new EventSource('/__reload');
    var first = null;
    es.onmessage = function(e){
      if (first === null) { first = e.data; return; }
      if (e.data !== first) location.reload();
    };
  }catch(err){}
})();
</script>`;

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad url');
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    const body = pageHtml.replace('</body>', LIVE_SNIPPET + '\n</body>');
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }
  const target = path.resolve(ROOT, '.' + pathname);
  if (!target.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + pathname);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* ---------------- 监听 md 变化 ---------------- */

let timer = 0;
function watch() {
  try {
    fs.watch(ROOT, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const name = String(filename);
      if (name.startsWith('_预览')) return;
      if (/笔记预览\.html$|\.tmp[\\/]/.test(name)) return;
      if (!/\.(md|markdown)$/i.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => rebuild(Array.isArray(filename) ? '文件变化' : name), 500);
    });
    console.log('👀 正在监听 *.md 变化…');
  } catch (err) {
    console.warn('⚠ 文件监听不可用（' + err.message + '），只能手动刷新');
  }
}

/* ---------------- 启动 ---------------- */

function listen(port, tries = 0) {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/__reload')) return handleReload(req, res);
    if (url.startsWith('/__version')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version }));
    }
    serveStatic(req, res);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries < 12) {
      console.log('端口 ' + port + ' 被占用，换 ' + (port + 1));
      listen(port + 1, tries + 1);
    } else {
      console.error('启动失败：' + err.message);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('');
    console.log('  笔记实时预览： ' + url);
    console.log('  （改完 .md 保存即自动更新；关掉这个窗口就停止）');
    console.log('');
    if (!NO_OPEN) {
      try {
        spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* 打不开就算了 */ }
    }
    watch();
  });
}

if (!fs.existsSync(OUT)) {
  console.log('首次运行，先生成一次…');
  rebuild('首次生成');
} else {
  pageHtml = fs.readFileSync(OUT, 'utf8');
  const m = pageHtml.match(/"version":"([^"]+)"/);
  version = m ? m[1] : String(Date.now());
  // 启动时也重建一次，保证是最新的
  rebuild('启动');
}

listen(Number(process.env.PORT) || 8180);
