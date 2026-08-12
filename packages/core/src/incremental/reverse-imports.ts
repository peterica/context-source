import type { Db } from '../storage/db.js';

/** 주어진 파일들을 직접 IMPORTS 하는 파일(역방향 1단계)만 조회하는 내부 primitive. */
function findDirectReverseImporters(db: Db, projectId: string, filePaths: string[]): string[] {
  if (filePaths.length === 0) return [];
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
    .all(projectId, JSON.stringify(filePaths)) as unknown as { file_path: string }[];
  return rows.map((r) => r.file_path);
}

/**
 * 변경된 파일을 IMPORTS 하는 파일, 그리고 그 파일을 다시 IMPORTS 하는 파일... 을 고정점(fixpoint)에
 * 도달할 때까지 반복해 전이적 폐포(transitive closure)로 구한다 (FR-A6, DATA-MODEL.md §3.2).
 *
 * 예전에는 1단계만 구했다 — 실제 규모 검증(typeorm, 약 28만 LOC)에서 이 때문에 증분 분석이 관계의
 * 17.7%를 조용히 잃어버리는 결함이 재현됐다(BENCHMARK.md 5.11): 변경 파일의 직접 reverse-importer
 * Z는 재분석 대상에 포함되어 entity가 delete+reinsert되지만, Z를 호출하면서도 Z를 "직접 변경된
 * 파일"이 아니라 "Z를 import하는 파일"로서만 찾을 수 있는 W(예: Z를 import하는 다른 파일)는
 * 1단계로는 발견되지 않는다 — Z의 entity가 지워질 때 W→Z 관계가 cascade로 삭제되고, W는 재분석
 * 대상이 아니므로 그 관계가 다시는 만들어지지 않는다. 전이적 폐포로 구하면 W도 재분석 대상에
 * 포함되어 W→Z 관계가 올바르게 재생성된다.
 */
export function findReverseImporters(db: Db, projectId: string, changedFilePaths: string[]): string[] {
  const changedSet = new Set(changedFilePaths);
  const result = new Set<string>();
  let frontier = changedFilePaths;
  while (frontier.length > 0) {
    const found = findDirectReverseImporters(db, projectId, frontier);
    const newlyFound = found.filter((f) => !changedSet.has(f) && !result.has(f));
    for (const f of newlyFound) result.add(f);
    frontier = newlyFound;
  }
  return [...result];
}
