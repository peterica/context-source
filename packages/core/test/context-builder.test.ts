import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { insertEntities, insertRelationshipsWithEvidence, runInTransaction } from '../src/storage/ingest.js';
import { buildContext } from '../src/query/context-builder.js';
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
  upsertProject(db, { id: PROJECT, name: 'context-builder-test', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
  return db;
}

const BASE_PARAMS = { projectId: PROJECT, tokenBudget: 5000, maxSeeds: 10, depth: 3, includeSnippets: true };

describe('buildContext (ADR-0012)', () => {
  it('returns an empty, non-truncated result when the query matches no entity', () => {
    const db = freshDb();
    seed(db, [entity('root', 'PaymentService')], []);
    const result = buildContext(db, { ...BASE_PARAMS, query: 'NoSuchThing' });
    expect(result.seeds).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.estimatedTokens).toBe(0);
  });

  it('finds a seed by substring name match and expands one hop outward (out direction)', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'PaymentService'), entity('dep', 'Logger')],
      [rel('r1', 'IMPORTS', 'root', 'dep')],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment' });
    expect(result.seeds.map((s) => s.id)).toEqual(['root']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.entity.id).toBe('dep');
    expect(result.items[0]?.relationshipType).toBe('IMPORTS');
    expect(result.items[0]?.hopDepth).toBe(1);
    expect(result.items[0]?.reason).toBe('PaymentService가 Logger를 import합니다');
  });

  it('also expands inward (in direction) — unlike computeImpact this is bidirectional', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'PaymentService'), entity('caller', 'OrderController')],
      [rel('r1', 'CALLS', 'caller', 'root')], // caller -> root, i.e. root is CALLED (incoming)
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment' });
    expect(result.items.map((i) => i.entity.id)).toEqual(['caller']);
    expect(result.items[0]?.reason).toBe('OrderController가 PaymentService를 호출합니다');
  });

  it('multi-hop: confidence multiplies along the real discovery path and hopDepth reflects distance', () => {
    const db = freshDb();
    // root --CALLS(inferred,0.8)--> b --CALLS(static,1.0)--> c
    seed(
      db,
      [entity('root', 'PaymentService'), entity('b', 'Middle'), entity('c', 'Far')],
      [rel('r1', 'CALLS', 'root', 'b', 'inferred', 0.8), rel('r2', 'CALLS', 'b', 'c', 'static', 1.0)],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment' });
    const b = result.items.find((i) => i.entity.id === 'b')!;
    const c = result.items.find((i) => i.entity.id === 'c')!;
    expect(b.hopDepth).toBe(1);
    expect(b.confidence).toBe(0.8);
    expect(b.hasInferredHop).toBe(true);
    expect(c.hopDepth).toBe(2);
    expect(c.confidence).toBeCloseTo(0.8, 10); // 0.8 * 1.0, product of the whole path back to the seed
    expect(c.hasInferredHop).toBe(true);
    expect(c.reason).toContain('(경로 2단계)');
  });

  it('multiple seeds: a candidate reachable from two seeds is deduplicated and gets the shorter hop distance', () => {
    const db = freshDb();
    seed(
      db,
      [entity('s1', 'ServiceA'), entity('s2', 'ServiceB'), entity('shared', 'SharedUtil'), entity('far', 'FarFromB')],
      [
        rel('r1', 'CALLS', 's1', 'shared'), // s1 -> shared: 1 hop
        rel('r2', 'CALLS', 's2', 'far'),
        rel('r3', 'CALLS', 'far', 'shared'), // s2 -> far -> shared: 2 hops
      ],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Service', maxSeeds: 10 });
    expect(result.seeds.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    const sharedItems = result.items.filter((i) => i.entity.id === 'shared');
    expect(sharedItems).toHaveLength(1); // not once per seed
    expect(sharedItems[0]?.hopDepth).toBe(1); // reached from s1 in 1 hop, not via s2's 2-hop path
  });

  it('priority ranking: CALLS ranks above IMPORTS above DECLARES at the same hop depth', () => {
    const db = freshDb();
    seed(
      db,
      [
        entity('root', 'PaymentService'),
        entity('callee', 'ByCalls'),
        entity('imported', 'ByImports'),
        entity('member', 'ByDeclares'),
      ],
      [
        rel('r1', 'DECLARES', 'root', 'member'),
        rel('r2', 'IMPORTS', 'root', 'imported'),
        rel('r3', 'CALLS', 'root', 'callee'),
      ],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment' });
    expect(result.items.map((i) => i.entity.id)).toEqual(['callee', 'imported', 'member']);
  });

  it('DECLARES is included by default (unlike computeImpact)', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'PaymentService'), entity('member', 'charge')],
      [rel('r1', 'DECLARES', 'root', 'member')],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment' });
    expect(result.items.map((i) => i.entity.id)).toEqual(['member']);
  });

  it('token budget: stops in priority order once the budget is exceeded and reports truncated', () => {
    const db = freshDb();
    const entities = [entity('root', 'PaymentService')];
    const relationships: Relationship[] = [];
    for (let i = 0; i < 8; i++) {
      entities.push(entity(`c${i}`, `Callee${i}`));
      relationships.push(rel(`r${i}`, 'CALLS', 'root', `c${i}`));
    }
    seed(db, entities, relationships);

    const generous = buildContext(db, { ...BASE_PARAMS, query: 'Payment', tokenBudget: 100000 });
    expect(generous.items).toHaveLength(8);
    expect(generous.truncated).toBe(false);

    const tight = buildContext(db, { ...BASE_PARAMS, query: 'Payment', tokenBudget: 1 });
    expect(tight.items).toHaveLength(0);
    expect(tight.truncated).toBe(true);
    expect(tight.estimatedTokens).toBe(0);
  });

  it('includeSnippets=false omits snippet text and lowers the token estimate', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'PaymentService'), entity('dep', 'SomeVeryLongDependencyNameForSnippetTesting')],
      [rel('r1', 'CALLS', 'root', 'dep')],
    );
    const withSnippets = buildContext(db, { ...BASE_PARAMS, query: 'Payment', includeSnippets: true });
    const withoutSnippets = buildContext(db, { ...BASE_PARAMS, query: 'Payment', includeSnippets: false });
    expect(withSnippets.items[0]?.evidence[0]?.snippet.length).toBeGreaterThan(0);
    expect(withoutSnippets.items[0]?.evidence[0]?.snippet).toBe('');
    expect(withoutSnippets.estimatedTokens).toBeLessThan(withSnippets.estimatedTokens);
  });

  it('respects the resolution filter', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'PaymentService'), entity('a', 'StaticDep'), entity('b', 'InferredDep')],
      [rel('r1', 'CALLS', 'root', 'a', 'static', 1.0), rel('r2', 'CALLS', 'root', 'b', 'inferred', 0.8)],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment', resolution: 'static' });
    expect(result.items.map((i) => i.entity.id)).toEqual(['a']);
  });

  it('does not infinite-loop on a cycle', () => {
    const db = freshDb();
    seed(
      db,
      [entity('root', 'PaymentService'), entity('a', 'A'), entity('b', 'B')],
      [rel('r1', 'CALLS', 'root', 'a'), rel('r2', 'CALLS', 'a', 'b'), rel('r3', 'CALLS', 'b', 'root')],
    );
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Payment', depth: 5 });
    expect(result.items.map((i) => i.entity.id).sort()).toEqual(['a', 'b']);
  });

  it('respects maxSeeds', () => {
    const db = freshDb();
    const entities: Entity[] = [];
    for (let i = 0; i < 5; i++) entities.push(entity(`s${i}`, `Widget${i}`));
    seed(db, entities, []);
    const result = buildContext(db, { ...BASE_PARAMS, query: 'Widget', maxSeeds: 2 });
    expect(result.seeds).toHaveLength(2);
  });
});
