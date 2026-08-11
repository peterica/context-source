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
      `path escapes workspace root: ${relativeOrAbsolute}`,
    );
  }
  return resolved;
}

export function requireDirectory(absolutePath: string, label: string): void {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new ApiError('INVALID_PARAM', `${label} does not exist or is not a directory: ${absolutePath}`);
  }
}

export function requireFile(absolutePath: string, label: string): void {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new ApiError('INVALID_PARAM', `${label} does not exist or is not a file: ${absolutePath}`);
  }
}
