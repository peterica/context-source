import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import {
  analyzeProject,
  openDatabase,
  replaceProjectGraph,
  symbolEntityId,
  upsertProject,
  type Db,
} from '@contextsource/core';
import { createApp } from '../src/app.js';

// ADR-0011 — GET /projects/{id}/unresolved-references와 GET /projects/{id}/stats의
// unresolvedReferences 집계를 실제 HTTP 서버로 검증한다. app.test.ts의 공용 PROJECT는
// overload-generic 골든 fixture(전부 정적 해석됨, 사각지대 0건)라 여기서 검증할 게 없어
// dependency-injection fixture(사각지대 1건 확정)로 별도 프로젝트를 세운다.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureTsconfig = path.join(testDir, '../../core/test/fixtures/dependency-injection/tsconfig.json');

const PROJECT = 'p1';
let db: Db;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  db = openDatabase(':memory:');
  upsertProject(db, {
    id: PROJECT,
    name: 'dependency-injection',
    rootPath: '/fixtures/dependency-injection',
    tsconfigPath: fixtureTsconfig,
  });
  const result = analyzeProject({ tsconfigPath: fixtureTsconfig, projectId: PROJECT, revision: 'rev1' });
  replaceProjectGraph(db, PROJECT, result.entities, result.relationships, result.unresolvedReferences);

  const app = createApp({ db, workspaceRoot: '/fixtures', resolveRevision: () => 'rev1' });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('server did not bind a port');
  baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getJson(pathAndQuery: string) {
  const res = await fetch(`${baseUrl}${pathAndQuery}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /projects/{id}/stats includes unresolvedReferences (ADR-0011)', () => {
  it('reports total/byKind/byReason', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/stats`);
    expect(status).toBe(200);
    expect(body.unresolvedReferences.total).toBe(1);
    expect(body.unresolvedReferences.byKind.CALLS).toBe(1);
    expect(body.unresolvedReferences.byReason['entity-not-extracted']).toBe(1);
  });
});

describe('GET /projects/{id}/unresolved-references (ADR-0011)', () => {
  it('lists unresolved references with their source Entity', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/unresolved-references`);
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.reference.kind).toBe('CALLS');
    expect(item.reference.reason).toBe('entity-not-extracted');
    expect(item.reference.snippet).toBe("this.logger.log('order placed')");
    expect(item.source.id).toBe(symbolEntityId(PROJECT, 'src/order-service.ts', 'OrderService.placeOrder'));
  });

  it('honors limit/offset', async () => {
    const { status, body } = await getJson(`/projects/${PROJECT}/unresolved-references?limit=1&offset=1`);
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(0); // 전체가 1건뿐이라 offset=1이면 빈 페이지
  });

  it('returns 404 for an unknown project', async () => {
    const { status, body } = await getJson(`/projects/does-not-exist/unresolved-references`);
    expect(status).toBe(404);
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});
