import type * as NodeSqlite from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';

// process.getBuiltinModule을 사용한다 — 정적 `import 'node:sqlite'`는 이 신규 코어 모듈을
// 아직 인식하지 못하는 구버전 Vite/vite-node의 빌트인 감지 로직에서 해석 오류를 일으킨다
// (`node:sqlite`는 접두사 없는 'sqlite'로는 builtin으로 등록되지 않는 Node의 의도적 설계 때문).
// getBuiltinModule은 정적 분석 대상이 아닌 런타임 호출이라 이 문제를 우회한다.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof NodeSqlite;

export type Db = NodeSqlite.DatabaseSync;

/**
 * SQLite connection을 열고 스키마를 적용한다.
 * PRAGMA foreign_keys는 connection별 설정이므로 매 connection 생성 시 켜고 활성화 여부를 검증한다
 * (DATA-MODEL.md "마이그레이션에서 한 번 실행하는 것만으로는 충분하지 않다").
 */
export function openDatabase(filePath: string): Db {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number } | undefined;
  if (!row || row.foreign_keys !== 1) {
    throw new Error('Failed to enable PRAGMA foreign_keys on this SQLite connection');
  }
  db.exec(SCHEMA_SQL);
  return db;
}
