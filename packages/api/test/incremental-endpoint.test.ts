import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { openDatabase, symbolEntityId, upsertProject, type Db } from '@contextsource/core';
import { createApp } from '../src/app.js';
import { currentRevision } from '../src/git.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function commit(dir: string, msg: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

const PROJECT = 'p1';
let repoDir: string;
let tsconfigPath: string;
let db: Db;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-api-incremental-'));
  git(repoDir, ['init', '-q']);
  git(repoDir, ['config', 'user.email', 'test@example.com']);
  git(repoDir, ['config', 'user.name', 'Test']);
  write(
    repoDir,
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  write(repoDir, 'src/a.ts', `export function foo(): number {\n  return 1;\n}\n`);
  commit(repoDir, 'A');
  tsconfigPath = path.join(repoDir, 'tsconfig.json');

  db = openDatabase(':memory:');
  upsertProject(db, { id: PROJECT, name: 'incr-endpoint', rootPath: repoDir, tsconfigPath });

  const app = createApp({
    db,
    workspaceRoot: repoDir,
    resolveRevision: (repoRoot) => currentRevision(repoRoot),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(repoDir, { recursive: true, force: true });
});

async function postRun(mode: string) {
  const res = await fetch(`${baseUrl}/projects/${PROJECT}/analysis/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /projects/{id}/analysis/runs (mode=incremental)', () => {
  it('mode=incremental before any full scan returns 400 INVALID_PARAM with a Korean message', async () => {
    const { status, body } = await postRun('incremental');
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
    expect(body.error.message).toMatch(/[가-힣]/); // UX audit P0-2: was a raw English exception string
  });

  it('full scan then incremental scan after a new commit works end-to-end', async () => {
    const full = await postRun('full');
    expect(full.status).toBe(202);

    write(repoDir, 'src/b.ts', `export function bar(): number {\n  return 2;\n}\n`);
    commit(repoDir, 'B: add bar');

    const incr = await postRun('incremental');
    expect(incr.status).toBe(202);

    const runRes = await fetch(`${baseUrl}/projects/${PROJECT}/analysis/runs/${incr.body.runId}`);
    const run = await runRes.json();
    expect(run.mode).toBe('incremental');
    expect(run.status).toBe('completed');

    const entityRes = await fetch(`${baseUrl}/projects/${PROJECT}/entities?name=bar`);
    const entities = await entityRes.json();
    expect(entities.items.some((e: any) => e.id === symbolEntityId(PROJECT, 'src/b.ts', 'bar'))).toBe(
      true,
    );
  });
});
