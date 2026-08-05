import type { Db } from './db.js';
import type { Project } from '../types.js';

export function upsertProject(db: Db, project: Project): void {
  db.prepare(
    `INSERT INTO project (id, name, root_path) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, root_path = excluded.root_path`,
  ).run(project.id, project.name, project.rootPath);
}

export function getProject(db: Db, id: string): Project | undefined {
  const row = db.prepare('SELECT id, name, root_path FROM project WHERE id = ?').get(id) as
    | { id: string; name: string; root_path: string }
    | undefined;
  if (!row) return undefined;
  return { id: row.id, name: row.name, rootPath: row.root_path };
}
