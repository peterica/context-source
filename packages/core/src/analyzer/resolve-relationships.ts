import * as ts from 'typescript';
import type { Entity, Relationship, RelationshipType, UnresolvedReference, UnresolvedReferenceKind, UnresolvedReferenceReason } from '../types.js';
import { ANALYZER_ID } from '../types.js';
import { externalModuleEntityId, fileEntityId, relationshipId, unresolvedReferenceId } from '../id.js';
import { toProjectRelativePath } from './program.js';
import { resolveModuleSpecifier } from './resolve-module.js';
import { resolveDeclarationNode } from './resolve-symbol.js';
import { buildEvidence, rangeOfNode } from './evidence-builder.js';
import type { PendingTask } from './pending-tasks.js';

export interface RelationshipOccurrence {
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  resolution: 'static' | 'inferred';
  confidence: number;
  evidence: Relationship['evidence'][number];
}

export interface ResolveContext {
  projectId: string;
  revision: string;
  projectRoot: string;
  checker: ts.TypeChecker;
  compilerOptions: ts.CompilerOptions;
  rootFileSet: ReadonlySet<string>;
  nodeToEntityId: Map<ts.Node, string>;
  entitiesById: Map<string, Entity>;
  externalModules: Map<string, Entity>;
}

const INFERRED_CALL_CONFIDENCE = 0.8;
const INFERRED_DYNAMIC_IMPORT_CONFIDENCE = 0.6;

function ensureExternalModule(ctx: ResolveContext, packageName: string): Entity {
  const id = externalModuleEntityId(ctx.projectId, packageName);
  let entity = ctx.externalModules.get(id);
  if (!entity) {
    entity = {
      id,
      projectId: ctx.projectId,
      kind: 'external_module',
      name: packageName,
      filePath: null,
      range: null,
      revision: null,
    };
    ctx.externalModules.set(id, entity);
  }
  return entity;
}

type ImportResolution =
  | { ok: true; targetId: string }
  | { ok: false; reason: 'unresolvable-specifier' | 'internal-path-not-in-project' };

/**
 * IMPORTS류(정적/동적) target 해석. ADR-0011 — 'unresolved' kind는 specifier 자체를 못 찾은
 * 경우(경로 별칭 오류 등), 'internal'인데 entitiesById에 없는 경우는 tsconfig include 밖(대개
 * .d.ts나 분석 범위 밖 파일) — 둘 다 우리 프로젝트 자신의 사각지대이므로 이유를 구분해 돌려준다.
 * 'external'(패키지)은 이미 ExternalModule Entity로 성공 처리되므로 이 함수의 실패 경로가 아니다.
 */
function resolveImportLikeTarget(
  ctx: ResolveContext,
  specifierText: string,
  containingFileAbsPath: string,
): ImportResolution {
  const resolution = resolveModuleSpecifier(
    specifierText,
    containingFileAbsPath,
    ctx.compilerOptions,
    ctx.rootFileSet,
  );
  if (resolution.kind === 'external') {
    return { ok: true, targetId: ensureExternalModule(ctx, resolution.packageName).id };
  }
  if (resolution.kind === 'internal') {
    const relPath = toProjectRelativePath(ctx.projectRoot, resolution.absPath);
    const targetId = fileEntityId(ctx.projectId, relPath);
    if (ctx.entitiesById.has(targetId)) {
      return { ok: true, targetId };
    }
    return { ok: false, reason: 'internal-path-not-in-project' };
  }
  return { ok: false, reason: 'unresolvable-specifier' };
}

type CallResolution =
  | { ok: true; targetId: string; resolution: 'static' | 'inferred'; confidence: number }
  | { ok: false; reason: UnresolvedReferenceReason | null };

/**
 * 이 노드 종류였다면 원칙적으로 Entity가 됐어야 하는 선언(인터페이스 멤버, 클래스 멤버,
 * 함수/클래스 표현식) — §10 "알려진 제한사항"이 나열한 케이스와 정확히 대응한다.
 * VariableDeclaration/Parameter 같은 "값 바인딩"은 여기 포함하지 않는다 — Entity로 승격될 수
 * 있는 대상이 아니라 데이터플로우 문제이므로 ambiguous-callable-type으로 분류한다(아래).
 */
function looksLikeEntityDefinition(node: ts.Node): boolean {
  return (
    ts.isMethodSignature(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isClassExpression(node)
  );
}

/** declNode가 우리 프로젝트 소스 밖(외부 패키지, TS ambient lib)이면 OQ-11과 같은 경계로 취급해 기록하지 않는다. */
function classifyUnregisteredDecl(ctx: ResolveContext, declNode: ts.Node | undefined): UnresolvedReferenceReason | null {
  if (!declNode) return null;
  if (!ctx.rootFileSet.has(declNode.getSourceFile().fileName)) return null;
  return looksLikeEntityDefinition(declNode) ? 'entity-not-extracted' : 'ambiguous-callable-type';
}

function resolveCallTarget(ctx: ResolveContext, calleeExpr: ts.Expression): CallResolution {
  // undefined = 아직 판단 못함(첫 branch가 symbol/declNode 자체를 못 찾음, 두 번째 branch가 이어서 판단).
  // null은 "외부/ambient로 확정"이라는 의미 있는 값이라 undefined와 구분해야 한다 — `??`로 병합하면
  // null도 "아직 안 정해짐"으로 오인되어 두 번째 branch가 되돌아와 잘못 덮어쓴다(실제로 겪은 버그:
  // console.log처럼 외부 선언이 확정됐는데도 시그니처 fallback이 ambiguous-callable-type으로 덮어씀).
  let candidateReason: UnresolvedReferenceReason | null | undefined;

  const symbol = ctx.checker.getSymbolAtLocation(calleeExpr);
  if (symbol) {
    const declNode = resolveDeclarationNode(symbol, ctx.checker);
    if (declNode) {
      const targetId = ctx.nodeToEntityId.get(declNode);
      if (targetId) {
        return { ok: true, targetId, resolution: 'static', confidence: 1.0 };
      }
      candidateReason = classifyUnregisteredDecl(ctx, declNode);
    }
  }

  try {
    const type = ctx.checker.getTypeAtLocation(calleeExpr);
    const signatures = type.getCallSignatures();
    if (signatures.length === 1) {
      const decl = signatures[0]?.getDeclaration();
      const targetId = decl ? ctx.nodeToEntityId.get(decl) : undefined;
      if (targetId) {
        return { ok: true, targetId, resolution: 'inferred', confidence: INFERRED_CALL_CONFIDENCE };
      }
      if (candidateReason === undefined) candidateReason = classifyUnregisteredDecl(ctx, decl);
    } else if (candidateReason === undefined) {
      // 시그니처가 0개(대상 자체를 모름) 또는 2개 이상(오버로드/유니언이라 하나로 못 좁힘) —
      // 둘 다 "호출은 발견했지만 대상을 확정 못함"의 전형적인 케이스다.
      candidateReason = 'ambiguous-callable-type';
    }
  } catch {
    // 타입 조회가 실패해도 관계는 만들지 않는다(false positive 방지) — 다만 사각지대로는 기록한다.
    if (candidateReason === undefined) candidateReason = 'ambiguous-callable-type';
  }
  return { ok: false, reason: candidateReason ?? null };
}

export function resolvePendingTasks(
  tasks: PendingTask[],
  ctx: ResolveContext,
): { relationships: RelationshipOccurrence[]; unresolvedReferences: UnresolvedReference[] } {
  const occurrences: RelationshipOccurrence[] = [];
  const unresolved: UnresolvedReference[] = [];

  const push = (
    type: RelationshipType,
    sourceId: string,
    targetId: string,
    resolution: 'static' | 'inferred',
    confidence: number,
    sourceFile: ts.SourceFile,
    node: ts.Node,
    relFilePath: string,
  ) => {
    const relId = relationshipId(type, sourceId, targetId);
    const evidence = buildEvidence(relId, sourceFile, node, relFilePath, ctx.revision);
    occurrences.push({ type, sourceId, targetId, resolution, confidence, evidence });
  };

  const recordUnresolved = (
    kind: UnresolvedReferenceKind,
    reason: UnresolvedReferenceReason | null,
    sourceId: string,
    sourceFile: ts.SourceFile,
    node: ts.Node,
    relFilePath: string,
  ) => {
    if (!reason) return; // 우리 프로젝트 밖(외부 패키지/ambient) — OQ-11과 같은 경계, 기록하지 않는다.
    const range = rangeOfNode(sourceFile, node);
    unresolved.push({
      id: unresolvedReferenceId(sourceId, kind, relFilePath, range.startLine, range.startCol, range.endLine, range.endCol),
      projectId: ctx.projectId,
      sourceId,
      kind,
      reason,
      filePath: relFilePath,
      range,
      snippet: node.getText(sourceFile).trim(),
      analyzer: ANALYZER_ID,
      revision: ctx.revision,
    });
  };

  for (const task of tasks) {
    const relFilePath = toProjectRelativePath(ctx.projectRoot, task.sourceFile.fileName);

    if (task.kind === 'call') {
      const calleeExpr = ts.isNewExpression(task.node) ? task.node.expression : task.node.expression;
      const resolved = resolveCallTarget(ctx, calleeExpr);
      if (resolved.ok) {
        push(
          'CALLS',
          task.callSourceEntityId,
          resolved.targetId,
          resolved.resolution,
          resolved.confidence,
          task.sourceFile,
          task.node,
          relFilePath,
        );
      } else {
        recordUnresolved('CALLS', resolved.reason, task.callSourceEntityId, task.sourceFile, task.node, relFilePath);
      }
      continue;
    }

    if (task.kind === 'import') {
      const resolved = resolveImportLikeTarget(ctx, task.specifierNode.text, task.containingFileAbsPath);
      if (resolved.ok) {
        push('IMPORTS', task.fileEntityId, resolved.targetId, 'static', 1.0, task.sourceFile, task.statementNode, relFilePath);
      } else {
        recordUnresolved('IMPORTS', resolved.reason, task.fileEntityId, task.sourceFile, task.statementNode, relFilePath);
      }
      continue;
    }

    if (task.kind === 'dynamic-import') {
      const [arg] = task.callExprNode.arguments;
      if (arg && ts.isStringLiteralLike(arg)) {
        const resolved = resolveImportLikeTarget(ctx, arg.text, task.containingFileAbsPath);
        if (resolved.ok) {
          push(
            'IMPORTS',
            task.fileEntityId,
            resolved.targetId,
            'inferred',
            INFERRED_DYNAMIC_IMPORT_CONFIDENCE,
            task.sourceFile,
            task.callExprNode,
            relFilePath,
          );
        } else {
          recordUnresolved('IMPORTS', resolved.reason, task.fileEntityId, task.sourceFile, task.callExprNode, relFilePath);
        }
      } else {
        // specifier가 문자열 리터럴이 아니라 계산된 표현식(import(someVariable)) — 이름조차 알 수 없다.
        recordUnresolved('IMPORTS', 'unresolvable-specifier', task.fileEntityId, task.sourceFile, task.callExprNode, relFilePath);
      }
      continue;
    }

    if (task.kind === 'heritage') {
      const symbol = ctx.checker.getSymbolAtLocation(task.typeNode.expression);
      if (symbol) {
        const declNode = resolveDeclarationNode(symbol, ctx.checker);
        const targetId = declNode ? ctx.nodeToEntityId.get(declNode) : undefined;
        if (targetId) {
          push(task.relType, task.entityId, targetId, 'static', 1.0, task.sourceFile, task.typeNode, relFilePath);
        } else {
          const reason = classifyUnregisteredDecl(ctx, declNode);
          recordUnresolved(task.relType, reason, task.entityId, task.sourceFile, task.typeNode, relFilePath);
        }
      }
      // symbol 자체를 못 찾으면(매우 드묾) 추측하지 않고 기록도 하지 않는다.
      continue;
    }
  }

  return { relationships: occurrences, unresolvedReferences: unresolved };
}
