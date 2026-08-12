import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { insertEntities, insertRelationshipsWithEvidence, runInTransaction } from '../src/storage/ingest.js';
import { computeImpact } from '../src/query/impact.js';
import type { Entity, Relationship, RelationshipType, Resolution } from '../src/types.js';

const PROJECT = 'p1';

function entity(id: string, name: string): Entity {
  return {
    id,
    projectId: PROJECT,
    kind: 'function',
    name,
    filePath: 'src/index.ts',
    range: { startLine: 1, endLine: 1 },
    revision: 'rev1',
  };
}

function rel(
  id: string,
  type: RelationshipType,
  sourceId: string,
  targetId: string,
  resolution: Resolution = 'static',
  confidence = resolution === 'static' ? 1.0 : 0.8,
): Relationship {
  return {
    id,
    type,
    sourceId,
    targetId,
    resolution,
    confidence,
    evidence: [
      {
        id: `e-${id}`,
        filePath: 'src/index.ts',
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        snippet: `${sourceId} -> ${targetId}`,
        analyzer: 'test',
        revision: 'rev1',
      },
    ],
  };
}

function seed(db: Db, entities: Entity[], relationships: Relationship[]): void {
  runInTransaction(db, () => {
    insertEntities(db, entities);
    insertRelationshipsWithEvidence(db, relationships);
  });
}

function freshDb(): Db {
  const db = openDatabase(':memory:');
  upsertProject(db, { id: PROJECT, name: 'impact-test', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
  return db;
}

describe('computeImpact (ADR-0008)', () => {
  it('single hop: A CALLS root -> A is a candidate with confidence 1.0 and a one-line reason', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'charge'), entity('a', 'createOrder')],
      [rel('r1', 'CALLS', 'a', 'root')],
    );

    const result = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 50 });
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.candidate).toBe('a');
    expect(candidate.confidence).toBe(1.0);
    expect(candidate.hasInferredHop).toBe(false);
    expect(candidate.reason).toBe('createOrder가 charge를 호출합니다');
    expect(candidate.path).toHaveLength(1);
    expect(candidate.path[0]?.evidence.length).toBeGreaterThan(0);
    expect(result.stats.maxDepthReached).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('multi-hop chain: confidence multiplies along the path and an inferred hop is flagged', () => {
    const db = freshDb();
    // a --CALLS(static)--> b --CALLS(inferred,0.8)--> root
    seed(
      db,
      [entity('root', 'root'), entity('b', 'b'), entity('a', 'a')],
      [rel('r1', 'CALLS', 'b', 'root', 'inferred', 0.8), rel('r2', 'CALLS', 'a', 'b', 'static', 1.0)],
    );

    const result = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 50 });
    expect(result.candidates.map((c) => c.candidate)).toEqual(['b', 'a']); // b(depth1) before a(depth2)

    const bCand = result.candidates.find((c) => c.candidate === 'b')!;
    expect(bCand.confidence).toBe(0.8);
    expect(bCand.hasInferredHop).toBe(true);
    expect(bCand.path).toHaveLength(1);

    const aCand = result.candidates.find((c) => c.candidate === 'a')!;
    expect(aCand.confidence).toBeCloseTo(0.8, 10); // 1.0 * 0.8
    expect(aCand.hasInferredHop).toBe(true);
    expect(aCand.path).toHaveLength(2);
    expect(aCand.reason).toContain('(경로 2단계)');
    expect(result.stats.maxDepthReached).toBe(2);
  });

  it('respects depth: a candidate beyond the requested depth is not returned', () => {
    const db = freshDb();
    // a -> b -> root, depth=1 should only find b
    seed(
      db,
      [entity('root', 'root'), entity('b', 'b'), entity('a', 'a')],
      [rel('r1', 'CALLS', 'b', 'root'), rel('r2', 'CALLS', 'a', 'b')],
    );

    const result = computeImpact(db, { rootId: 'root', depth: 1, maxCandidates: 50 });
    expect(result.candidates.map((c) => c.candidate)).toEqual(['b']);
    expect(result.stats.maxDepthReached).toBe(1);
  });

  it('truncates to maxCandidates, keeping the highest-ranked candidates', () => {
    const db = freshDb();
    const entities = [entity('root', 'root')];
    const relationships: Relationship[] = [];
    for (let i = 0; i < 5; i++) {
      entities.push(entity(`c${i}`, `c${i}`));
      relationships.push(rel(`r${i}`, 'CALLS', `c${i}`, 'root'));
    }
    seed(db, entities, relationships);

    const result = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 2 });
    expect(result.candidates).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.stats.candidateCount).toBe(2);
  });

  it('does not infinite-loop on a cycle (A calls B calls A)', () => {
    const db = freshDb();
    seed(
      db,
      [entity('a', 'a'), entity('b', 'b')],
      [rel('r1', 'CALLS', 'a', 'b'), rel('r2', 'CALLS', 'b', 'a')],
    );

    const result = computeImpact(db, { rootId: 'a', depth: 5, maxCandidates: 50 });
    expect(result.candidates.map((c) => c.candidate)).toEqual(['b']);
    // b's path must terminate at root 'a', not loop back through the cycle
    expect(result.candidates[0]?.path).toHaveLength(1);
  });

  it('excludes DECLARES by default, but includes it when explicitly requested via types', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'root'), entity('file', 'index.ts')],
      [rel('r1', 'DECLARES', 'file', 'root')],
    );

    const withoutDeclares = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 50 });
    expect(withoutDeclares.candidates).toEqual([]);

    const withDeclares = computeImpact(db, {
      rootId: 'root',
      depth: 3,
      maxCandidates: 50,
      types: ['DECLARES'],
    });
    expect(withDeclares.candidates.map((c) => c.candidate)).toEqual(['file']);
    expect(withDeclares.candidates[0]?.reason).toBe('index.ts가 root를 선언합니다');
  });

  it('filters by resolution', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'root'), entity('a', 'a'), entity('b', 'b')],
      [rel('r1', 'CALLS', 'a', 'root', 'static', 1.0), rel('r2', 'CALLS', 'b', 'root', 'inferred', 0.8)],
    );

    const staticOnly = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 50, resolution: 'static' });
    expect(staticOnly.candidates.map((c) => c.candidate)).toEqual(['a']);
  });

  it('when a candidate is reachable via two paths, the higher-confidence one wins', () => {
    const db = freshDb();
    // a --CALLS(inferred,0.8)--> root
    // a --IMPLEMENTS(static,1.0)--> root  (contrived, but exercises the tie-break)
    seed(
      db,
      [entity('root', 'root'), entity('a', 'a')],
      [
        rel('r1', 'CALLS', 'a', 'root', 'inferred', 0.8),
        rel('r2', 'IMPLEMENTS', 'a', 'root', 'static', 1.0),
      ],
    );

    const result = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 50 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.confidence).toBe(1.0);
    expect(result.candidates[0]?.path[0]?.type).toBe('IMPLEMENTS');
  });

  it('returns no candidates for an entity with no incoming relationships', () => {
    const db = freshDb();
    seed(db, [entity('root', 'root')], []);
    const result = computeImpact(db, { rootId: 'root', depth: 3, maxCandidates: 50 });
    expect(result.candidates).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.stats.maxDepthReached).toBe(0);
  });
});
