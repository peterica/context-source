import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createProject, openDatabase, type Db } from '@contextsource/core';
import { createApp } from '../src/app.js';

const PROJECT = 'demo';
let db: Db;
let server: Server;
let baseUrl: string;
let workspaceRoot: string;

beforeAll(async () => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-api-techstack-'));
  fs.mkdirSync(path.join(workspaceRoot, 'demo'));
  fs.writeFileSync(path.join(workspaceRoot, 'demo', 'tsconfig.json'), '{}');
  fs.writeFileSync(
    path.join(workspaceRoot, 'demo', 'package.json'),
    JSON.stringify({ dependencies: { react: '^18.0.0', pg: '^8.0.0' } }),
  );

  db = openDatabase(':memory:');
  createProject(db, {
    id: PROJECT,
    name: 'Demo',
    rootPath: path.join(workspaceRoot, 'demo'),
    tsconfigPath: path.join(workspaceRoot, 'demo', 'tsconfig.json'),
  });

  const app = createApp({ db, workspaceRoot });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

async function getJson(p: string) {
  const res = await fetch(`${baseUrl}${p}`);
  return { status: res.status, body: await res.json() };
}
async function send(method: string, p: string, payload?: unknown) {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers: payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = res.status === 204 ? undefined : await res.json();
  return { status: res.status, body };
}

describe('tech-stack (ADR-0005)', () => {
  it('starts empty', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/tech-stack`);
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it('POST adds an entry, GET reflects it', async () => {
    const post = await send('POST', `/projects/${PROJECT}/tech-stack`, {
      category: 'framework',
      value: 'React',
    });
    expect(post.status).toBe(201);
    expect(post.body.items).toEqual([{ category: 'framework', value: 'React' }]);

    const { body } = await getJson(`/projects/${PROJECT}/tech-stack`);
    expect(body.items).toEqual([{ category: 'framework', value: 'React' }]);
  });

  it('rejects an invalid category with 400 INVALID_PARAM', async () => {
    const { status, body } = await send('POST', `/projects/${PROJECT}/tech-stack`, {
      category: 'bogus',
      value: 'x',
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });

  it('rejects an overly long value', async () => {
    const { status } = await send('POST', `/projects/${PROJECT}/tech-stack`, {
      category: 'framework',
      value: 'x'.repeat(51),
    });
    expect(status).toBe(400);
  });

  it('DELETE removes an entry', async () => {
    const del = await send('DELETE', `/projects/${PROJECT}/tech-stack`, {
      category: 'framework',
      value: 'React',
    });
    expect(del.status).toBe(204);
    const { body } = await getJson(`/projects/${PROJECT}/tech-stack`);
    expect(body.items).toEqual([]);
  });

  it('DELETE on a nonexistent entry is idempotent (204)', async () => {
    const del = await send('DELETE', `/projects/${PROJECT}/tech-stack`, {
      category: 'framework',
      value: 'NeverAdded',
    });
    expect(del.status).toBe(204);
  });

  it('detect reads package.json and merges without wiping manual entries', async () => {
    await send('POST', `/projects/${PROJECT}/tech-stack`, {
      category: 'framework',
      value: 'CustomFramework',
    });

    const { status, body } = await send('POST', `/projects/${PROJECT}/tech-stack/detect`);
    expect(status).toBe(200);
    expect(body.items).toEqual(
      expect.arrayContaining([
        { category: 'language', value: 'TypeScript' },
        { category: 'runtime', value: 'Node.js' },
        { category: 'framework', value: 'React' },
        { category: 'database', value: 'PostgreSQL' },
        { category: 'framework', value: 'CustomFramework' },
      ]),
    );
    expect(body.added).toEqual(
      expect.arrayContaining([
        { category: 'language', value: 'TypeScript' },
        { category: 'runtime', value: 'Node.js' },
        { category: 'framework', value: 'React' },
        { category: 'database', value: 'PostgreSQL' },
      ]),
    );
    expect(body.added.some((e: any) => e.value === 'CustomFramework')).toBe(false);
  });

  it('sub-resource under an unknown project returns 404 PROJECT_NOT_FOUND', async () => {
    const { status, body } = await getJson('/projects/does-not-exist/tech-stack');
    expect(status).toBe(404);
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});
