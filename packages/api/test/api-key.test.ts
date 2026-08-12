import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { openDatabase, upsertProject, type Db } from '@contextsource/core';
import { createApp } from '../src/app.js';

// ADR-0010 — apiKey가 설정되면 GET이 아닌 요청에는 x-api-key 헤더 일치를 요구하고,
// 미설정 시(app.test.ts가 쓰는 기본 createApp)에는 전혀 영향이 없어야 한다(하위 호환).

const PROJECT = 'p1';
const API_KEY = 'test-secret-key';
let db: Db;
let server: Server;
let baseUrl: string;
let workspaceRoot: string;

beforeAll(async () => {
  db = openDatabase(':memory:');
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-api-key-workspace-'));
  fs.mkdirSync(path.join(workspaceRoot, 'other-repo'));
  fs.writeFileSync(path.join(workspaceRoot, 'other-repo', 'tsconfig.json'), '{}');
  upsertProject(db, {
    id: PROJECT,
    name: 'p1',
    rootPath: path.join(workspaceRoot, 'other-repo'),
    tsconfigPath: path.join(workspaceRoot, 'other-repo', 'tsconfig.json'),
  });

  const app = createApp({
    db,
    workspaceRoot,
    resolveRevision: () => 'rev1',
    apiKey: API_KEY,
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('server did not bind a port');
  baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

async function request(method: string, pathAndQuery: string, opts: { apiKey?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.apiKey !== undefined) headers['x-api-key'] = opts.apiKey;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${pathAndQuery}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = res.status === 204 ? undefined : await res.json();
  return { status: res.status, body };
}

describe('API key protection for mutating requests (ADR-0010)', () => {
  it('GET requests succeed without any x-api-key header even when apiKey is configured', async () => {
    const { status } = await request('GET', '/projects');
    expect(status).toBe(200);
  });

  it('GET /health is never protected (Docker healthcheck must work without a key)', async () => {
    const res = await fetch(`${baseUrl.replace('/api/v1', '')}/health`);
    expect(res.status).toBe(200);
  });

  it('POST /projects without x-api-key is rejected with 401 UNAUTHORIZED', async () => {
    const { status, body } = await request('POST', '/projects', {
      body: { name: 'no-key', path: 'other-repo', tsconfigPath: 'tsconfig.json' },
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /projects with a wrong x-api-key is rejected with 401 UNAUTHORIZED', async () => {
    const { status, body } = await request('POST', '/projects', {
      apiKey: 'wrong-key',
      body: { name: 'wrong-key', path: 'other-repo', tsconfigPath: 'tsconfig.json' },
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /projects with the correct x-api-key succeeds', async () => {
    const { status, body } = await request('POST', '/projects', {
      apiKey: API_KEY,
      body: { id: 'p2', name: 'right-key', path: 'other-repo', tsconfigPath: 'tsconfig.json' },
    });
    expect(status).toBe(201);
    expect(body.project.id).toBe('p2');
  });

  it('DELETE /projects/{id} without x-api-key is rejected, with it succeeds', async () => {
    const rejected = await request('DELETE', `/projects/p2`);
    expect(rejected.status).toBe(401);

    const accepted = await request('DELETE', `/projects/p2`, { apiKey: API_KEY });
    expect(accepted.status).toBe(204);
  });

  it('PATCH /projects/{id} without x-api-key is rejected with 401', async () => {
    const { status } = await request('PATCH', `/projects/${PROJECT}`, {
      body: { description: 'should not apply' },
    });
    expect(status).toBe(401);
  });
});
