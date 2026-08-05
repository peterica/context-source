// Domain types per PRD.md §4 and DATA-MODEL.md §2.
// Do not add fields or kinds beyond what those documents define.

export type EntityKind =
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'external_module';

export interface EntityRange {
  startLine: number;
  endLine: number;
}

export interface Entity {
  id: string;
  projectId: string;
  kind: EntityKind;
  name: string;
  /** null only for external_module (PRD 4.1) */
  filePath: string | null;
  /** null only for external_module (PRD 4.1) */
  range: EntityRange | null;
  /** null only for external_module (PRD 4.1) */
  revision: string | null;
}

export type RelationshipType = 'DECLARES' | 'IMPORTS' | 'CALLS' | 'IMPLEMENTS' | 'EXTENDS';

export type Resolution = 'static' | 'inferred';

export interface EvidenceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface Evidence {
  id: string;
  filePath: string;
  range: EvidenceRange;
  snippet: string;
  analyzer: string;
  revision: string;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  resolution: Resolution;
  confidence: number;
  /** Evidence 없는 Relationship은 존재할 수 없다 (PRD 4.2). 최소 1건. */
  evidence: Evidence[];
}

export interface AnalysisFailure {
  filePath: string;
  message: string;
  /** M3에서만 채워짐: 실패 파일의 기존 결과가 보존되었는지 여부와 그 revision */
  preservedRevision?: string | null;
}

export interface AnalysisResult {
  entities: Entity[];
  relationships: Relationship[];
  failures: AnalysisFailure[];
  /** 이번 분석에서 실제로 처리를 시도한 프로젝트-상대 파일 경로 목록 (실패 포함) */
  analyzedFilePaths: string[];
}

export type AnalysisRunMode = 'full' | 'incremental';
export type AnalysisRunStatus = 'running' | 'completed' | 'failed';

export interface AnalysisRun {
  id: string;
  projectId: string;
  mode: AnalysisRunMode;
  revision: string;
  baseRevision: string | null;
  status: AnalysisRunStatus;
  startedAt: string;
  finishedAt: string | null;
  entityCount: number | null;
  relationshipCount: number | null;
  failures: AnalysisFailure[];
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
}

export const ANALYZER_ID = 'ts-analyzer@0.1.0';
