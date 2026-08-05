export * from './types.js';
export * from './id.js';
export { analyzeProject, type AnalyzeProjectOptions } from './analyzer/project-analyzer.js';
export { loadProgram, toProjectRelativePath } from './analyzer/program.js';

export { openDatabase, type Db } from './storage/db.js';
export { upsertProject, getProject } from './storage/project-repo.js';
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

export { runFullAnalysis, type RunFullAnalysisOptions } from './orchestrator.js';
