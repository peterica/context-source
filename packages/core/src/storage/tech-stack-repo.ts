import type { Db } from './db.js';
import type { TechStackEntry } from '../types.js';

export function listTechStack(db: Db, projectId: string): TechStackEntry[] {
  const rows = db
    .prepare(
      'SELECT category, value FROM project_tech_stack WHERE project_id = ? ORDER BY category, value',
    )
    .all(projectId) as unknown as TechStackEntry[];
  return rows;
}

/** 이미 있으면 조용히 무시한다 (기본 키가 (project_id, category, value)). */
export function addTechStackEntry(db: Db, projectId: string, entry: TechStackEntry): void {
  db.prepare(
    'INSERT OR IGNORE INTO project_tech_stack (project_id, category, value) VALUES (?, ?, ?)',
  ).run(projectId, entry.category, entry.value);
}

export function removeTechStackEntry(db: Db, projectId: string, entry: TechStackEntry): boolean {
  const result = db
    .prepare(
      'DELETE FROM project_tech_stack WHERE project_id = ? AND category = ? AND value = ?',
    )
    .run(projectId, entry.category, entry.value);
  return result.changes > 0;
}

/** 자동 감지 결과를 병합한다 — 기존 항목(수동 추가분 포함)은 지우지 않는다 (ADR-0005 §2). */
export function mergeTechStack(db: Db, projectId: string, entries: TechStackEntry[]): void {
  for (const entry of entries) addTechStackEntry(db, projectId, entry);
}
