import type { Db } from '../storage/db.js';
import type { AnalysisRun, Project, TechStackEntry } from '../types.js';
import { getProject, listProjects } from '../storage/project-repo.js';
import { getLastCompletedRun } from '../storage/run-repo.js';
import { listTechStack } from '../storage/tech-stack-repo.js';

export interface ProjectSummary {
  project: Project;
  entityCount: number;
  relationshipCount: number;
  lastRun: AnalysisRun | null;
  techStack: TechStackEntry[];
}

/** project_tech_stack 전체를 한 번에 읽어 project_id별로 묶는다 (N+1 방지, ADR-0005/0006). */
function loadTechStackByProject(db: Db): Map<string, TechStackEntry[]> {
  const rows = db
    .prepare('SELECT project_id, category, value FROM project_tech_stack ORDER BY category, value')
    .all() as unknown as { project_id: string; category: TechStackEntry['category']; value: string }[];
  const byProject = new Map<string, TechStackEntry[]>();
  for (const row of rows) {
    const list = byProject.get(row.project_id) ?? [];
    list.push({ category: row.category, value: row.value });
    byProject.set(row.project_id, list);
  }
  return byProject;
}

/**
 * Web UI 프로젝트 목록 화면(ADR-0004)을 위한 조회 — 프로젝트마다 규모(Entity/Relationship 개수)와
 * 마지막 완료 run(최신 분석 revision 포함), 기술 스택(ADR-0005)을 함께 반환한다.
 * 프로젝트별로 별도 요청하지 않도록 각 항목을 하나의 배치 쿼리로 모아 N+1을 피한다.
 * 전체 그래프는 내려주지 않는다(Query-first).
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

  const techStackByProject = loadTechStackByProject(db);

  return projects.map((project) => ({
    project,
    entityCount: entityCountByProject.get(project.id) ?? 0,
    relationshipCount: relCountByProject.get(project.id) ?? 0,
    lastRun: getLastCompletedRun(db, project.id) ?? null,
    techStack: techStackByProject.get(project.id) ?? [],
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

  return {
    project,
    entityCount,
    relationshipCount,
    lastRun: getLastCompletedRun(db, id) ?? null,
    techStack: listTechStack(db, id),
  };
}

export interface SimilarProject {
  project: Project;
  sharedTechStack: TechStackEntry[];
  score: number;
}

/**
 * 기술 스택 태그 교집합 기반 유사 프로젝트 탐색 (ADR-0006). Vector Search나 Project 간
 * 영속적인 관계(그래프 엣지)를 쓰지 않는다 — 조회 시점에 계산되는 파생 순위일 뿐이다.
 * project_tech_stack을 프로젝트마다 반복 조회하지 않고 한 번에 읽어 N+1을 피한다.
 */
export function findSimilarProjects(db: Db, projectId: string, limit: number): SimilarProject[] {
  const target = getProject(db, projectId);
  if (!target) return [];

  const techStackByProject = loadTechStackByProject(db);
  const targetTags = new Set((techStackByProject.get(projectId) ?? []).map((e) => `${e.category}:${e.value}`));
  if (targetTags.size === 0) return [];

  const results: SimilarProject[] = [];
  for (const project of listProjects(db)) {
    if (project.id === projectId) continue;
    const candidateTags = techStackByProject.get(project.id) ?? [];
    const sharedTechStack = candidateTags.filter((e) => targetTags.has(`${e.category}:${e.value}`));
    if (sharedTechStack.length === 0) continue;
    results.push({ project, sharedTechStack, score: sharedTechStack.length });
  }

  results.sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
  return results.slice(0, limit);
}
