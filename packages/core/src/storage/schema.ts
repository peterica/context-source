// DATA-MODEL.md §2 DDL 기반 + ADR-0004(Project Entity)의 확장 컬럼.
// 기존 DB에 대한 컬럼 추가는 CREATE TABLE IF NOT EXISTS로 처리되지 않으므로 migrations.ts가 담당한다.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,
  tsconfig_path TEXT NOT NULL DEFAULT 'tsconfig.json',
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entity (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN
               ('file','class','interface','function','method','external_module')),
  name       TEXT NOT NULL,
  file_path  TEXT,
  start_line INTEGER,
  end_line   INTEGER,
  revision   TEXT,

  CHECK ((kind = 'external_module') = (file_path IS NULL)),
  CHECK (
    (kind = 'external_module' AND start_line IS NULL AND end_line IS NULL AND revision IS NULL)
    OR
    (kind <> 'external_module' AND start_line IS NOT NULL AND end_line IS NOT NULL
      AND revision IS NOT NULL AND start_line > 0 AND end_line >= start_line)
  )
);

CREATE INDEX IF NOT EXISTS idx_entity_name ON entity(name);
CREATE INDEX IF NOT EXISTS idx_entity_kind ON entity(kind);
CREATE INDEX IF NOT EXISTS idx_entity_file ON entity(file_path);

CREATE TABLE IF NOT EXISTS relationship (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN
               ('DECLARES','IMPORTS','CALLS','IMPLEMENTS','EXTENDS')),
  source_id  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  resolution TEXT NOT NULL CHECK (resolution IN ('static','inferred')),
  confidence REAL NOT NULL CHECK (confidence > 0.0 AND confidence <= 1.0),

  primary_evidence_id TEXT NOT NULL,

  UNIQUE (type, source_id, target_id),

  CHECK (resolution <> 'static' OR confidence = 1.0),

  FOREIGN KEY (primary_evidence_id, id)
    REFERENCES evidence(id, relationship_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationship(source_id, type);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationship(target_id, type);

CREATE TABLE IF NOT EXISTS evidence (
  id              TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES relationship(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  start_line      INTEGER NOT NULL,
  start_col       INTEGER NOT NULL,
  end_line        INTEGER NOT NULL,
  end_col         INTEGER NOT NULL,
  snippet         TEXT NOT NULL,
  analyzer        TEXT NOT NULL,
  revision        TEXT NOT NULL,

  UNIQUE (id, relationship_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_rel ON evidence(relationship_id);

CREATE TABLE IF NOT EXISTS analysis_run (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('full','incremental')),
  revision      TEXT NOT NULL,
  base_revision TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  entity_count       INTEGER,
  relationship_count INTEGER,

  CHECK ((mode = 'incremental') = (base_revision IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS analysis_failure (
  run_id             TEXT NOT NULL REFERENCES analysis_run(id) ON DELETE CASCADE,
  file_path          TEXT NOT NULL,
  message            TEXT NOT NULL,
  preserved_revision TEXT,

  PRIMARY KEY (run_id, file_path)
);

-- ADR-0005: 기술 스택 관리. 새 테이블이라 컬럼 추가와 달리 마이그레이션이 필요 없다
-- (CREATE TABLE IF NOT EXISTS만으로 기존 DB에도 안전하게 적용됨).
CREATE TABLE IF NOT EXISTS project_tech_stack (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN
               ('language','runtime','framework','orm','database','build_tool')),
  value      TEXT NOT NULL,

  PRIMARY KEY (project_id, category, value)
);
`;
