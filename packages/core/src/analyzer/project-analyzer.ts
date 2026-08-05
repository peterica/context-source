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

  // allEntities: nodeToEntityId/entitiesById 구성을 위해 범위(onlyFiles) 밖 파일도 포함한
  // 전체 심볼 지도. 증분 분석에서 재분석 대상 파일이 "범위 밖"의 이미 저장된 Entity를
  // 참조(IMPORTS/CALLS/heritage)할 때 대상이 존재하지 않는 것으로 오판하지 않기 위함이다.
  // 이 단계(AST 순회)는 TypeChecker 호출이 없어 비용이 낮고, checker를 쓰는 관계 해석(phase B)과
  // 저장 대상은 onlyFiles로 계속 좁혀지므로 증분 분석의 성능 이점은 유지된다.
  const allEntities: Entity[] = [];
  const failures: AnalysisFailure[] = [];
  const analyzedFilePaths: string[] = [];
  const nodeToEntityId = new Map<ts.Node, string>();
  const pending: PendingTask[] = [];
  const declareOccurrences: RelationshipOccurrence[] = [];

  for (const absPath of rootFileNames) {
    const relPath = toProjectRelativePath(projectRoot, absPath);
    const inScope = !onlyFileSet || onlyFileSet.has(relPath);

    const sourceFile = program.getSourceFile(absPath);
    if (!sourceFile) {
      if (inScope) {
        analyzedFilePaths.push(relPath);
        failures.push({ filePath: relPath, message: 'Source file could not be loaded by the Program' });
      }
      continue;
    }

    const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (syntacticDiagnostics.length > 0) {
      if (inScope) {
        const message = syntacticDiagnostics
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
          .join('; ');
        analyzedFilePaths.push(relPath);
        failures.push({ filePath: relPath, message });
      }
      // 범위 밖 파일이 깨져 있으면 조용히 건너뛴다 — 기존 DB의 해당 파일 데이터가 그대로 유효하며,
      // 이 파일이 이전 run에서 실패했다면 재분석 대상 집합에 이미 포함되어 범위 안이었을 것이다.
      continue;
    }

    try {
      const result = extractEntitiesFromFile(sourceFile, {
        projectId: options.projectId,
        revision: options.revision,
        relativeFilePath: relPath,
      });
      allEntities.push(...result.entities);
      for (const [node, id] of result.nodeToEntityId) nodeToEntityId.set(node, id);

      if (inScope) {
        analyzedFilePaths.push(relPath);
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
      }
    } catch (err) {
      if (inScope) {
        analyzedFilePaths.push(relPath);
        failures.push({
          filePath: relPath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const entitiesById = new Map(allEntities.map((e) => [e.id, e]));
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

  // 반환/저장 대상은 범위 안 파일의 Entity + 새로 참조된 ExternalModule로 제한한다.
  // (allEntities는 교차 파일 심볼 해석을 위한 내부용 전체 지도였을 뿐이다.)
  const inScopeEntities = onlyFileSet
    ? allEntities.filter((e) => e.filePath !== null && onlyFileSet.has(e.filePath))
    : allEntities;
  const entities = [...inScopeEntities, ...externalModules.values()];
  const relationships = mergeOccurrences([...declareOccurrences, ...relationshipOccurrences]);

  return { entities, relationships, failures, analyzedFilePaths };
}
