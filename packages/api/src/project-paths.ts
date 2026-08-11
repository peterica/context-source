import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApiError } from './errors.js';

/**
 * ADR-0004 §1 — workspace-root 기준 상대 경로를 절대 경로로 해석하고, workspace 밖으로
 * 벗어나지 않는지(경로 탈출 방지) 검증한다. 등록 시점에만 쓰이며, project 테이블에는
 * 항상 절대 경로로 저장한다.
 */
export function resolveWithinWorkspace(workspaceRoot: string, relativeOrAbsolute: string): string {
  const resolved = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(workspaceRoot, relativeOrAbsolute);
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ApiError(
      'INVALID_PARAM',
      `경로가 workspace root를 벗어납니다: '${relativeOrAbsolute}' (workspace root 안의 상대 경로를 입력하세요)`,
    );
  }
  return resolved;
}

/**
 * 사용자에게 보여줄 에러 메시지에는 서버의 절대 경로(absolutePath)가 아니라 사용자가 실제로 입력한
 * 값(displayPath)만 노출한다 — 서버 파일시스템 구조를 노출하지 않기 위함 (UX 감사 P0-1, 2026-08-11).
 */
export function requireDirectory(absolutePath: string, displayPath: string, label: string): void {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new ApiError(
      'INVALID_PARAM',
      `${label}를 디렉터리로 찾을 수 없습니다: '${displayPath}' (workspace root 아래에 있는지, 철자가 정확한지 확인하세요)`,
    );
  }
}

export function requireFile(absolutePath: string, displayPath: string, label: string): void {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new ApiError(
      'INVALID_PARAM',
      `${label}를 파일로 찾을 수 없습니다: '${displayPath}' (경로와 철자가 정확한지 확인하세요)`,
    );
  }
}
