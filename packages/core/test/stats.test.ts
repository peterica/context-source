import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { replaceProjectGraph } from '../src/storage/ingest.js';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';
import { getProjectStats, listInferredRelationships } from '../src/query/stats.js';
import { fixtureTsconfig } from './helpers.js';

const PROJECT = 'p1';

function seed(fixture: string): Db {
  const db = openDatabase(':memory:');
  upsertProject(db, { id: PROJECT, name: fixture, rootPath: `/fixtures/${fixture}` });
  const result = analyzeProject({ tsconfigPath: fixtureTsconfig(fixture), projectId: PROJECT, revision: 'rev1' });
  replaceProjectGraph(db, PROJECT, result.entities, result.relationships);
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
