import * as ts from 'typescript';
import type { AnalysisFailure, AnalysisResult, Entity, Relationship, RelationshipType } from '../types.js';
import { relationshipId } from '../id.js';
import { loadProgram, toProjectRelativePath } from './program.js';
import { extractEntitiesFromFile } from './file-analyzer.js';
import { resolvePendingTasks, type RelationshipOccurrence } from './resolve-relationships.js';
import { buildEvidence } from './evidence-builder.js';
import type { PendingTask } from './pending-tasks.js';

export interface AnalyzeProjectOptions {
  tsconfigPath: string;
  projectId: string;
  /** 분석 시점의 Git revision (또는 등가 버전 식별자). */
  revision: string;
  /**
   * 이 목록이 주어지면 해당 파일(프로젝트 상대 경로)만 분석한다 (M3 증분 분석용).
   * 생략하면 tsconfig가 포함하는 전체 파일을 분석한다 (full scan).
   */
  onlyFiles?: string[];
}

function mergeOccurrences(occurrences: RelationshipOccurrence[]): Relationship[] {
  const map = new Map<string, Relationship>();
  for (const occ of occurrences) {
    const relId = relationshipId(occ.type, occ.sourceId, occ.targetId);
    let rel = map.get(relId);
    if (!rel) {
      rel = {
        id: relId,
        type: occ.type,
        sourceId: occ.sourceId,
        targetId: occ.targetId,
        resolution: occ.resolution,
        confidence: occ.confidence,
        evidence: [],
      };
      map.set(relId, rel);
    }
    if (!rel.evidence.some((e) => e.id === occ.evidence.id)) {
      rel.evidence.push(occ.evidence);
    }
    if (occ.resolution === 'static') {
      rel.resolution = 'static';
      rel.confidence = 1.0;
    } else if (rel.resolution === 'inferred') {
      rel.confidence = Math.max(rel.confidence, occ.confidence);
    }
  }
  return [...map.values()];
}

export function analyzeProject(options: AnalyzeProjectOptions): AnalysisResult {
  const { program, checker, projectRoot, rootFileNames } = loadProgram(options.tsconfigPath);
  const compilerOptions = program.getCompilerOptions();
  const rootFileSet = new Set(rootFileNames);

  const onlyFileSet = options.onlyFiles ? new Set(options.onlyFiles) : undefined;

  const entities: Entity[] = [];
  const failures: AnalysisFailure[] = [];
  const analyzedFilePaths: string[] = [];
  const nodeToEntityId = new Map<ts.Node, string>();
  const pending: PendingTask[] = [];
  const declareOccurrences: RelationshipOccurrence[] = [];

  for (const absPath of rootFileNames) {
    const relPath = toProjectRelativePath(projectRoot, absPath);
    if (onlyFileSet && !onlyFileSet.has(relPath)) continue;

    analyzedFilePaths.push(relPath);
    const sourceFile = program.getSourceFile(absPath);
    if (!sourceFile) {
      failures.push({ filePath: relPath, message: 'Source file could not be loaded by the Program' });
      continue;
    }

    const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (syntacticDiagnostics.length > 0) {
      const message = syntacticDiagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        .join('; ');
      failures.push({ filePath: relPath, message });
      continue;
    }

    try {
      const result = extractEntitiesFromFile(sourceFile, {
        projectId: options.projectId,
        revision: options.revision,
        relativeFilePath: relPath,
      });
      entities.push(...result.entities);
      for (const [node, id] of result.nodeToEntityId) nodeToEntityId.set(node, id);
      pending.push(...result.pending);
      for (const d of result.declares) {
        const relId = relationshipId('DECLARES', d.containerEntityId, d.memberEntityId);
        const evidence = buildEvidence(relId, sourceFile, d.memberNode, relPath, options.revision);
        declareOccurrences.push({
          type: 'DECLARES' as RelationshipType,
          sourceId: d.containerEntityId,
          targetId: d.memberEntityId,
          resolution: 'static',
          confidence: 1.0,
          evidence,
        });
      }
    } catch (err) {
      failures.push({
        filePath: relPath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const entitiesById = new Map(entities.map((e) => [e.id, e]));
  const externalModules = new Map<string, Entity>();

  const relationshipOccurrences = resolvePendingTasks(pending, {
    projectId: options.projectId,
    revision: options.revision,
    projectRoot,
    checker,
    compilerOptions,
    rootFileSet,
    nodeToEntityId,
    entitiesById,
    externalModules,
  });

  entities.push(...externalModules.values());
  const relationships = mergeOccurrences([...declareOccurrences, ...relationshipOccurrences]);

  return { entities, relationships, failures, analyzedFilePaths };
}
