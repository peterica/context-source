import { realpathSync } from 'node:fs';
import { analyzeProject } from '../analyzer/project-analyzer.js';
import { loadProgram } from '../analyzer/program.js';
import { deleteEntitiesByFilePaths, insertEntities, insertRelationshipsWithEvidence, runInTransaction, upsertExternalModuleEntities } from '../storage/ingest.js';
import { completeRun, createRun, failRun, getLastCompletedRun, isAnyRunInProgress } from '../storage/run-repo.js';
import type { Db } from '../storage/db.js';
import type { AnalysisRun } from '../types.js';
import { fileEntityId } from '../id.js';
import { currentRevision, diffNameStatus, resolveGitRoot, toProjectRelative } from './git.js';
import { findReverseImporters } from './reverse-imports.js';

export interface RunIncrementalAnalysisOptions {
  db: Db;
  projectId: string;
  tsconfigPath: string;
}

/**
 * FR-A6 — Git diff 기반 증분 재분석.
 * 재분석 대상 F = 변경된 파일(추가+수정+rename 신규 경로) ∪ 그 파일들을 IMPORTS 하는 파일(역방향 1단계)
 *              ∪ 직전 run에서 실패했던 파일(diff 포함 여부 무관, DATA-MODEL §3.2).
 */
export function runIncrementalAnalysis(options: RunIncrementalAnalysisOptions): AnalysisRun {
  const { db, projectId, tsconfigPath } = options;

  if (isAnyRunInProgress(db, projectId)) {
    throw Object.assign(new Error('ANALYSIS_IN_PROGRESS'), { code: 'ANALYSIS_IN_PROGRESS' });
  }

  const lastRun = getLastCompletedRun(db, projectId);
  if (!lastRun) {
    throw Object.assign(
      new Error('완료된 전체 분석이 없습니다 — 증분 분석 전에 전체 분석을 먼저 실행하세요'),
      { code: 'INVALID_PARAM' },
    );
  }

  const { projectRoot } = loadProgram(tsconfigPath);
  // git이 반환하는 저장소 루트는 symlink를 해석한 실경로다 (예: macOS /var -> /private/var).
  // projectRoot와 안전하게 비교/조합하려면 양쪽 모두 실경로로 정규화해야 한다.
  const realProjectRoot = realpathSync(projectRoot);
  const repoRoot = resolveGitRoot(realProjectRoot);
  const baseRevision = lastRun.revision;
  const targetRevision = currentRevision(repoRoot);

  const gitDiff = diffNameStatus(repoRoot, baseRevision, targetRevision);
  const toProjRel = (gitRelPath: string) => toProjectRelative(repoRoot, realProjectRoot, gitRelPath);

  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const f of gitDiff.added) {
    const rel = toProjRel(f);
    if (rel) changed.add(rel);
  }
  for (const f of gitDiff.modified) {
    const rel = toProjRel(f);
    if (rel) changed.add(rel);
  }
  for (const f of gitDiff.deleted) {
    const rel = toProjRel(f);
    if (rel) deleted.add(rel);
  }
  for (const r of gitDiff.renamed) {
    const from = toProjRel(r.from);
    const to = toProjRel(r.to);
    if (from) deleted.add(from);
    if (to) changed.add(to);
  }

  const previouslyFailed = lastRun.failures.map((f) => f.filePath);
  const reverseImporters = findReverseImporters(db, projectId, [...changed]);

  const reanalysisSet = new Set<string>([...changed, ...reverseImporters, ...previouslyFailed]);
  // 삭제된 파일이 동시에 재분석 대상으로도 잡힐 이유는 없다 (rename의 from은 애초에 changed에 없음).
  for (const d of deleted) reanalysisSet.delete(d);

  const run = createRun(db, projectId, 'incremental', targetRevision, baseRevision);

  try {
    const result = analyzeProject({
      tsconfigPath,
      projectId,
      revision: targetRevision,
      onlyFiles: [...reanalysisSet],
    });

    const failedThisRun = new Set(result.failures.map((f) => f.filePath));
    const successFiles = [...reanalysisSet].filter((f) => !failedThisRun.has(f));

    runInTransaction(db, () => {
      deleteEntitiesByFilePaths(db, projectId, [...successFiles, ...deleted]);
      const nonExternal = result.entities.filter((e) => e.kind !== 'external_module');
      const external = result.entities.filter((e) => e.kind === 'external_module');
      insertEntities(db, nonExternal);
      upsertExternalModuleEntities(db, external);
      insertRelationshipsWithEvidence(db, result.relationships);
    });

    const failures = result.failures.map((f) => {
      const existing = db
        .prepare('SELECT revision FROM entity WHERE id = ?')
        .get(fileEntityId(projectId, f.filePath)) as { revision: string | null } | undefined;
      return { ...f, preservedRevision: existing?.revision ?? null };
    });

    const totals = db
      .prepare('SELECT COUNT(*) AS c FROM entity WHERE project_id = ?')
      .get(projectId) as { c: number };
    const relTotals = db
      .prepare(
        `SELECT COUNT(*) AS c FROM relationship r
         JOIN entity s ON s.id = r.source_id WHERE s.project_id = ?`,
      )
      .get(projectId) as { c: number };

    completeRun(db, run.id, totals.c, relTotals.c, failures);

    return {
      ...run,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      entityCount: totals.c,
      relationshipCount: relTotals.c,
      failures,
    };
  } catch (err) {
    failRun(db, run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
