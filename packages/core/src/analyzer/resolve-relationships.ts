import * as ts from 'typescript';
import type { Entity, Relationship, RelationshipType } from '../types.js';
import { externalModuleEntityId, fileEntityId, relationshipId } from '../id.js';
import { toProjectRelativePath } from './program.js';
import { resolveModuleSpecifier } from './resolve-module.js';
import { resolveDeclarationNode } from './resolve-symbol.js';
import { buildEvidence } from './evidence-builder.js';
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

function resolveImportLikeTarget(
  ctx: ResolveContext,
  specifierText: string,
  containingFileAbsPath: string,
): string | undefined {
  const resolution = resolveModuleSpecifier(
    specifierText,
    containingFileAbsPath,
    ctx.compilerOptions,
    ctx.rootFileSet,
  );
  if (resolution.kind === 'external') {
    return ensureExternalModule(ctx, resolution.packageName).id;
  }
  if (resolution.kind === 'internal') {
    const relPath = toProjectRelativePath(ctx.projectRoot, resolution.absPath);
    const targetId = fileEntityId(ctx.projectId, relPath);
    return ctx.entitiesById.has(targetId) ? targetId : undefined;
  }
  return undefined;
}

function resolveCallTarget(
  ctx: ResolveContext,
  calleeExpr: ts.Expression,
): { targetId: string; resolution: 'static' | 'inferred'; confidence: number } | undefined {
  const symbol = ctx.checker.getSymbolAtLocation(calleeExpr);
  if (symbol) {
    const declNode = resolveDeclarationNode(symbol, ctx.checker);
    if (declNode) {
      const targetId = ctx.nodeToEntityId.get(declNode);
      if (targetId) {
        return { targetId, resolution: 'static', confidence: 1.0 };
      }
    }
  }

  try {
    const type = ctx.checker.getTypeAtLocation(calleeExpr);
    const signatures = type.getCallSignatures();
    if (signatures.length === 1) {
      const decl = signatures[0]?.getDeclaration();
      const targetId = decl ? ctx.nodeToEntityId.get(decl) : undefined;
      if (targetId) {
        return { targetId, resolution: 'inferred', confidence: INFERRED_CALL_CONFIDENCE };
      }
    }
  } catch {
    // 타입 조회가 실패하면 관계를 만들지 않는다 (false positive 방지)
  }
  return undefined;
}

export function resolvePendingTasks(
  tasks: PendingTask[],
  ctx: ResolveContext,
): RelationshipOccurrence[] {
  const occurrences: RelationshipOccurrence[] = [];

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

  for (const task of tasks) {
    const relFilePath = toProjectRelativePath(ctx.projectRoot, task.sourceFile.fileName);

    if (task.kind === 'call') {
      const calleeExpr = ts.isNewExpression(task.node) ? task.node.expression : task.node.expression;
      const resolved = resolveCallTarget(ctx, calleeExpr);
      if (resolved) {
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
      }
      continue;
    }

    if (task.kind === 'import') {
      const targetId = resolveImportLikeTarget(
        ctx,
        task.specifierNode.text,
        task.containingFileAbsPath,
      );
      if (targetId) {
        push(
          'IMPORTS',
          task.fileEntityId,
          targetId,
          'static',
          1.0,
          task.sourceFile,
          task.statementNode,
          relFilePath,
        );
      }
      continue;
    }

    if (task.kind === 'dynamic-import') {
      const [arg] = task.callExprNode.arguments;
      if (arg && ts.isStringLiteralLike(arg)) {
        const targetId = resolveImportLikeTarget(ctx, arg.text, task.containingFileAbsPath);
        if (targetId) {
          push(
            'IMPORTS',
            task.fileEntityId,
            targetId,
            'inferred',
            INFERRED_DYNAMIC_IMPORT_CONFIDENCE,
            task.sourceFile,
            task.callExprNode,
            relFilePath,
          );
        }
      }
      continue;
    }

    if (task.kind === 'heritage') {
      const symbol = ctx.checker.getSymbolAtLocation(task.typeNode.expression);
      if (symbol) {
        const declNode = resolveDeclarationNode(symbol, ctx.checker);
        const targetId = declNode ? ctx.nodeToEntityId.get(declNode) : undefined;
        if (targetId) {
          push(
            task.relType,
            task.entityId,
            targetId,
            'static',
            1.0,
            task.sourceFile,
            task.typeNode,
            relFilePath,
          );
        }
      }
      continue;
    }
  }

  return occurrences;
}
