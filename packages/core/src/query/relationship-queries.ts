import type { Db } from '../storage/db.js';
import type { Entity, Relationship, RelationshipType, Resolution } from '../types.js';
import {
  rowToEvidence,
  rowToRelationship,
  type EntityRow,
  type EvidenceRow,
  type RelationshipRow,
} from '../storage/mappers.js';
import { getEntitiesByIds } from './entity-queries.js';

export type Direction = 'in' | 'out' | 'both';

export function loadEvidenceForRelationships(
  db: Db,
  relationshipIds: string[],
  includeSnippets = true,
): Map<string, Relationship['evidence']> {
  if (relationshipIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT id, relationship_id, file_path, start_line, start_col, end_line, end_col, snippet, analyzer, revision
       FROM evidence WHERE relationship_id IN (SELECT value FROM json_each(?))
       ORDER BY start_line, start_col`,
    )
    .all(JSON.stringify(relationshipIds)) as unknown as EvidenceRow[];

  const byRel = new Map<string, Relationship['evidence']>();
  for (const row of rows) {
    const list = byRel.get(row.relationship_id) ?? [];
    list.push(rowToEvidence(row, includeSnippets));
    byRel.set(row.relationship_id, list);
  }
  return byRel;
}

export function hydrateRelationships(
  db: Db,
  rows: RelationshipRow[],
  includeSnippets = true,
): Relationship[] {
  const evidenceByRel = loadEvidenceForRelationships(
    db,
    rows.map((r) => r.id),
    includeSnippets,
  );
  return rows.map((row) => rowToRelationship(row, evidenceByRel.get(row.id) ?? []));
}

export interface ConnectedRelationshipsParams {
  entityId: string;
  direction: Direction;
  types?: RelationshipType[];
  resolution?: Resolution;
  limit: number;
  offset: number;
}

export interface ConnectedRelationshipItem {
  relationship: Relationship;
  counterpart: Entity;
}

export interface ConnectedRelationshipsResult {
  items: ConnectedRelationshipItem[];
  total: number;
}

function directionWhere(direction: Direction): string {
  if (direction === 'out') return 'source_id = ?';
  if (direction === 'in') return 'target_id = ?';
  return '(source_id = ? OR target_id = ?)';
}

function directionArgs(direction: Direction, entityId: string): string[] {
  return direction === 'both' ? [entityId, entityId] : [entityId];
}

export function listConnectedRelationships(
  db: Db,
  params: ConnectedRelationshipsParams,
): ConnectedRelationshipsResult {
  const conditions = [directionWhere(params.direction)];
  const args: unknown[] = [...directionArgs(params.direction, params.entityId)];

  if (params.types && params.types.length > 0) {
    conditions.push('type IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(params.types));
  }
  if (params.resolution) {
    conditions.push('resolution = ?');
    args.push(params.resolution);
  }

  const where = conditions.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM relationship WHERE ${where}`)
    .get(...(args as [])) as { c: number };

  const rows = db
    .prepare(
      `SELECT id, type, source_id, target_id, resolution, confidence, primary_evidence_id
       FROM relationship WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
    )
    .all(...(args as []), params.limit, params.offset) as unknown as RelationshipRow[];

  const relationships = hydrateRelationships(db, rows, true);

  const counterpartIds = rows.map((r) =>
    r.source_id === params.entityId ? r.target_id : r.source_id,
  );
  const counterpartEntities = new Map(
    getEntitiesByIds(db, [...new Set(counterpartIds)]).map((e) => [e.id, e]),
  );

  const items: ConnectedRelationshipItem[] = rows.map((row, i) => {
    const counterpartId = counterpartIds[i]!;
    const counterpart = counterpartEntities.get(counterpartId);
    if (!counterpart) {
      throw new Error(`Counterpart entity ${counterpartId} not found for relationship ${row.id}`);
    }
    return { relationship: relationships[i]!, counterpart };
  });

  return { items, total: total.c };
}

export function listCallers(
  db: Db,
  entityId: string,
  limit: number,
  offset: number,
): ConnectedRelationshipsResult {
  return listConnectedRelationships(db, {
    entityId,
    direction: 'in',
    types: ['CALLS'],
    limit,
    offset,
  });
}

export function listCallees(
  db: Db,
  entityId: string,
  limit: number,
  offset: number,
): ConnectedRelationshipsResult {
  return listConnectedRelationships(db, {
    entityId,
    direction: 'out',
    types: ['CALLS'],
    limit,
    offset,
  });
}

// re-export row types used by callers of this module (API layer)
export type { EntityRow };
