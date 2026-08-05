import type { Db } from './db.js';
import type { Entity, Relationship } from '../types.js';

/**
 * project_id + file_path 기준으로 Entity를 삭제한다.
 * relationship(source_id/target_id)과 evidence는 ON DELETE CASCADE로 연쇄 삭제된다 (DATA-MODEL §3.2).
 * external_module Entity는 file_path가 없으므로 이 함수로 삭제되지 않는다 — 참조하는 IMPORTS가 모두
 * 사라져도 재분석 시 그대로 재사용되며, 참조가 전혀 없는 고아 ExternalModule은 무해하게 남는다(MVP 허용 범위).
 */
export function deleteEntitiesByFilePaths(db: Db, projectId: string, filePaths: string[]): void {
  if (filePaths.length === 0) return;
  db.prepare(
    `DELETE FROM entity
     WHERE project_id = ?
       AND file_path IN (SELECT value FROM json_each(?))`,
  ).run(projectId, JSON.stringify(filePaths));
}

export function insertEntities(db: Db, entities: Entity[]): void {
  const stmt = db.prepare(
    `INSERT INTO entity (id, project_id, kind, name, file_path, start_line, end_line, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of entities) {
    stmt.run(
      e.id,
      e.projectId,
      e.kind,
      e.name,
      e.filePath,
      e.range?.startLine ?? null,
      e.range?.endLine ?? null,
      e.revision,
    );
  }
}

/**
 * ExternalModule처럼 재분석 대상 파일 삭제 범위 밖에서도 재사용되는 Entity를 멱등하게 삽입한다.
 */
export function upsertExternalModuleEntities(db: Db, entities: Entity[]): void {
  const stmt = db.prepare(
    `INSERT INTO entity (id, project_id, kind, name, file_path, start_line, end_line, revision)
     VALUES (?, ?, 'external_module', ?, NULL, NULL, NULL, NULL)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const e of entities) {
    stmt.run(e.id, e.projectId, e.name);
  }
}

/**
 * Relationship + Evidence를 DATA-MODEL §3.1의 순서(관계 → Evidence → COMMIT에서 deferred FK 검증)로 삽입한다.
 * 호출자가 트랜잭션 경계를 관리한다.
 */
export function insertRelationshipsWithEvidence(db: Db, relationships: Relationship[]): void {
  const relStmt = db.prepare(
    `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const evStmt = db.prepare(
    `INSERT INTO evidence
       (id, relationship_id, file_path, start_line, start_col, end_line, end_col, snippet, analyzer, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const rel of relationships) {
    if (rel.evidence.length === 0) {
      throw new Error(`Relationship ${rel.id} has no evidence — refusing to persist (PRD 4.2)`);
    }
    const primary = rel.evidence[0]!;
    relStmt.run(rel.id, rel.type, rel.sourceId, rel.targetId, rel.resolution, rel.confidence, primary.id);
    for (const ev of rel.evidence) {
      evStmt.run(
        ev.id,
        rel.id,
        ev.filePath,
        ev.range.startLine,
        ev.range.startCol,
        ev.range.endLine,
        ev.range.endCol,
        ev.snippet,
        ev.analyzer,
        ev.revision,
      );
    }
  }
}

export function runInTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Full scan 결과로 프로젝트 전체 그래프를 대체한다 (M2). 증분(M3)은 별도 함수에서
 * 파일 범위를 좁혀 같은 하위 함수(insertEntities/insertRelationshipsWithEvidence)를 재사용한다.
 */
export function replaceProjectGraph(
  db: Db,
  projectId: string,
  entities: Entity[],
  relationships: Relationship[],
): void {
  runInTransaction(db, () => {
    db.prepare('DELETE FROM entity WHERE project_id = ?').run(projectId);
    const nonExternal = entities.filter((e) => e.kind !== 'external_module');
    const external = entities.filter((e) => e.kind === 'external_module');
    insertEntities(db, nonExternal);
    upsertExternalModuleEntities(db, external);
    insertRelationshipsWithEvidence(db, relationships);
  });
}
