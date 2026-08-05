import { createHash } from 'node:crypto';

/**
 * Entity id 규칙 — DATA-MODEL.md §1.
 * filePath는 항상 프로젝트 루트 기준 상대 경로, '/' 구분자로 정규화되어 있어야 한다.
 */
export function normalizeFilePath(filePath: string): string {
  return filePath.split('\\').join('/').replace(/^\.\//, '');
}

export function fileEntityId(projectId: string, filePath: string): string {
  return `${projectId}/file:${normalizeFilePath(filePath)}`;
}

export function symbolEntityId(projectId: string, filePath: string, symbolPath: string): string {
  return `${projectId}/sym:${normalizeFilePath(filePath)}#${symbolPath}`;
}

export function externalModuleEntityId(projectId: string, packageName: string): string {
  return `${projectId}/ext:${packageName}`;
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/**
 * Relationship id: 같은 (type, source, target) 쌍은 항상 같은 id로 수렴해야
 * 증분 재분석 시 관계가 안정적으로 대체된다 (DATA-MODEL.md 3.2).
 */
export function relationshipId(type: string, sourceId: string, targetId: string): string {
  return `r-${shortHash(`${type}|${sourceId}|${targetId}`)}`;
}

/**
 * Evidence id: 관계 + 코드 위치로 결정되어 같은 근거가 재분석 시 같은 id를 갖는다.
 */
export function evidenceId(
  relId: string,
  filePath: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): string {
  return `e-${shortHash(`${relId}|${normalizeFilePath(filePath)}|${startLine}|${startCol}|${endLine}|${endCol}`)}`;
}

export function analysisRunId(prefix = 'run'): string {
  return `${prefix}-${shortHash(`${Date.now()}|${Math.random()}`)}`;
}
