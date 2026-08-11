import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { addTechStackEntry, createProject, openDatabase, type Db } from '@contextsource/core';
import { createApp } from '../src/app.js';

let db: Db;
let server: Server;
let baseUrl: string;
let workspaceRoot: string;

beforeAll(async () => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-api-similar-'));
  for (const id of ['a', 'b', 'c', 'd']) {
    fs.mkdirSync(path.join(workspaceRoot, id));
    fs.writeFileSync(path.join(workspaceRoot, id, 'tsconfig.json'), '{}');
  }

  db = openDatabase(':memory:');
  for (const id of ['a', 'b', 'c', 'd']) {
    createProject(db, {
      id,
      name: id.toUpperCase(),
      rootPath: path.join(workspaceRoot, id),
      tsconfigPath: path.join(workspaceRoot, id, 'tsconfig.json'),
    });
  }
  // a, b share React (plus the universal language/runtime tags every project gets via auto-detect);
  // c only has the universal language/runtime tags — no meaningful overlap with a, so it must be
  // excluded (regression for the 2026-08-11 fix: language/runtime no longer contribute to score);
  // d has no tech stack at all.
  addTechStackEntry(db, 'a', { category: 'framework', value: 'React' });
  addTechStackEntry(db, 'a', { category: 'language', value: 'TypeScript' });
  addTechStackEntry(db, 'a', { category: 'runtime', value: 'Node.js' });
  addTechStackEntry(db, 'b', { category: 'framework', value: 'React' });
  addTechStackEntry(db, 'b', { category: 'language', value: 'TypeScript' });
  addTechStackEntry(db, 'b', { category: 'runtime', value: 'Node.js' });
  addTechStackEntry(db, 'c', { category: 'language', value: 'TypeScript' });
  addTechStackEntry(db, 'c', { category: 'runtime', value: 'Node.js' });

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

describe('GET /projects/{id}/similar (ADR-0006)', () => {
  it('ranks by shared tech-stack tag count and includes the shared tags as evidence', async () => {
    const { status, body } = await getJson('/projects/a/similar');
    expect(status).toBe(200);
    expect(body.items.map((it: any) => it.project.id)).toEqual(['b']);
    expect(body.items[0].score).toBe(1);
    expect(body.items[0].sharedTechStack).toEqual([{ category: 'framework', value: 'React' }]);
  });

  it('excludes projects sharing only the universal language/runtime tags, zero overlap, and the target itself', async () => {
    const { body } = await getJson('/projects/a/similar');
    const ids = body.items.map((it: any) => it.project.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('c'); // regression: language/runtime alone must not count
    expect(ids).not.toContain('d');
  });

  it('returns an empty list for a project with no tech stack', async () => {
    const { status, body } = await getJson('/projects/d/similar');
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it('returns an empty list for a project whose only tags are the universal language/runtime ones', async () => {
    const { status, body } = await getJson('/projects/c/similar');
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it('respects the limit query param', async () => {
    const { body } = await getJson('/projects/a/similar?limit=1');
    expect(body.items).toHaveLength(1);
  });

  it('rejects an out-of-range limit with 400 INVALID_PARAM', async () => {
    const { status, body } = await getJson('/projects/a/similar?limit=0');
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });

  it('returns 404 PROJECT_NOT_FOUND for an unknown project', async () => {
    const { status, body } = await getJson('/projects/does-not-exist/similar');
    expect(status).toBe(404);
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});
