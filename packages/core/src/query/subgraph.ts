import type { Db } from '../storage/db.js';
import type { Entity, Relationship, RelationshipType, Resolution } from '../types.js';
import { getEntitiesByIds } from './entity-queries.js';
import { hydrateRelationships } from './relationship-queries.js';
import type { RelationshipRow } from '../storage/mappers.js';

export type SubgraphDirection = 'out' | 'in' | 'both';

export interface SubgraphParams {
  rootId: string;
  direction: SubgraphDirection;
  depth: number;
  types?: RelationshipType[];
  resolution?: Resolution;
  maxNodes: number;
  includeSnippets: boolean;
}

export interface SubgraphResult {
  rootId: string;
  entities: Entity[];
  relationships: Relationship[];
  truncated: boolean;
  stats: { entityCount: number; relationshipCount: number; maxDepthReached: number };
}

const JOIN_BY_DIRECTION: Record<SubgraphDirection, string> = {
  out: `JOIN relationship r ON r.source_id = w.entity_id`,
  in: `JOIN relationship r ON r.target_id = w.entity_id`,
  both: `JOIN relationship r ON (r.source_id = w.entity_id OR r.target_id = w.entity_id)`,
};

const NEXT_ID_BY_DIRECTION: Record<SubgraphDirection, string> = {
  out: 'r.target_id',
  in: 'r.source_id',
  both: 'CASE WHEN r.source_id = w.entity_id THEN r.target_id ELSE r.source_id END',
};

/**
 * FR-Q4 — 방향/depth 기반 서브그래프 조회. DATA-MODEL.md §4의 recursive CTE 참조 구현을
 * direction=in/both과 types/resolution 필터, maxNodes 절단까지 확장한 것이다.
 */
export function getSubgraph(db: Db, params: SubgraphParams): SubgraphResult {
  const sql = `
    WITH RECURSIVE walk(entity_id, depth) AS (
      SELECT :root AS entity_id, 0 AS depth
      UNION
      SELECT ${NEXT_ID_BY_DIRECTION[params.direction]}, w.depth + 1
      FROM walk w
      ${JOIN_BY_DIRECTION[params.direction]}
      WHERE w.depth < :maxDepth
        AND (:types IS NULL OR r.type IN (SELECT value FROM json_each(:types)))
        AND (:resolution IS NULL OR r.resolution = :resolution)
    )
    SELECT entity_id, MIN(depth) AS depth FROM walk GROUP BY entity_id ORDER BY depth, entity_id
  `;

  const bindParams = {
    root: params.rootId,
    maxDepth: params.depth,
    types: params.types && params.types.length > 0 ? JSON.stringify(params.types) : null,
    resolution: params.resolution ?? null,
  };

  const nodeRows = db.prepare(sql).all(bindParams) as { entity_id: string; depth: number }[];

  const truncated = nodeRows.length > params.maxNodes;
  const included = truncated ? nodeRows.slice(0, params.maxNodes) : nodeRows;
  const includedIds = included.map((r) => r.entity_id);
  const maxDepthReached = included.reduce((max, r) => Math.max(max, r.depth), 0);

  const entities = getEntitiesByIds(db, includedIds);

  let relationships: Relationship[] = [];
  if (includedIds.length > 0) {
    const conditions = [
      'source_id IN (SELECT value FROM json_each(:ids))',
      'target_id IN (SELECT value FROM json_each(:ids))',
    ];
    const relBindParams: Record<string, string | number | null> = {
      ids: JSON.stringify(includedIds),
      types: bindParams.types,
      resolution: bindParams.resolution,
    };
    let relSql = `SELECT id, type, source_id, target_id, resolution, confidence, primary_evidence_id
                   FROM relationship WHERE ${conditions.join(' AND ')}`;
    relSql += ' AND (:types IS NULL OR type IN (SELECT value FROM json_each(:types)))';
    relSql += ' AND (:resolution IS NULL OR resolution = :resolution)';

    const relRows = db.prepare(relSql).all(relBindParams) as unknown as RelationshipRow[];
    relationships = hydrateRelationships(db, relRows, params.includeSnippets);
  }

  return {
    rootId: params.rootId,
    entities,
    relationships,
    truncated,
    stats: {
      entityCount: entities.length,
      relationshipCount: relationships.length,
      maxDepthReached,
    },
  };
}
