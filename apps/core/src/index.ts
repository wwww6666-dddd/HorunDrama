/**
 * HorunDrama 新核心入口。
 *
 * 只监听回环；数据目录单一来源（config.ts）；静态托管新前端产物。
 * 业务按 重做方案-v2 逐步接入：目录（已接）→ 详情/播放 → 账号（扫码登录）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HOST, PORT, DATA_ROOT, VERSION, WEB_DIST } from './config.ts';
import { Router } from './http/router.ts';
import { registerRoutes } from './http/api.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(res: http.ServerResponse, pathname: string): void {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolved = path.resolve(WEB_DIST, rel);
  const inside = resolved === WEB_DIST || resolved.startsWith(WEB_DIST + path.sep);
  const wantFile = rel !== '' && path.extname(resolved) !== '';
  const file = inside && wantFile && fs.existsSync(resolved) ? resolved : path.join(WEB_DIST, 'index.html');

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('前端还没构建：pnpm --filter @horun/web-next run build');
    return;
  }

  const stat = fs.statSync(file);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

const router = new Router();
registerRoutes(router);

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const hit = router.match(method, url.pathname);
    if (hit === null) {
      const body = JSON.stringify({ ok: false, code: 'no_route', message: `没有这个接口: ${url.pathname}` });
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    void Promise.resolve(hit.handler({ req, res, url, params: hit.params })).catch((err: unknown) => {
      if (!res.headersSent) {
        const body = JSON.stringify({ ok: false, code: 'internal', message: (err as Error).message });
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(body);
      } else {
        res.end();
      }
    });
    return;
  }

  serveStatic(res, url.pathname);
});

server.on('error', (err) => {
  console.error('[core] 启动失败:', err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  fs.mkdirSync(path.join(DATA_ROOT, 'cache', 'images'), { recursive: true });
  console.log(`[core] HorunDrama core v${VERSION} → http://${HOST}:${PORT}`);
  console.log(`[core] 数据目录: ${DATA_ROOT}`);
  console.log(`[core] 前端产物: ${fs.existsSync(WEB_DIST) ? WEB_DIST : '（未构建）'}`);
});
