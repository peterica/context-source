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

// ADR-0015(BENCHMARK.md 5.16 잔여분) — packages/api/src/logger.ts와 같은 한 줄짜리 JSON 포맷.
// 이 파일은 별도 의존성 없는 standalone 스크립트라 공용 유틸을 import하지 않고 그대로 인라인한다.
function logInfo(msg, fields) {
  process.stdout.write(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...fields }) + '\n');
}
function logError(msg, fields) {
  process.stderr.write(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg, ...fields }) + '\n');
}

const server = http.createServer((req, res) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logInfo('http_request', {
      method: req.method,
      path: req.url,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });

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
      logError('proxy_error', { message: e.message, path: req.url });
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
  logInfo('server_started', { port, apiTarget });
});
