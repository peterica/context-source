import type { Db } from './db.js';
import type { CreateProjectInput, Project, UpdateProjectInput } from '../types.js';

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  tsconfig_path: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    tsconfigPath: row.tsconfig_path,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS =
  'id, name, root_path, tsconfig_path, description, created_at, updated_at';

/** 존재하면 갱신, 없으면 생성한다 (CLI의 --db 직접 저장 경로 등 idempotent 등록용). */
export function upsertProject(db: Db, project: CreateProjectInput): void {
  db.prepare(
    `INSERT INTO project (id, name, root_path, tsconfig_path, description, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       root_path = excluded.root_path,
       tsconfig_path = excluded.tsconfig_path,
       description = excluded.description,
       updated_at = datetime('now')`,
  ).run(project.id, project.name, project.rootPath, project.tsconfigPath, project.description ?? null);
}

/** id가 이미 존재하면 예외를 던진다 (POST /projects 등록 endpoint용 — 명시적 충돌 처리). */
export function createProject(db: Db, project: CreateProjectInput): Project {
  db.prepare(
    `INSERT INTO project (id, name, root_path, tsconfig_path, description)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(project.id, project.name, project.rootPath, project.tsconfigPath, project.description ?? null);
  const created = getProject(db, project.id);
  if (!created) throw new Error(`Failed to create project ${project.id}`);
  return created;
}

export function updateProject(db: Db, id: string, patch: UpdateProjectInput): Project | undefined {
  const existing = getProject(db, id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE project SET name = ?, tsconfig_path = ?, description = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    patch.name ?? existing.name,
    patch.tsconfigPath ?? existing.tsconfigPath,
    patch.description !== undefined ? patch.description : existing.description,
    id,
  );
  return getProject(db, id);
}

/** entity/relationship/evidence는 ON DELETE CASCADE로 함께 삭제된다. */
export function deleteProject(db: Db, id: string): boolean {
  const result = db.prepare('DELETE FROM project WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getProject(db: Db, id: string): Project | undefined {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM project WHERE id = ?`).get(id) as
    | unknown as ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function listProjects(db: Db): Project[] {
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM project ORDER BY name`)
    .all() as unknown as ProjectRow[];
  return rows.map(rowToProject);
}

export function projectExists(db: Db, id: string): boolean {
  const row = db.prepare('SELECT 1 FROM project WHERE id = ?').get(id);
  return row !== undefined;
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** 이름에서 kebab-case id를 만들고, 충돌하면 -2, -3 ...을 붙여 유일하게 만든다. */
export function generateProjectId(db: Db, name: string): string {
  const base = slugify(name);
  if (!projectExists(db, base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!projectExists(db, candidate)) return candidate;
  }
}
