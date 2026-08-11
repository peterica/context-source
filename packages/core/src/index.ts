export * from './types.js';
export * from './id.js';
export { analyzeProject, type AnalyzeProjectOptions } from './analyzer/project-analyzer.js';
export { loadProgram, toProjectRelativePath } from './analyzer/program.js';

export { openDatabase, type Db } from './storage/db.js';
export {
  upsertProject,
  createProject,
  updateProject,
  deleteProject,
  getProject,
  listProjects,
  projectExists,
  generateProjectId,
} from './storage/project-repo.js';
export {
  replaceProjectGraph,
  deleteEntitiesByFilePaths,
  insertEntities,
  upsertExternalModuleEntities,
  insertRelationshipsWithEvidence,
  runInTransaction,
} from './storage/ingest.js';
export {
  createRun,
  completeRun,
  failRun,
  getRun,
  listRuns,
  getLastCompletedRun,
  isAnyRunInProgress,
} from './storage/run-repo.js';

export {
  searchEntities,
  getEntity,
  getRelationshipCounts,
  getEntitiesByIds,
  type SearchEntitiesParams,
  type SearchEntitiesResult,
  type RelationshipCounts,
} from './query/entity-queries.js';
export {
  listConnectedRelationships,
  listCallers,
  listCallees,
  type Direction,
  type ConnectedRelationshipsParams,
  type ConnectedRelationshipItem,
  type ConnectedRelationshipsResult,
} from './query/relationship-queries.js';
export {
  getSubgraph,
  type SubgraphParams,
  type SubgraphResult,
  type SubgraphDirection,
} from './query/subgraph.js';
export {
  getProjectStats,
  listInferredRelationships,
  type ProjectStats,
  type InferredRelationshipItem,
  type ListInferredRelationshipsResult,
} from './query/stats.js';
export {
  listProjectsWithStats,
  getProjectSummary,
  findSimilarProjects,
  type ProjectSummary,
  type SimilarProject,
} from './query/project-queries.js';

export {
  listTechStack,
  addTechStackEntry,
  removeTechStackEntry,
  mergeTechStack,
} from './storage/tech-stack-repo.js';
export { detectTechStack } from './tech-stack-detect.js';

export { runFullAnalysis, type RunFullAnalysisOptions } from './orchestrator.js';

export {
  runIncrementalAnalysis,
  type RunIncrementalAnalysisOptions,
} from './incremental/incremental-runner.js';
export {
  resolveGitRoot,
  currentRevision as gitCurrentRevision,
  isGitRepo,
  diffNameStatus,
  toProjectRelative,
  type GitDiff,
} from './incremental/git.js';
export { findReverseImporters } from './incremental/reverse-imports.js';
