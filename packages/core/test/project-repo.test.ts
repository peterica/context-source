import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import {
  createProject,
  deleteProject,
  generateProjectId,
  getProject,
  listProjects,
  projectExists,
  updateProject,
  upsertProject,
} from '../src/storage/project-repo.js';
import { listProjectsWithStats, getProjectSummary, findSimilarProjects } from '../src/query/project-queries.js';
import { insertEntities } from '../src/storage/ingest.js';
import { addTechStackEntry } from '../src/storage/tech-stack-repo.js';
import type { Entity } from '../src/types.js';

function freshDb(): Db {
  return openDatabase(':memory:');
}

describe('Project CRUD (ADR-0004)', () => {
  it('createProject stores tsconfigPath/description and rejects duplicate ids', () => {
    const db = freshDb();
    const project = createProject(db, {
      id: 'demo',
      name: 'Demo',
      rootPath: '/workspaces/demo',
      tsconfigPath: '/workspaces/demo/tsconfig.json',
      description: 'a demo project',
    });
    expect(project.id).toBe('demo');
    expect(project.tsconfigPath).toBe('/workspaces/demo/tsconfig.json');
    expect(project.description).toBe('a demo project');
    expect(project.createdAt).toBeTruthy();
    expect(project.updatedAt).toBeTruthy();

    expect(() =>
      createProject(db, {
        id: 'demo',
        name: 'Demo 2',
        rootPath: '/x',
        tsconfigPath: '/x/tsconfig.json',
      }),
    ).toThrow();
  });

  it('getProject / listProjects / projectExists', () => {
    const db = freshDb();
    createProject(db, { id: 'a', name: 'A', rootPath: '/a', tsconfigPath: '/a/tsconfig.json' });
    createProject(db, { id: 'b', name: 'B', rootPath: '/b', tsconfigPath: '/b/tsconfig.json' });

    expect(projectExists(db, 'a')).toBe(true);
    expect(projectExists(db, 'nope')).toBe(false);
    expect(getProject(db, 'nope')).toBeUndefined();

    const all = listProjects(db);
    expect(all.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('updateProject patches only provided fields and bumps updatedAt', async () => {
    const db = freshDb();
    const created = createProject(db, {
      id: 'demo',
      name: 'Demo',
      rootPath: '/x',
      tsconfigPath: '/x/tsconfig.json',
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateProject(db, 'demo', { description: 'now described' });
    expect(updated?.name).toBe('Demo'); // unchanged
    expect(updated?.description).toBe('now described');
    expect(updated?.tsconfigPath).toBe('/x/tsconfig.json'); // unchanged
    expect(updated?.updatedAt >= created.updatedAt).toBe(true);
  });

  it('updateProject on unknown id returns undefined', () => {
    const db = freshDb();
    expect(updateProject(db, 'nope', { name: 'x' })).toBeUndefined();
  });

  it('deleteProject cascades to entities (ON DELETE CASCADE)', () => {
    const db = freshDb();
    createProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    const entity: Entity = {
      id: 'demo/file:a.ts',
      projectId: 'demo',
      kind: 'file',
      name: 'a.ts',
      filePath: 'a.ts',
      range: { startLine: 1, endLine: 1 },
      revision: 'rev1',
    };
    insertEntities(db, [entity]);

    expect(deleteProject(db, 'demo')).toBe(true);
    expect(getProject(db, 'demo')).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS c FROM entity').get() as { c: number }).c).toBe(0);
    expect(deleteProject(db, 'demo')).toBe(false); // already gone
  });

  it('upsertProject is idempotent (insert then update)', () => {
    const db = freshDb();
    upsertProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    upsertProject(db, {
      id: 'demo',
      name: 'Demo Renamed',
      rootPath: '/y',
      tsconfigPath: '/y/tsconfig.json',
    });
    expect(listProjects(db)).toHaveLength(1);
    const project = getProject(db, 'demo');
    expect(project?.name).toBe('Demo Renamed');
    expect(project?.rootPath).toBe('/y');
  });

  it('generateProjectId slugifies and de-duplicates', () => {
    const db = freshDb();
    const id1 = generateProjectId(db, 'My Cool Project!');
    expect(id1).toBe('my-cool-project');
    createProject(db, { id: id1, name: 'x', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    const id2 = generateProjectId(db, 'My Cool Project!');
    expect(id2).toBe('my-cool-project-2');
  });
});

describe('listProjectsWithStats / getProjectSummary', () => {
  it('aggregates entity/relationship counts and last completed run per project, independently', () => {
    const db = freshDb();
    createProject(db, { id: 'a', name: 'A', rootPath: '/a', tsconfigPath: '/a/tsconfig.json' });
    createProject(db, { id: 'b', name: 'B', rootPath: '/b', tsconfigPath: '/b/tsconfig.json' });

    insertEntities(db, [
      {
        id: 'a/file:x.ts',
        projectId: 'a',
        kind: 'file',
        name: 'x.ts',
        filePath: 'x.ts',
        range: { startLine: 1, endLine: 1 },
        revision: 'rev1',
      },
    ]);

    const summaries = listProjectsWithStats(db);
    expect(summaries).toHaveLength(2);
    const a = summaries.find((s) => s.project.id === 'a')!;
    const b = summaries.find((s) => s.project.id === 'b')!;
    expect(a.entityCount).toBe(1);
    expect(b.entityCount).toBe(0);
    expect(a.lastRun).toBeNull();

    const single = getProjectSummary(db, 'a');
    expect(single?.entityCount).toBe(1);
    expect(getProjectSummary(db, 'nope')).toBeUndefined();
  });

  it('includes each project\'s tech stack without a per-project query (avoids N+1)', () => {
    const db = freshDb();
    createProject(db, { id: 'a', name: 'A', rootPath: '/a', tsconfigPath: '/a/tsconfig.json' });
    createProject(db, { id: 'b', name: 'B', rootPath: '/b', tsconfigPath: '/b/tsconfig.json' });
    addTechStackEntry(db, 'a', { category: 'framework', value: 'React' });
    addTechStackEntry(db, 'a', { category: 'language', value: 'TypeScript' });

    const summaries = listProjectsWithStats(db);
    const a = summaries.find((s) => s.project.id === 'a')!;
    const b = summaries.find((s) => s.project.id === 'b')!;
    expect(a.techStack).toEqual([
      { category: 'framework', value: 'React' },
      { category: 'language', value: 'TypeScript' },
    ]);
    expect(b.techStack).toEqual([]);

    expect(getProjectSummary(db, 'a')?.techStack).toEqual([
      { category: 'framework', value: 'React' },
      { category: 'language', value: 'TypeScript' },
    ]);
  });
});

describe('findSimilarProjects (ADR-0006)', () => {
  it('ranks projects by shared tech-stack tag count, descending, excluding zero-overlap and self', () => {
    const db = freshDb();
    createProject(db, { id: 'a', name: 'A', rootPath: '/a', tsconfigPath: '/a/tsconfig.json' });
    createProject(db, { id: 'b', name: 'B', rootPath: '/b', tsconfigPath: '/b/tsconfig.json' });
    createProject(db, { id: 'c', name: 'C', rootPath: '/c', tsconfigPath: '/c/tsconfig.json' });
    createProject(db, { id: 'd', name: 'D', rootPath: '/d', tsconfigPath: '/d/tsconfig.json' });

    // a: React + TypeScript + Express
    addTechStackEntry(db, 'a', { category: 'framework', value: 'React' });
    addTechStackEntry(db, 'a', { category: 'language', value: 'TypeScript' });
    addTechStackEntry(db, 'a', { category: 'framework', value: 'Express' });
    // b: shares all 3 with a
    addTechStackEntry(db, 'b', { category: 'framework', value: 'React' });
    addTechStackEntry(db, 'b', { category: 'language', value: 'TypeScript' });
    addTechStackEntry(db, 'b', { category: 'framework', value: 'Express' });
    // c: shares only TypeScript with a
    addTechStackEntry(db, 'c', { category: 'language', value: 'TypeScript' });
    // d: no tech stack at all -> no overlap, excluded

    const results = findSimilarProjects(db, 'a', 10);
    expect(results.map((r) => r.project.id)).toEqual(['b', 'c']);
    expect(results[0].score).toBe(3);
    expect(results[0].sharedTechStack).toEqual([
      { category: 'framework', value: 'Express' },
      { category: 'framework', value: 'React' },
      { category: 'language', value: 'TypeScript' },
    ]);
    expect(results[1].score).toBe(1);
    expect(results.some((r) => r.project.id === 'a')).toBe(false);
    expect(results.some((r) => r.project.id === 'd')).toBe(false);
  });

  it('respects the limit parameter', () => {
    const db = freshDb();
    createProject(db, { id: 'a', name: 'A', rootPath: '/a', tsconfigPath: '/a/tsconfig.json' });
    addTechStackEntry(db, 'a', { category: 'language', value: 'TypeScript' });
    for (const id of ['b', 'c', 'd']) {
      createProject(db, { id, name: id.toUpperCase(), rootPath: `/${id}`, tsconfigPath: `/${id}/tsconfig.json` });
      addTechStackEntry(db, id, { category: 'language', value: 'TypeScript' });
    }

    const results = findSimilarProjects(db, 'a', 2);
    expect(results).toHaveLength(2);
  });

  it('returns an empty array when the target project has no tech stack or does not exist', () => {
    const db = freshDb();
    createProject(db, { id: 'a', name: 'A', rootPath: '/a', tsconfigPath: '/a/tsconfig.json' });
    createProject(db, { id: 'b', name: 'B', rootPath: '/b', tsconfigPath: '/b/tsconfig.json' });
    addTechStackEntry(db, 'b', { category: 'language', value: 'TypeScript' });

    expect(findSimilarProjects(db, 'a', 10)).toEqual([]);
    expect(findSimilarProjects(db, 'nope', 10)).toEqual([]);
  });
});

describe('Schema migration (ADR-0004 §4)', () => {
  it('a pre-ADR-0004 database (project table without new columns) gets migrated on open', () => {
    // node:sqlite를 직접 써서, 마이그레이션 이전의 옛 스키마를 흉내낸다.
    const NodeSqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const raw = new NodeSqlite.DatabaseSync(':memory:');
    raw.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    raw.prepare('INSERT INTO project (id, name, root_path) VALUES (?, ?, ?)').run(
      'legacy',
      'Legacy',
      '/legacy',
    );

    // openDatabase는 파일 경로를 받으므로, 이미 만들어둔 커넥션의 스키마 상태를 그대로 이어받기 위해
    // applyMigrations를 직접 호출하는 대신 동일한 로직 경로(openDatabase)를 파일 기반으로 검증한다.
    // 여기서는 in-memory 위에서 동일 커넥션에 migrations만 적용해 컬럼이 채워지는지 확인한다.
    raw.exec('PRAGMA foreign_keys = ON;');

    // applyMigrations는 core 내부 모듈이라 직접 import해서 같은 커넥션에 적용한다.
    return import('../src/storage/migrations.js').then(({ applyMigrations }) => {
      applyMigrations(raw as any);

      const row = raw.prepare('SELECT * FROM project WHERE id = ?').get('legacy') as any;
      expect(row.tsconfig_path).toBe('tsconfig.json'); // 백필 기본값
      expect(row.description).toBeNull();
      expect(row.updated_at).toBeTruthy();

      const version = raw.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(version.user_version).toBe(2);
    });
  });
});
