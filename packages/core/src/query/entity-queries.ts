import type { Db } from '../storage/db.js';
import type { Entity, EntityKind } from '../types.js';
import { rowToEntity, type EntityRow } from '../storage/mappers.js';

export interface SearchEntitiesParams {
  projectId: string;
  name?: string;
  kind?: EntityKind;
  filePath?: string;
  limit: number;
  offset: number;
}

export interface SearchEntitiesResult {
  items: Entity[];
  total: number;
}

/** FR-Q2 — 이름(부분/대소문자 무시)/종류/파일 경로(접두 일치)로 Entity를 검색한다. */
export function searchEntities(db: Db, params: SearchEntitiesParams): SearchEntitiesResult {
  const conditions = ['project_id = ?'];
  const args: unknown[] = [params.projectId];

  if (params.name) {
    conditions.push('LOWER(name) LIKE ?');
    args.push(`%${params.name.toLowerCase()}%`);
  }
  if (params.kind) {
    conditions.push('kind = ?');
    args.push(params.kind);
  }
  if (params.filePath) {
    conditions.push('file_path LIKE ?');
    args.push(`${params.filePath}%`);
  }

  const where = conditions.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM entity WHERE ${where}`)
    .get(...(args as [])) as { c: number };

  const rows = db
    .prepare(
      `SELECT id, project_id, kind, name, file_path, start_line, end_line, revision
       FROM entity WHERE ${where} ORDER BY name, id LIMIT ? OFFSET ?`,
    )
    .all(...(args as []), params.limit, params.offset) as unknown as EntityRow[];

  return { items: rows.map(rowToEntity), total: total.c };
}

export function getEntity(db: Db, id: string): Entity | undefined {
  const row = db
    .prepare(
      `SELECT id, project_id, kind, name, file_path, start_line, end_line, revision
       FROM entity WHERE id = ?`,
    )
    .get(id) as unknown as EntityRow | undefined;
  return row ? rowToEntity(row) : undefined;
}

export interface RelationshipCounts {
  in: number;
  out: number;
}

export function getRelationshipCounts(db: Db, entityId: string): RelationshipCounts {
  const inCount = db
    .prepare('SELECT COUNT(*) AS c FROM relationship WHERE target_id = ?')
    .get(entityId) as { c: number };
  const outCount = db
    .prepare('SELECT COUNT(*) AS c FROM relationship WHERE source_id = ?')
    .get(entityId) as { c: number };
  return { in: inCount.c, out: outCount.c };
}

export function getEntitiesByIds(db: Db, ids: string[]): Entity[] {
  if (ids.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT id, project_id, kind, name, file_path, start_line, end_line, revision
       FROM entity WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids)) as unknown as EntityRow[];
  return rows.map(rowToEntity);
}
