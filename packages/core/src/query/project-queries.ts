import type { Db } from '../storage/db.js';
import type { AnalysisRun, Project } from '../types.js';
import { getProject, listProjects } from '../storage/project-repo.js';
import { getLastCompletedRun } from '../storage/run-repo.js';

export interface ProjectSummary {
  project: Project;
  entityCount: number;
  relationshipCount: number;
  lastRun: AnalysisRun | null;
}

/**
 * Web UI 프로젝트 목록 화면(ADR-0004)을 위한 조회 — 프로젝트마다 규모(Entity/Relationship 개수)와
 * 마지막 완료 run(최신 분석 revision 포함)을 함께 반환한다. 전체 그래프는 내려주지 않는다(Query-first).
 */
export function listProjectsWithStats(db: Db): ProjectSummary[] {
  const projects = listProjects(db);
  if (projects.length === 0) return [];

  const entityRows = db
    .prepare('SELECT project_id, COUNT(*) AS c FROM entity GROUP BY project_id')
    .all() as unknown as { project_id: string; c: number }[];
  const entityCountByProject = new Map(entityRows.map((r) => [r.project_id, r.c]));

  const relRows = db
    .prepare(
      `SELECT s.project_id AS project_id, COUNT(*) AS c
       FROM relationship r JOIN entity s ON s.id = r.source_id
       GROUP BY s.project_id`,
    )
    .all() as unknown as { project_id: string; c: number }[];
  const relCountByProject = new Map(relRows.map((r) => [r.project_id, r.c]));

  return projects.map((project) => ({
    project,
    entityCount: entityCountByProject.get(project.id) ?? 0,
    relationshipCount: relCountByProject.get(project.id) ?? 0,
    lastRun: getLastCompletedRun(db, project.id) ?? null,
  }));
}

export function getProjectSummary(db: Db, id: string): ProjectSummary | undefined {
  const project = getProject(db, id);
  if (!project) return undefined;

  const entityCount = (
    db.prepare('SELECT COUNT(*) AS c FROM entity WHERE project_id = ?').get(id) as { c: number }
  ).c;
  const relationshipCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM relationship r
         JOIN entity s ON s.id = r.source_id WHERE s.project_id = ?`,
      )
      .get(id) as { c: number }
  ).c;

  return { project, entityCount, relationshipCount, lastRun: getLastCompletedRun(db, id) ?? null };
}
