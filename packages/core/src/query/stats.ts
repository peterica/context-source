import type { Db } from '../storage/db.js';
import type {
  Entity,
  EntityKind,
  Relationship,
  RelationshipType,
  Resolution,
  UnresolvedReference,
  UnresolvedReferenceKind,
  UnresolvedReferenceReason,
} from '../types.js';
import { hydrateRelationships } from './relationship-queries.js';
import { getEntitiesByIds } from './entity-queries.js';
import { rowToUnresolvedReference, type RelationshipRow, type UnresolvedReferenceRow } from '../storage/mappers.js';

export interface ProjectStats {
  entities: { total: number; byKind: Record<EntityKind, number> };
  relationships: {
    total: number;
    byType: Record<RelationshipType, number>;
    byResolution: Record<Resolution, number>;
  };
  evidence: { total: number };
  /** ADR-0011 — 발견했지만 대상을 확정 못한 참조 개수. 그래프가 완전하지 않을 수 있다는 신호. */
  unresolvedReferences: {
    total: number;
    byKind: Record<UnresolvedReferenceKind, number>;
    byReason: Record<UnresolvedReferenceReason, number>;
  };
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
const UNRESOLVED_KINDS: UnresolvedReferenceKind[] = ['CALLS', 'IMPORTS', 'IMPLEMENTS', 'EXTENDS'];
const UNRESOLVED_REASONS: UnresolvedReferenceReason[] = [
  'entity-not-extracted',
  'ambiguous-callable-type',
  'internal-path-not-in-project',
  'unresolvable-specifier',
];

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

  const unresolvedTotal = db
    .prepare('SELECT COUNT(*) AS c FROM unresolved_reference WHERE project_id = ?')
    .get(projectId) as { c: number };

  const unresolvedByKindRows = db
    .prepare('SELECT kind, COUNT(*) AS c FROM unresolved_reference WHERE project_id = ? GROUP BY kind')
    .all(projectId) as unknown as { kind: UnresolvedReferenceKind; c: number }[];
  const unresolvedByKind = Object.fromEntries(UNRESOLVED_KINDS.map((k) => [k, 0])) as Record<
    UnresolvedReferenceKind,
    number
  >;
  for (const row of unresolvedByKindRows) unresolvedByKind[row.kind] = row.c;

  const unresolvedByReasonRows = db
    .prepare('SELECT reason, COUNT(*) AS c FROM unresolved_reference WHERE project_id = ? GROUP BY reason')
    .all(projectId) as unknown as { reason: UnresolvedReferenceReason; c: number }[];
  const unresolvedByReason = Object.fromEntries(UNRESOLVED_REASONS.map((r) => [r, 0])) as Record<
    UnresolvedReferenceReason,
    number
  >;
  for (const row of unresolvedByReasonRows) unresolvedByReason[row.reason] = row.c;

  return {
    entities: { total: entityTotal.c, byKind },
    relationships: { total: relTotal.c, byType, byResolution },
    evidence: { total: evidenceTotal.c },
    unresolvedReferences: { total: unresolvedTotal.c, byKind: unresolvedByKind, byReason: unresolvedByReason },
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

export interface UnresolvedReferenceItem {
  reference: UnresolvedReference;
  source: Entity;
}

export interface ListUnresolvedReferencesResult {
  items: UnresolvedReferenceItem[];
  total: number;
}

/**
 * ADR-0011 — "검토" 탭의 사각지대 섹션을 위한 조회. inferred 관계 검토와 같은 페이지네이션
 * 관례를 따른다. 대상 Entity가 없으므로(그게 이 테이블의 존재 이유다) source Entity만 함께 준다.
 */
export function listUnresolvedReferences(
  db: Db,
  projectId: string,
  limit: number,
  offset: number,
): ListUnresolvedReferencesResult {
  const total = db
    .prepare('SELECT COUNT(*) AS c FROM unresolved_reference WHERE project_id = ?')
    .get(projectId) as { c: number };

  const rows = db
    .prepare(
      `SELECT id, project_id, source_id, kind, reason, file_path, start_line, start_col, end_line, end_col, snippet, analyzer, revision
       FROM unresolved_reference
       WHERE project_id = ?
       ORDER BY id LIMIT ? OFFSET ?`,
    )
    .all(projectId, limit, offset) as unknown as UnresolvedReferenceRow[];

  const sourceIds = [...new Set(rows.map((r) => r.source_id))];
  const entitiesById = new Map(getEntitiesByIds(db, sourceIds).map((e) => [e.id, e]));

  const items: UnresolvedReferenceItem[] = rows.map((row) => {
    const source = entitiesById.get(row.source_id);
    if (!source) throw new Error(`Entity missing for unresolved_reference ${row.id}`);
    return { reference: rowToUnresolvedReference(row), source };
  });

  return { items, total: total.c };
}
