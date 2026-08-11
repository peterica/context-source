import type { Db } from './db.js';
import { SCHEMA_SQL } from './schema.js';

/**
 * PRAGMA user_version 기반 경량 마이그레이션 (ADR-0004). 별도 버전 테이블 없이
 * SQLite 내장 정수 pragma를 스키마 버전으로 쓴다. 새 DB는 SCHEMA_SQL이 이미
 * 최신 컬럼을 포함해 생성하므로 컬럼 존재 여부를 확인 후 필요한 ALTER만 적용한다
 * (기존 DB를 열 때만 실제로 ALTER가 실행됨).
 */
export const CURRENT_SCHEMA_VERSION = 2;

function columnExists(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  return rows.some((r) => r.name === column);
}

function migrateToV2(db: Db): void {
  if (!columnExists(db, 'project', 'tsconfig_path')) {
    db.exec(`ALTER TABLE project ADD COLUMN tsconfig_path TEXT NOT NULL DEFAULT 'tsconfig.json'`);
  }
  if (!columnExists(db, 'project', 'description')) {
    db.exec(`ALTER TABLE project ADD COLUMN description TEXT`);
  }
  if (!columnExists(db, 'project', 'updated_at')) {
    // 이 SQLite 빌드는 행이 있는 테이블에 ADD COLUMN NOT NULL DEFAULT를 붙일 때 상수가 아닌 값을
    // (CURRENT_TIMESTAMP 포함) 거부한다. 상수 기본값으로 컬럼을 추가한 뒤 별도 UPDATE로 채운다.
    db.exec(`ALTER TABLE project ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE project SET updated_at = created_at WHERE updated_at = ''`);
  }
}

export function applyMigrations(db: Db): void {
  db.exec(SCHEMA_SQL);

  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;

  if (version < 2) {
    migrateToV2(db);
    version = 2;
  }

  if (version !== row.user_version) {
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
  }
}
