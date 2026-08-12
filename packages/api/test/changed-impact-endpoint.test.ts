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
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-api-changed-impact-'));
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
  // c.ts(곧 바뀔 파일) <- b.ts(직접 영향) <- a.ts(간접 영향)
  write(repoDir, 'src/c.ts', `export function helperC(): number {\n  return 1;\n}\n`);
  write(
    repoDir,
    'src/b.ts',
    [
      `import { helperC } from './c';`,
      `export function useC(): number {`,
      `  return helperC();`,
      `}`,
      '',
    ].join('\n'),
  );
  write(
    repoDir,
    'src/a.ts',
    [`import { useC } from './b';`, `export function run(): number {`, `  return useC();`, `}`, ''].join('\n'),
  );
  commit(repoDir, 'baseline');
  tsconfigPath = path.join(repoDir, 'tsconfig.json');

  db = openDatabase(':memory:');
  upsertProject(db, { id: PROJECT, name: 'changed-impact-endpoint', rootPath: repoDir, tsconfigPath });

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

async function getJson(p: string) {
  const res = await fetch(`${baseUrl}${p}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /projects/{id}/analysis/runs/{runId}/changed-impact (ADR-0008)', () => {
  it('rejects a run with no baseRevision (first full scan) with 400 INVALID_PARAM', async () => {
    const full = await postRun('full');
    expect(full.status).toBe(202);

    const { status, body } = await getJson(
      `/projects/${PROJECT}/analysis/runs/${full.body.runId}/changed-impact`,
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
    expect(body.error.message).toMatch(/[가-힣]/);
  });

  it('returns 404 for an unknown run id', async () => {
    const { status, body } = await getJson(
      `/projects/${PROJECT}/analysis/runs/does-not-exist/changed-impact`,
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe('RUN_NOT_FOUND');
  });

  it('ranks direct and indirect impact candidates from an incremental run\'s git diff', async () => {
    write(repoDir, 'src/c.ts', `export function helperC(): number {\n  return 2; /* changed */\n}\n`);
    commit(repoDir, 'change c.ts only');

    const incr = await postRun('incremental');
    expect(incr.status).toBe(202);

    const { status, body } = await getJson(
      `/projects/${PROJECT}/analysis/runs/${incr.body.runId}/changed-impact`,
    );
    expect(status).toBe(200);
    expect(body.runId).toBe(incr.body.runId);

    const helperCId = symbolEntityId(PROJECT, 'src/c.ts', 'helperC');
    expect(body.changedEntities).toEqual([helperCId]);

    const useCId = symbolEntityId(PROJECT, 'src/b.ts', 'useC');
    const runId = symbolEntityId(PROJECT, 'src/a.ts', 'run');
    const byId = new Map(body.candidates.map((c: any) => [c.candidate, c]));

    expect((byId.get(useCId) as any)?.isDirectImpact).toBe(true);
    expect((byId.get(useCId) as any)?.changedEntityId).toBe(helperCId);
    expect((byId.get(runId) as any)?.isDirectImpact).toBe(false);
    expect((byId.get(runId) as any)?.path).toHaveLength(2);
  });

  it('rejects depth beyond the documented max (5)', async () => {
    const runs = await getJson(`/projects/${PROJECT}/analysis/runs?limit=1`);
    const runId = runs.body.items[0].id;
    const { status, body } = await getJson(
      `/projects/${PROJECT}/analysis/runs/${runId}/changed-impact?depth=6`,
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });
});
