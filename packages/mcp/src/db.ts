import type { Db } from '@contextsource/core';

// core의 openDatabase는 스키마를 적용하는 쓰기 연결을 연다. MCP는 읽기 전용 인터페이스이므로
// (API.md 3장 "모든 tool은 읽기 전용") node:sqlite를 readOnly 모드로 직접 연다.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export function openReadOnlyDatabase(filePath: string): Db {
  const db = new DatabaseSync(filePath, { readOnly: true, open: true }) as unknown as Db;
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}
