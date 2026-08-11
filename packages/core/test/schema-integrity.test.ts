import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import {
  insertEntities,
  insertRelationshipsWithEvidence,
  runInTransaction,
} from '../src/storage/ingest.js';
import type { Entity, Relationship } from '../src/types.js';

function freshDb() {
  const db = openDatabase(':memory:');
  upsertProject(db, { id: 'p1', name: 'Demo', rootPath: '/tmp/demo', tsconfigPath: '/tmp/demo/tsconfig.json' });
  return db;
}

function fileEntity(id: string, filePath: string): Entity {
  return {
    id,
    projectId: 'p1',
    kind: 'file',
    name: filePath,
    filePath,
    range: { startLine: 1, endLine: 10 },
    revision: 'rev1',
  };
}

describe('PRAGMA foreign_keys is verified on every connection', () => {
  it('openDatabase enables and confirms foreign_keys', () => {
    const db = openDatabase(':memory:');
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});

describe('Evidence 없는 Relationship은 저장할 수 없다 (PRD 4.2, 성공 지표)', () => {
  it('application layer rejects relationships with an empty evidence array', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts'), fileEntity('p1/file:b.ts', 'b.ts')]);
    const badRel: Relationship = {
      id: 'r1',
      type: 'IMPORTS',
      sourceId: 'p1/file:a.ts',
      targetId: 'p1/file:b.ts',
      resolution: 'static',
      confidence: 1.0,
      evidence: [],
    };
    expect(() => insertRelationshipsWithEvidence(db, [badRel])).toThrow();
  });

  it('schema itself rejects a relationship whose primary evidence never gets inserted (deferred FK)', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts'), fileEntity('p1/file:b.ts', 'b.ts')]);
    expect(() =>
      runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
           VALUES ('r1', 'IMPORTS', 'p1/file:a.ts', 'p1/file:b.ts', 'static', 1.0, 'nonexistent-evidence')`,
        ).run();
      }),
    ).toThrow(/FOREIGN KEY/);
    // 트랜잭션이 롤백되어 relationship이 실제로 남아있지 않아야 한다
    const count = db.prepare('SELECT COUNT(*) AS c FROM relationship').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('primary evidence must belong to the same relationship it is attached to (composite FK)', () => {
    const db = freshDb();
    insertEntities(db, [
      fileEntity('p1/file:a.ts', 'a.ts'),
      fileEntity('p1/file:b.ts', 'b.ts'),
      fileEntity('p1/file:c.ts', 'c.ts'),
    ]);
    expect(() =>
      runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
           VALUES ('r1', 'IMPORTS', 'p1/file:a.ts', 'p1/file:b.ts', 'static', 1.0, 'ev-of-other-rel')`,
        ).run();
        db.prepare(
          `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
           VALUES ('r2', 'IMPORTS', 'p1/file:a.ts', 'p1/file:c.ts', 'static', 1.0, 'ev-of-other-rel')`,
        ).run();
        // ev-of-other-rel belongs to r2, not r1 — r1's primary_evidence_id FK must fail at commit.
        db.prepare(
          `INSERT INTO evidence (id, relationship_id, file_path, start_line, start_col, end_line, end_col, snippet, analyzer, revision)
           VALUES ('ev-of-other-rel', 'r2', 'a.ts', 1, 1, 1, 5, 'x', 'ts-analyzer@0.1.0', 'rev1')`,
        ).run();
      }),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('CHECK constraints', () => {
  it('static resolution must have confidence = 1.0', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts'), fileEntity('p1/file:b.ts', 'b.ts')]);
    expect(() =>
      runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
           VALUES ('r1', 'IMPORTS', 'p1/file:a.ts', 'p1/file:b.ts', 'static', 0.8, 'ev1')`,
        ).run();
      }),
    ).toThrow();
  });

  it('external_module rows must have NULL file_path/range/revision', () => {
    const db = freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO entity (id, project_id, kind, name, file_path, start_line, end_line, revision)
           VALUES ('p1/ext:lodash', 'p1', 'external_module', 'lodash', 'somewhere.ts', NULL, NULL, NULL)`,
        )
        .run(),
    ).toThrow();
  });

  it('non-external entities must have non-NULL location and revision', () => {
    const db = freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO entity (id, project_id, kind, name, file_path, start_line, end_line, revision)
           VALUES ('p1/file:a.ts', 'p1', 'file', 'a.ts', 'a.ts', NULL, NULL, NULL)`,
        )
        .run(),
    ).toThrow();
  });

  it('confidence must be within (0.0, 1.0]', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts'), fileEntity('p1/file:b.ts', 'b.ts')]);
    expect(() =>
      runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
           VALUES ('r1', 'CALLS', 'p1/file:a.ts', 'p1/file:b.ts', 'inferred', 0.0, 'ev1')`,
        ).run();
      }),
    ).toThrow();
  });
});

describe('UNIQUE (type, source_id, target_id)', () => {
  it('rejects a second relationship row for the same (type, source, target) triple', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts'), fileEntity('p1/file:b.ts', 'b.ts')]);
    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
         VALUES ('r1', 'IMPORTS', 'p1/file:a.ts', 'p1/file:b.ts', 'static', 1.0, 'ev1')`,
      ).run();
      db.prepare(
        `INSERT INTO evidence (id, relationship_id, file_path, start_line, start_col, end_line, end_col, snippet, analyzer, revision)
         VALUES ('ev1', 'r1', 'a.ts', 1, 1, 1, 5, 'x', 'ts-analyzer@0.1.0', 'rev1')`,
      ).run();
    });
    expect(() =>
      db
        .prepare(
          `INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
           VALUES ('r2', 'IMPORTS', 'p1/file:a.ts', 'p1/file:b.ts', 'static', 1.0, 'ev2')`,
        )
        .run(),
    ).toThrow();
  });
});

describe('Cascade delete', () => {
  it('deleting an entity cascades to relationships (both as source and target) and their evidence', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts'), fileEntity('p1/file:b.ts', 'b.ts')]);
    runInTransaction(db, () =>
      insertRelationshipsWithEvidence(db, [
      {
        id: 'r1',
        type: 'IMPORTS',
        sourceId: 'p1/file:a.ts',
        targetId: 'p1/file:b.ts',
        resolution: 'static',
        confidence: 1.0,
        evidence: [
          {
            id: 'ev1',
            filePath: 'a.ts',
            range: { startLine: 1, startCol: 1, endLine: 1, endCol: 5 },
            snippet: 'x',
            analyzer: 'ts-analyzer@0.1.0',
            revision: 'rev1',
          },
        ],
      },
      ]),
    );
    db.prepare("DELETE FROM entity WHERE id = 'p1/file:b.ts'").run();
    expect((db.prepare('SELECT COUNT(*) AS c FROM relationship').get() as { c: number }).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS c FROM evidence').get() as { c: number }).c).toBe(0);
  });

  it('deleting a project cascades to entities', () => {
    const db = freshDb();
    insertEntities(db, [fileEntity('p1/file:a.ts', 'a.ts')]);
    db.prepare("DELETE FROM project WHERE id = 'p1'").run();
    expect((db.prepare('SELECT COUNT(*) AS c FROM entity').get() as { c: number }).c).toBe(0);
  });
});
