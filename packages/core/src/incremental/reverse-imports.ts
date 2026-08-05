import type { Db } from '../storage/db.js';

/**
 * 변경된 파일을 IMPORTS 하는 파일(역방향 1단계)을 조회한다 (FR-A6, DATA-MODEL.md §3.2).
 */
export function findReverseImporters(db: Db, projectId: string, changedFilePaths: string[]): string[] {
  if (changedFilePaths.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT src.file_path AS file_path
       FROM relationship r
       JOIN entity src ON src.id = r.source_id
       JOIN entity tgt ON tgt.id = r.target_id
       WHERE r.type = 'IMPORTS'
         AND src.project_id = ?
         AND tgt.file_path IN (SELECT value FROM json_each(?))`,
    )
    .all(projectId, JSON.stringify(changedFilePaths)) as unknown as { file_path: string }[];
  return rows.map((r) => r.file_path);
}
