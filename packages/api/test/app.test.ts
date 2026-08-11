import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import {
  analyzeProject,
  fileEntityId,
  openDatabase,
  replaceProjectGraph,
  symbolEntityId,
  upsertProject,
  type Db,
} from '@contextsource/core';
import { createApp } from '../src/app.js';
import { encodeEntityId } from '../src/id-encoding.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureTsconfig = path.join(
  testDir,
  '../../core/test/fixtures/overload-generic/tsconfig.json',
);

const PROJECT = 'p1';
let db: Db;
let server: Server;
let baseUrl: string;
let workspaceRoot: string;

beforeAll(async () => {
  db = openDatabase(':memory:');
  upsertProject(db, {
    id: PROJECT,
    name: 'overload-generic',
    rootPath: '/fixtures/overload-generic',
    tsconfigPath: fixtureTsconfig,
  });
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig,
    projectId: PROJECT,
    revision: 'rev1',
  });
  replaceProjectGraph(db, PROJECT, result.entities, result.relationships);

  // POST /projects 테스트용 workspace: 실제로 존재하는 디렉터리 + tsconfig가 필요하다.
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-api-workspace-'));
  fs.mkdirSync(path.join(workspaceRoot, 'other-repo'));
  fs.writeFileSync(path.join(workspaceRoot, 'other-repo', 'tsconfig.json'), '{}');

  const app = createApp({
    db,
    workspaceRoot,
    resolveRevision: () => 'rev1',
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

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  return { status: res.status, body: await res.json() };
}

async function postJson(pathAndQuery: string, payload: unknown) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

describe('Project registry (ADR-0004)', () => {
  it('GET /projects lists registered projects with stats', async () => {
    const { status, body } = await getJson('/projects');
    expect(status).toBe(200);
    const item = body.items.find((i: any) => i.project.id === PROJECT);
    expect(item).toBeDefined();
    expect(item.entityCount).toBeGreaterThan(0);
    expect(item.relationshipCount).toBeGreaterThan(0);
  });

  it('GET /projects/{id} returns a single project summary', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}`);
    expect(status).toBe(200);
    expect(body.project.id).toBe(PROJECT);
    expect(body.entityCount).toBeGreaterThan(0);
  });

  it('GET /projects/{unknown} returns 404 PROJECT_NOT_FOUND', async () => {
    const { status, body } = await getJson('/projects/does-not-exist');
    expect(status).toBe(404);
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('POST /projects registers a project by workspace-relative path', async () => {
    const { status, body } = await postJson('/projects', {
      name: 'Other Repo',
      path: 'other-repo',
      tsconfigPath: 'tsconfig.json',
      description: 'a second project',
    });
    expect(status).toBe(201);
    expect(body.project.id).toBe('other-repo');
    expect(body.project.rootPath).toBe(path.join(workspaceRoot, 'other-repo'));
    expect(body.project.tsconfigPath).toBe(path.join(workspaceRoot, 'other-repo', 'tsconfig.json'));
    expect(body.project.description).toBe('a second project');
  });

  it('POST /projects rejects a path that escapes the workspace root', async () => {
    const { status, body } = await postJson('/projects', {
      name: 'Escape',
      path: '../../etc',
      tsconfigPath: 'tsconfig.json',
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });

  it('POST /projects rejects a nonexistent path', async () => {
    const { status, body } = await postJson('/projects', {
      name: 'Ghost',
      path: 'does-not-exist-dir',
      tsconfigPath: 'tsconfig.json',
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });

  it('POST /projects with a duplicate explicit id returns 409', async () => {
    const { status, body } = await postJson('/projects', {
      id: PROJECT,
      name: 'Dup',
      path: 'other-repo',
      tsconfigPath: 'tsconfig.json',
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe('PROJECT_ALREADY_EXISTS');
  });

  it('PATCH /projects/{id} updates description', async () => {
    const res = await fetch(`${baseUrl}/projects/other-repo`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'updated' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.description).toBe('updated');
  });

  it('DELETE /projects/{id} removes the project', async () => {
    const del = await fetch(`${baseUrl}/projects/other-repo`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    const { status } = await getJson('/projects/other-repo');
    expect(status).toBe(404);
  });

  it('sub-resources under an unknown project return 404 PROJECT_NOT_FOUND', async () => {
    const { status, body } = await getJson('/projects/does-not-exist/entities');
    expect(status).toBe(404);
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});

describe('2.1 GET /projects/{id}/entities', () => {
  it('searches by name', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/entities?name=identity`);
    expect(status).toBe(200);
    expect(body.items.some((e: any) => e.name === 'identity')).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('rejects invalid kind with 400 INVALID_PARAM', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/entities?kind=bogus`);
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });
});

describe('2.2 GET /projects/{id}/entities/{encodedId}', () => {
  it('returns entity + relationshipCounts', async () => {
    const id = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const { status, body } = await getJson(`/projects/${PROJECT}/entities/${encodeEntityId(id)}`);
    expect(status).toBe(200);
    expect(body.entity.id).toBe(id);
    expect(body.relationshipCounts.in).toBeGreaterThan(0);
  });

  it('returns 404 ENTITY_NOT_FOUND for unknown id', async () => {
    const { status, body } = await getJson(
      `/projects/${PROJECT}/entities/${encodeEntityId('p1/sym:nope.ts#nope')}`,
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('returns 400 INVALID_PARAM for malformed base64url', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/entities/not-valid-base64url!!!`);
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });
});

describe('2.3 GET /projects/{id}/entities/{encodedId}/relationships', () => {
  it('filters by direction/types/resolution and includes evidence', async () => {
    const id = fileEntityId(PROJECT, 'src/math.ts');
    const { status, body } = await getJson(
      `/projects/${PROJECT}/entities/${encodeEntityId(id)}/relationships?direction=out&types=DECLARES`,
    );
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.relationship.type).toBe('DECLARES');
      expect(item.relationship.evidence.length).toBeGreaterThan(0);
      expect(item.counterpart).toBeDefined();
    }
  });
});

describe('2.4 GET /projects/{id}/entities/{encodedId}/callers and /callees', () => {
  it('callers of identity includes run', async () => {
    const id = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const { status, body } = await getJson(`/projects/${PROJECT}/entities/${encodeEntityId(id)}/callers`);
    expect(status).toBe(200);
    expect(body.items[0].counterpart.name).toBe('run');
  });

  it('callees of run includes identity', async () => {
    const id = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const { status, body } = await getJson(`/projects/${PROJECT}/entities/${encodeEntityId(id)}/callees`);
    expect(status).toBe(200);
    expect(body.items.some((i: any) => i.counterpart.name === 'identity')).toBe(true);
  });
});

describe('2.5 GET /projects/{id}/entities/{encodedId}/subgraph', () => {
  it('direction=in models the impact graph (FR-V1)', async () => {
    const id = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const { status, body } = await getJson(
      `/projects/${PROJECT}/entities/${encodeEntityId(id)}/subgraph?direction=in&depth=2`,
    );
    expect(status).toBe(200);
    expect(body.rootId).toBe(id);
    expect(body.entities.some((e: any) => e.name === 'run')).toBe(true);
    expect(body.stats.entityCount).toBe(body.entities.length);
  });

  it('honors maxNodes and reports truncated', async () => {
    const id = fileEntityId(PROJECT, 'src/usage.ts');
    const { status, body } = await getJson(
      `/projects/${PROJECT}/entities/${encodeEntityId(id)}/subgraph?direction=both&depth=5&maxNodes=1`,
    );
    expect(status).toBe(200);
    expect(body.truncated).toBe(true);
  });

  it('rejects depth beyond the documented max (5)', async () => {
    const id = fileEntityId(PROJECT, 'src/usage.ts');
    const { status, body } = await getJson(
      `/projects/${PROJECT}/entities/${encodeEntityId(id)}/subgraph?depth=6`,
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAM');
  });
});

describe('2.6 POST /projects/{id}/analysis/runs (full mode)', () => {
  it('triggers a full analysis run and it becomes queryable', async () => {
    const res = await fetch(`${baseUrl}/projects/${PROJECT}/analysis/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'full' }),
    });
    expect(res.status).toBe(202);
    const { runId } = await res.json();
    expect(runId).toBeTruthy();

    const { status, body } = await getJson(`/projects/${PROJECT}/analysis/runs/${runId}`);
    expect(status).toBe(200);
    expect(body.status).toBe('completed');
    expect(body.mode).toBe('full');
  });

  it('rejects an unknown mode with 400', async () => {
    const res = await fetch(`${baseUrl}/projects/${PROJECT}/analysis/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /projects/{id}/analysis/runs/{unknown} returns 404 RUN_NOT_FOUND', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/analysis/runs/does-not-exist`);
    expect(status).toBe(404);
    expect(body.error.code).toBe('RUN_NOT_FOUND');
  });
});
