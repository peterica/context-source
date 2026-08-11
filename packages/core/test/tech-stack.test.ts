import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, type Db } from '../src/storage/db.js';
import { createProject } from '../src/storage/project-repo.js';
import {
  addTechStackEntry,
  listTechStack,
  mergeTechStack,
  removeTechStackEntry,
} from '../src/storage/tech-stack-repo.js';
import { detectTechStack } from '../src/tech-stack-detect.js';

function freshDb(): Db {
  return openDatabase(':memory:');
}

describe('project_tech_stack repo (ADR-0005)', () => {
  it('add/list/remove a tech stack entry', () => {
    const db = freshDb();
    createProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });

    addTechStackEntry(db, 'demo', { category: 'language', value: 'TypeScript' });
    addTechStackEntry(db, 'demo', { category: 'framework', value: 'React' });
    expect(listTechStack(db, 'demo')).toEqual([
      { category: 'framework', value: 'React' },
      { category: 'language', value: 'TypeScript' },
    ]);

    expect(removeTechStackEntry(db, 'demo', { category: 'framework', value: 'React' })).toBe(true);
    expect(listTechStack(db, 'demo')).toEqual([{ category: 'language', value: 'TypeScript' }]);
    expect(removeTechStackEntry(db, 'demo', { category: 'framework', value: 'React' })).toBe(false);
  });

  it('adding a duplicate entry is a no-op', () => {
    const db = freshDb();
    createProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    addTechStackEntry(db, 'demo', { category: 'database', value: 'PostgreSQL' });
    addTechStackEntry(db, 'demo', { category: 'database', value: 'PostgreSQL' });
    expect(listTechStack(db, 'demo')).toHaveLength(1);
  });

  it('rejects an invalid category at the schema level', () => {
    const db = freshDb();
    createProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    expect(() =>
      db
        .prepare('INSERT INTO project_tech_stack (project_id, category, value) VALUES (?, ?, ?)')
        .run('demo', 'bogus-category', 'x'),
    ).toThrow();
  });

  it('deleting the project cascades to its tech stack', () => {
    const db = freshDb();
    createProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    addTechStackEntry(db, 'demo', { category: 'language', value: 'TypeScript' });
    db.prepare('DELETE FROM project WHERE id = ?').run('demo');
    expect((db.prepare('SELECT COUNT(*) AS c FROM project_tech_stack').get() as { c: number }).c).toBe(0);
  });

  it('mergeTechStack keeps previously (manually) added entries', () => {
    const db = freshDb();
    createProject(db, { id: 'demo', name: 'Demo', rootPath: '/x', tsconfigPath: '/x/tsconfig.json' });
    addTechStackEntry(db, 'demo', { category: 'framework', value: 'Custom Framework' });
    mergeTechStack(db, 'demo', [{ category: 'language', value: 'TypeScript' }]);
    expect(listTechStack(db, 'demo')).toEqual(
      expect.arrayContaining([
        { category: 'framework', value: 'Custom Framework' },
        { category: 'language', value: 'TypeScript' },
      ]),
    );
  });
});

describe('detectTechStack (ADR-0005 §2)', () => {
  it('always includes language/runtime even without a package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-techstack-'));
    const entries = detectTechStack({
      id: 'demo',
      name: 'Demo',
      rootPath: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      description: null,
      createdAt: '',
      updatedAt: '',
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        { category: 'language', value: 'TypeScript' },
        { category: 'runtime', value: 'Node.js' },
      ]),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps known dependencies to framework/orm/database/build_tool', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-techstack-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { express: '^4.0.0', pg: '^8.0.0', typeorm: '^0.3.0' },
        devDependencies: { vite: '^5.0.0', 'left-pad-unrelated': '^1.0.0' },
      }),
    );
    const entries = detectTechStack({
      id: 'demo',
      name: 'Demo',
      rootPath: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      description: null,
      createdAt: '',
      updatedAt: '',
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        { category: 'framework', value: 'Express' },
        { category: 'database', value: 'PostgreSQL' },
        { category: 'orm', value: 'TypeORM' },
        { category: 'build_tool', value: 'Vite' },
      ]),
    );
    expect(entries.some((e) => e.value === 'left-pad-unrelated')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('looks for package.json near tsconfigPath before falling back to rootPath', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-techstack-'));
    fs.mkdirSync(path.join(dir, 'packages/app'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'packages/app/package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );
    const entries = detectTechStack({
      id: 'demo',
      name: 'Demo',
      rootPath: dir,
      tsconfigPath: path.join(dir, 'packages/app/tsconfig.json'),
      description: null,
      createdAt: '',
      updatedAt: '',
    });
    expect(entries.some((e) => e.value === 'React')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw on malformed package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-techstack-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{not valid json');
    const entries = detectTechStack({
      id: 'demo',
      name: 'Demo',
      rootPath: dir,
      tsconfigPath: path.join(dir, 'tsconfig.json'),
      description: null,
      createdAt: '',
      updatedAt: '',
    });
    expect(entries.some((e) => e.category === 'language')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
