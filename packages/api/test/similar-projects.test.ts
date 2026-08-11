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
  // a, b share React + TypeScript; c shares only TypeScript with a; d has no tech stack.
  addTechStackEntry(db, 'a', { category: 'framework', value: 'React' });
  addTechStackEntry(db, 'a', { category: 'language', value: 'TypeScript' });
  addTechStackEntry(db, 'b', { category: 'framework', value: 'React' });
  addTechStackEntry(db, 'b', { category: 'language', value: 'TypeScript' });
  addTechStackEntry(db, 'c', { category: 'language', value: 'TypeScript' });

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
    expect(body.items.map((it: any) => it.project.id)).toEqual(['b', 'c']);
    expect(body.items[0].score).toBe(2);
    expect(body.items[0].sharedTechStack).toEqual([
      { category: 'framework', value: 'React' },
      { category: 'language', value: 'TypeScript' },
    ]);
    expect(body.items[1].score).toBe(1);
  });

  it('excludes projects with zero overlap and the target itself', async () => {
    const { body } = await getJson('/projects/a/similar');
    const ids = body.items.map((it: any) => it.project.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('d');
  });

  it('returns an empty list for a project with no tech stack', async () => {
    const { status, body } = await getJson('/projects/d/similar');
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
