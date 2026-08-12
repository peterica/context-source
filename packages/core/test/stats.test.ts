import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { replaceProjectGraph } from '../src/storage/ingest.js';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';
import { getProjectStats, listInferredRelationships, listUnresolvedReferences } from '../src/query/stats.js';
import { fixtureTsconfig } from './helpers.js';

const PROJECT = 'p1';

function seed(fixture: string): Db {
  const db = openDatabase(':memory:');
  upsertProject(db, { id: PROJECT, name: fixture, rootPath: `/fixtures/${fixture}`, tsconfigPath: fixtureTsconfig(fixture) });
  const result = analyzeProject({ tsconfigPath: fixtureTsconfig(fixture), projectId: PROJECT, revision: 'rev1' });
  replaceProjectGraph(db, PROJECT, result.entities, result.relationships, result.unresolvedReferences);
  return db;
}

describe('getProjectStats', () => {
  it('aggregates entity/relationship/evidence counts', () => {
    const db = seed('overload-generic');
    const stats = getProjectStats(db, PROJECT);
    expect(stats.entities.total).toBeGreaterThan(0);
    expect(stats.entities.byKind.function).toBeGreaterThan(0);
    expect(stats.relationships.total).toBeGreaterThan(0);
    expect(stats.relationships.byType.DECLARES).toBeGreaterThan(0);
    expect(stats.relationships.byResolution.static + stats.relationships.byResolution.inferred).toBe(
      stats.relationships.total,
    );
    expect(stats.evidence.total).toBeGreaterThanOrEqual(stats.relationships.total);
    // overload-generic은 전부 정적으로 해석되는 fixture라 사각지대가 없어야 한다.
    expect(stats.unresolvedReferences.total).toBe(0);
  });

  it('aggregates unresolvedReferences by kind/reason (ADR-0011)', () => {
    const db = seed('dependency-injection');
    const stats = getProjectStats(db, PROJECT);
    expect(stats.unresolvedReferences.total).toBe(1);
    expect(stats.unresolvedReferences.byKind.CALLS).toBe(1);
    expect(stats.unresolvedReferences.byKind.IMPORTS).toBe(0);
    expect(stats.unresolvedReferences.byReason['entity-not-extracted']).toBe(1);
    const sumByReason = Object.values(stats.unresolvedReferences.byReason).reduce((a, b) => a + b, 0);
    expect(sumByReason).toBe(stats.unresolvedReferences.total);
  });
});

describe('listInferredRelationships', () => {
  it('returns only inferred relationships, paginated', () => {
    const db = seed('callback-hof');
    const res = listInferredRelationships(db, PROJECT, 50, 0);
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item.relationship.resolution).toBe('inferred');
      expect(item.source).toBeDefined();
      expect(item.target).toBeDefined();
    }
  });

  it('excludes static-only projects (empty result)', () => {
    const db = seed('inheritance');
    const res = listInferredRelationships(db, PROJECT, 50, 0);
    expect(res.items).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});

describe('listUnresolvedReferences (ADR-0011)', () => {
  it('returns unresolved references with their source Entity, paginated', () => {
    const db = seed('unresolved-imports');
    const res = listUnresolvedReferences(db, PROJECT, 50, 0);
    expect(res.items.length).toBe(2);
    expect(res.total).toBe(2);
    const reasons = res.items.map((i) => i.reference.reason).sort();
    expect(reasons).toEqual(['internal-path-not-in-project', 'unresolvable-specifier']);
    for (const item of res.items) {
      expect(item.reference.kind).toBe('IMPORTS');
      expect(item.source).toBeDefined();
      expect(item.source.id).toBe(item.reference.sourceId);
    }
  });

  it('excludes fully-resolved projects (empty result)', () => {
    const db = seed('inheritance');
    const res = listUnresolvedReferences(db, PROJECT, 50, 0);
    expect(res.items).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
