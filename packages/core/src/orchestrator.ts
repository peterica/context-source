import type { Db } from './storage/db.js';
import { analyzeProject } from './analyzer/project-analyzer.js';
import { replaceProjectGraph } from './storage/ingest.js';
import { completeRun, createRun, failRun, isAnyRunInProgress } from './storage/run-repo.js';
import type { AnalysisRun } from './types.js';

export interface RunFullAnalysisOptions {
  db: Db;
  projectId: string;
  tsconfigPath: string;
  revision: string;
}

/**
 * Full scan을 실행하고 결과를 원자적으로 저장한다 (FR-A7).
 * 실행 중인 run이 있으면 거부한다 (API.md 2.6, 409 ANALYSIS_IN_PROGRESS와 대응).
 */
export function runFullAnalysis(options: RunFullAnalysisOptions): AnalysisRun {
  if (isAnyRunInProgress(options.db, options.projectId)) {
    throw Object.assign(new Error('ANALYSIS_IN_PROGRESS'), { code: 'ANALYSIS_IN_PROGRESS' });
  }

  const run = createRun(options.db, options.projectId, 'full', options.revision, null);
  try {
    const result = analyzeProject({
      tsconfigPath: options.tsconfigPath,
      projectId: options.projectId,
      revision: options.revision,
    });
    replaceProjectGraph(options.db, options.projectId, result.entities, result.relationships);
    completeRun(
      options.db,
      run.id,
      result.entities.length,
      result.relationships.length,
      result.failures,
    );
    return {
      ...run,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      entityCount: result.entities.length,
      relationshipCount: result.relationships.length,
      failures: result.failures,
    };
  } catch (err) {
    failRun(options.db, run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
