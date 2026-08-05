import type { Db } from '../storage/db.js';
import type { EntityKind, Relationship, RelationshipType, Resolution } from '../types.js';
import { hydrateRelationships } from './relationship-queries.js';
import { getEntitiesByIds } from './entity-queries.js';
import type { RelationshipRow } from '../storage/mappers.js';

export interface ProjectStats {
  entities: { total: number; byKind: Record<EntityKind, number> };
  relationships: {
    total: number;
    byType: Record<RelationshipType, number>;
    byResolution: Record<Resolution, number>;
  };
  evidence: { total: number };
}

const ENTITY_KINDS: EntityKind[] = [
  'file',
  'class',
  'interface',
  'function',
  'method',
  'external_module',
];
const RELATIONSHIP_TYPES: RelationshipType[] = [
  'DECLARES',
  'IMPORTS',
  'CALLS',
  'IMPLEMENTS',
  'EXTENDS',
];
const RESOLUTIONS: Resolution[] = ['static', 'inferred'];

/**
 * Web UI Overview 화면(claude-do.md M4 "Entity/Relationship/Evidence 통계")을 위한 집계 조회.
 * API.md에 명시되지 않은 보조 endpoint — 전체 그래프를 내려주지 않고 개수만 집계한다 (Query-first 원칙 유지).
 */
export function getProjectStats(db: Db, projectId: string): ProjectStats {
  const entityTotal = db
    .prepare('SELECT COUNT(*) AS c FROM entity WHERE project_id = ?')
    .get(projectId) as { c: number };

  const byKindRows = db
    .prepare('SELECT kind, COUNT(*) AS c FROM entity WHERE project_id = ? GROUP BY kind')
    .all(projectId) as unknown as { kind: EntityKind; c: number }[];
  const byKind = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>;
  for (const row of byKindRows) byKind[row.kind] = row.c;

  const relTotal = db
    .prepare(
      `SELECT COUNT(*) AS c FROM relationship r JOIN entity s ON s.id = r.source_id WHERE s.project_id = ?`,
    )
    .get(projectId) as { c: number };

  const byTypeRows = db
    .prepare(
      `SELECT r.type AS type, COUNT(*) AS c FROM relationship r
       JOIN entity s ON s.id = r.source_id WHERE s.project_id = ? GROUP BY r.type`,
    )
    .all(projectId) as unknown as { type: RelationshipType; c: number }[];
  const byType = Object.fromEntries(RELATIONSHIP_TYPES.map((t) => [t, 0])) as Record<
    RelationshipType,
    number
  >;
  for (const row of byTypeRows) byType[row.type] = row.c;

  const byResolutionRows = db
    .prepare(
      `SELECT r.resolution AS resolution, COUNT(*) AS c FROM relationship r
       JOIN entity s ON s.id = r.source_id WHERE s.project_id = ? GROUP BY r.resolution`,
    )
    .all(projectId) as unknown as { resolution: Resolution; c: number }[];
  const byResolution = Object.fromEntries(RESOLUTIONS.map((r) => [r, 0])) as Record<
    Resolution,
    number
  >;
  for (const row of byResolutionRows) byResolution[row.resolution] = row.c;

  const evidenceTotal = db
    .prepare(
      `SELECT COUNT(*) AS c FROM evidence e
       JOIN relationship r ON r.id = e.relationship_id
       JOIN entity s ON s.id = r.source_id WHERE s.project_id = ?`,
    )
    .get(projectId) as { c: number };

  return {
    entities: { total: entityTotal.c, byKind },
    relationships: { total: relTotal.c, byType, byResolution },
    evidence: { total: evidenceTotal.c },
  };
}

export interface InferredRelationshipItem {
  relationship: Relationship;
  source: ReturnType<typeof getEntitiesByIds>[number];
  target: ReturnType<typeof getEntitiesByIds>[number];
}

export interface ListInferredRelationshipsResult {
  items: InferredRelationshipItem[];
  total: number;
}

/**
 * claude-do.md M4 "분석 실패 및 inferred 관계 검토 항목" 화면을 위한 조회.
 * static이 아닌(추론된) 관계를 프로젝트 전역에서 페이지네이션하여 review 목록으로 제공한다.
 */
export function listInferredRelationships(
  db: Db,
  projectId: string,
  limit: number,
  offset: number,
): ListInferredRelationshipsResult {
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM relationship r JOIN entity s ON s.id = r.source_id
       WHERE s.project_id = ? AND r.resolution = 'inferred'`,
    )
    .get(projectId) as { c: number };

  const rows = db
    .prepare(
      `SELECT r.id, r.type, r.source_id, r.target_id, r.resolution, r.confidence, r.primary_evidence_id
       FROM relationship r JOIN entity s ON s.id = r.source_id
       WHERE s.project_id = ? AND r.resolution = 'inferred'
       ORDER BY r.confidence ASC, r.id LIMIT ? OFFSET ?`,
    )
    .all(projectId, limit, offset) as unknown as RelationshipRow[];

  const relationships = hydrateRelationships(db, rows, true);
  const entityIds = [...new Set(rows.flatMap((r) => [r.source_id, r.target_id]))];
  const entitiesById = new Map(getEntitiesByIds(db, entityIds).map((e) => [e.id, e]));

  const items: InferredRelationshipItem[] = rows.map((row, i) => {
    const source = entitiesById.get(row.source_id);
    const target = entitiesById.get(row.target_id);
    if (!source || !target) throw new Error(`Entity missing for relationship ${row.id}`);
    return { relationship: relationships[i]!, source, target };
  });

  return { items, total: total.c };
}
