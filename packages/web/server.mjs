// 프로덕션(Docker) 전용 정적 파일 서버 + /api 리버스 프록시.
// Vite dev server의 proxy 설정과 동일한 역할을 컨테이너 안에서 수행한다 (별도 의존성 없음).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const apiTarget = process.env.CONTEXTSOURCE_API_URL || 'http://localhost:8080';
const port = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  // Docker healthcheck용 — 정적 파일 서버 프로세스가 살아 있는지만 확인한다(BENCHMARK.md 5.16).
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url?.startsWith('/api')) {
    const target = new URL(req.url, apiTarget);
    const proxyReq = http.request(
      target,
      { method: req.method, headers: { ...req.headers, host: target.host } },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: e.message } }));
    });
    req.pipe(proxyReq);
    return;
  }

  const reqPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
  const filePath = path.normalize(path.join(distDir, reqPath));
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback — 클라이언트 라우팅(History API, router.ts)이 사용하는 /projects/:id/:tab 같은
      // 경로는 서버에 실제 파일이 없으므로, 새로고침·직접 방문 시 항상 index.html로 폴백해야 한다.
      fs.readFile(path.join(distDir, 'index.html'), (err2, indexData) => {
        if (err2) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`[contextsource-ui] listening on :${port}, proxying /api -> ${apiTarget}`);
});
