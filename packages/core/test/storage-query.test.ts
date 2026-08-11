import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { replaceProjectGraph } from '../src/storage/ingest.js';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';
import { searchEntities, getEntity, getRelationshipCounts } from '../src/query/entity-queries.js';
import { listCallees, listCallers, listConnectedRelationships } from '../src/query/relationship-queries.js';
import { getSubgraph } from '../src/query/subgraph.js';
import { runFullAnalysis } from '../src/orchestrator.js';
import { getLastCompletedRun, listRuns } from '../src/storage/run-repo.js';
import { fileEntityId, symbolEntityId } from '../src/id.js';
import { fixtureTsconfig } from './helpers.js';

const PROJECT = 'p1';

describe('storage + query engine against a real analyzed project', () => {
  let db: Db;

  beforeAll(() => {
    db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'overload-generic', rootPath: '/fixtures/overload-generic', tsconfigPath: fixtureTsconfig('overload-generic') });
    const result = analyzeProject({
      tsconfigPath: fixtureTsconfig('overload-generic'),
      projectId: PROJECT,
      revision: 'rev1',
    });
    replaceProjectGraph(db, PROJECT, result.entities, result.relationships);
  });

  it('FR-Q2 searchEntities: name partial match (case-insensitive)', () => {
    const res = searchEntities(db, { projectId: PROJECT, name: 'IDENT', limit: 50, offset: 0 });
    expect(res.items.some((e) => e.name === 'identity')).toBe(true);
  });

  it('FR-Q2 searchEntities: filter by kind', () => {
    const res = searchEntities(db, { projectId: PROJECT, kind: 'class', limit: 50, offset: 0 });
    expect(res.items.every((e) => e.kind === 'class')).toBe(true);
    expect(res.items.some((e) => e.name === 'Box')).toBe(true);
  });

  it('FR-Q2 searchEntities: filter by filePath prefix', () => {
    const res = searchEntities(db, { projectId: PROJECT, filePath: 'src/math', limit: 50, offset: 0 });
    expect(res.items.every((e) => e.filePath?.startsWith('src/math'))).toBe(true);
  });

  it('getEntity + getRelationshipCounts', () => {
    const id = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const entity = getEntity(db, id);
    expect(entity?.kind).toBe('function');
    const counts = getRelationshipCounts(db, id);
    expect(counts.in).toBeGreaterThan(0); // DECLARES + CALLS from usage.ts
  });

  it('FR-Q3 listCallers/listCallees (CALLS only)', () => {
    const identityId = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const callers = listCallers(db, identityId, 50, 0);
    expect(callers.items).toHaveLength(1);
    expect(callers.items[0]?.relationship.type).toBe('CALLS');
    expect(callers.items[0]?.counterpart.name).toBe('run');

    const runId = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const callees = listCallees(db, runId, 50, 0);
    expect(callees.items.length).toBeGreaterThanOrEqual(3); // identity, Box.get, Box(new)
    expect(callees.items.every((i) => i.relationship.type === 'CALLS')).toBe(true);
  });

  it('FR-Q5 listConnectedRelationships supports direction + type + resolution filters', () => {
    const mathFileId = fileEntityId(PROJECT, 'src/math.ts');
    const outOnly = listConnectedRelationships(db, {
      entityId: mathFileId,
      direction: 'out',
      limit: 50,
      offset: 0,
    });
    expect(outOnly.items.every((i) => i.relationship.sourceId === mathFileId)).toBe(true);

    const declaresOnly = listConnectedRelationships(db, {
      entityId: mathFileId,
      direction: 'out',
      types: ['DECLARES'],
      limit: 50,
      offset: 0,
    });
    expect(declaresOnly.items.every((i) => i.relationship.type === 'DECLARES')).toBe(true);

    const staticOnly = listConnectedRelationships(db, {
      entityId: mathFileId,
      direction: 'both',
      resolution: 'static',
      limit: 50,
      offset: 0,
    });
    expect(staticOnly.items.every((i) => i.relationship.resolution === 'static')).toBe(true);
  });

  it('FR-Q6 relationships always carry Evidence', () => {
    const runId = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const callees = listCallees(db, runId, 50, 0);
    for (const item of callees.items) {
      expect(item.relationship.evidence.length).toBeGreaterThan(0);
    }
  });

  it('FR-Q4 getSubgraph respects direction/depth and returns only edges between included entities', () => {
    const usageFileId = fileEntityId(PROJECT, 'src/usage.ts');
    const sg = getSubgraph(db, {
      rootId: usageFileId,
      direction: 'out',
      depth: 2,
      maxNodes: 200,
      includeSnippets: true,
    });
    expect(sg.entities.some((e) => e.id === usageFileId)).toBe(true);
    const entityIds = new Set(sg.entities.map((e) => e.id));
    for (const rel of sg.relationships) {
      expect(entityIds.has(rel.sourceId)).toBe(true);
      expect(entityIds.has(rel.targetId)).toBe(true);
    }
    expect(sg.stats.entityCount).toBe(sg.entities.length);
  });

  it('FR-AI3 getSubgraph truncates at maxNodes and reports truncated:true', () => {
    const usageFileId = fileEntityId(PROJECT, 'src/usage.ts');
    const sg = getSubgraph(db, {
      rootId: usageFileId,
      direction: 'both',
      depth: 5,
      maxNodes: 1,
      includeSnippets: true,
    });
    expect(sg.truncated).toBe(true);
    expect(sg.entities.length).toBeLessThanOrEqual(1);
  });

  it('getSubgraph includeSnippets:false omits snippet text', () => {
    const usageFileId = fileEntityId(PROJECT, 'src/usage.ts');
    const sg = getSubgraph(db, {
      rootId: usageFileId,
      direction: 'out',
      depth: 2,
      maxNodes: 200,
      includeSnippets: false,
    });
    for (const rel of sg.relationships) {
      for (const ev of rel.evidence) {
        expect(ev.snippet).toBe('');
      }
    }
  });
});

describe('runFullAnalysis orchestrator (analyze -> persist -> run history)', () => {
  it('records a completed analysis_run and makes results queryable', () => {
    const db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'basic-import', rootPath: '/fixtures/basic-import', tsconfigPath: fixtureTsconfig('basic-import') });
    const run = runFullAnalysis({
      db,
      projectId: PROJECT,
      tsconfigPath: fixtureTsconfig('basic-import'),
      revision: 'rev1',
    });
    expect(run.status).toBe('completed');
    expect(run.entityCount).toBeGreaterThan(0);
    expect(run.relationshipCount).toBeGreaterThan(0);

    const last = getLastCompletedRun(db, PROJECT);
    expect(last?.id).toBe(run.id);
    expect(listRuns(db, PROJECT, 10)).toHaveLength(1);

    const foo = getEntity(db, symbolEntityId(PROJECT, 'src/a.ts', 'foo'));
    expect(foo).toBeDefined();
  });
});
