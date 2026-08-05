import type { Db } from './db.js';
import type { AnalysisFailure, AnalysisRun, AnalysisRunMode } from '../types.js';
import { analysisRunId } from '../id.js';

interface AnalysisRunRow {
  id: string;
  project_id: string;
  mode: string;
  revision: string;
  base_revision: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  entity_count: number | null;
  relationship_count: number | null;
}

function loadFailures(db: Db, runId: string): AnalysisFailure[] {
  const rows = db
    .prepare(
      'SELECT file_path, message, preserved_revision FROM analysis_failure WHERE run_id = ? ORDER BY file_path',
    )
    .all(runId) as { file_path: string; message: string; preserved_revision: string | null }[];
  return rows.map((r) => ({
    filePath: r.file_path,
    message: r.message,
    preservedRevision: r.preserved_revision,
  }));
}

function rowToRun(db: Db, row: AnalysisRunRow): AnalysisRun {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode as AnalysisRunMode,
    revision: row.revision,
    baseRevision: row.base_revision,
    status: row.status as AnalysisRun['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    entityCount: row.entity_count,
    relationshipCount: row.relationship_count,
    failures: loadFailures(db, row.id),
  };
}

export function createRun(
  db: Db,
  projectId: string,
  mode: AnalysisRunMode,
  revision: string,
  baseRevision: string | null,
): AnalysisRun {
  const id = analysisRunId();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO analysis_run (id, project_id, mode, revision, base_revision, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
  ).run(id, projectId, mode, revision, baseRevision, startedAt);
  return {
    id,
    projectId,
    mode,
    revision,
    baseRevision,
    status: 'running',
    startedAt,
    finishedAt: null,
    entityCount: null,
    relationshipCount: null,
    failures: [],
  };
}

export function completeRun(
  db: Db,
  runId: string,
  entityCount: number,
  relationshipCount: number,
  failures: AnalysisFailure[],
): void {
  const finishedAt = new Date().toISOString();
  db.prepare(
    `UPDATE analysis_run
     SET status = 'completed', finished_at = ?, entity_count = ?, relationship_count = ?
     WHERE id = ?`,
  ).run(finishedAt, entityCount, relationshipCount, runId);

  const stmt = db.prepare(
    'INSERT INTO analysis_failure (run_id, file_path, message, preserved_revision) VALUES (?, ?, ?, ?)',
  );
  for (const f of failures) {
    stmt.run(runId, f.filePath, f.message, f.preservedRevision ?? null);
  }
}

export function failRun(db: Db, runId: string, message: string): void {
  const finishedAt = new Date().toISOString();
  db.prepare(
    `UPDATE analysis_run SET status = 'failed', finished_at = ? WHERE id = ?`,
  ).run(finishedAt, runId);
  db.prepare(
    'INSERT INTO analysis_failure (run_id, file_path, message, preserved_revision) VALUES (?, ?, ?, NULL)',
  ).run(runId, '<project>', message);
}

export function getRun(db: Db, id: string): AnalysisRun | undefined {
  const row = db.prepare('SELECT * FROM analysis_run WHERE id = ?').get(id) as unknown as
    | AnalysisRunRow
    | undefined;
  return row ? rowToRun(db, row) : undefined;
}

export function listRuns(db: Db, projectId: string, limit: number): AnalysisRun[] {
  const rows = db
    .prepare(
      'SELECT * FROM analysis_run WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
    )
    .all(projectId, limit) as unknown as AnalysisRunRow[];
  return rows.map((r) => rowToRun(db, r));
}

export function getLastCompletedRun(db: Db, projectId: string): AnalysisRun | undefined {
  const row = db
    .prepare(
      `SELECT * FROM analysis_run WHERE project_id = ? AND status = 'completed'
       ORDER BY finished_at DESC LIMIT 1`,
    )
    .get(projectId) as unknown as AnalysisRunRow | undefined;
  return row ? rowToRun(db, row) : undefined;
}

export function isAnyRunInProgress(db: Db, projectId: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM analysis_run WHERE project_id = ? AND status = 'running'`)
    .get(projectId) as { c: number };
  return row.c > 0;
}
