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

// ADR-0011: 사각지대 측정. Relationship이 아니다 — target Entity가 없는(대상을 확정 못한)
// 진단 기록이며 그래프 순회에 참여하지 않는다.
export type UnresolvedReferenceKind = 'CALLS' | 'IMPORTS' | 'IMPLEMENTS' | 'EXTENDS';

export type UnresolvedReferenceReason =
  | 'entity-not-extracted'
  | 'ambiguous-callable-type'
  | 'internal-path-not-in-project'
  | 'unresolvable-specifier';

export interface UnresolvedReference {
  id: string;
  projectId: string;
  sourceId: string;
  kind: UnresolvedReferenceKind;
  reason: UnresolvedReferenceReason;
  filePath: string;
  range: EvidenceRange;
  snippet: string;
  analyzer: string;
  revision: string;
}

export interface AnalysisResult {
  entities: Entity[];
  relationships: Relationship[];
  unresolvedReferences: UnresolvedReference[];
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
  /** 절대 경로. workspace-root 기준 상대 경로는 등록 시점에만 쓰이고 저장되지 않는다 (ADR-0004). */
  rootPath: string;
  /** 절대 경로. */
  tsconfigPath: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  rootPath: string;
  tsconfigPath: string;
  description?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  tsconfigPath?: string;
  description?: string | null;
}

export const ANALYZER_ID = 'ts-analyzer@0.1.0';

// ADR-0005: 기술 스택 관리
export type TechStackCategory = 'language' | 'runtime' | 'framework' | 'orm' | 'database' | 'build_tool';

export interface TechStackEntry {
  category: TechStackCategory;
  value: string;
}
