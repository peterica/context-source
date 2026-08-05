import * as ts from 'typescript';
import type { Entity } from '../types.js';
import { fileEntityId, symbolEntityId } from '../id.js';
import type { PendingTask } from './pending-tasks.js';

export interface FileExtractionContext {
  projectId: string;
  revision: string;
  relativeFilePath: string;
}

export interface FileExtractionResult {
  entities: Entity[];
  /** DECLARES는 phase A에서 바로 확정된다 (양쪽 Entity가 같은 파일 안에서 결정됨). */
  declares: Array<{ containerEntityId: string; memberEntityId: string; memberNode: ts.Node }>;
  pending: PendingTask[];
  /** 이 파일에서 선언된 심볼 노드 → Entity id. 다른 파일의 관계 해석(phase B)에서 전역으로 합쳐 사용한다. */
  nodeToEntityId: Map<ts.Node, string>;
}

interface WalkState {
  containerNames: string[];
  containerEntityId: string;
  callSourceEntityId: string | null;
}

function isFunctionLikeInitializer(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function memberName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined; // computed property name, destructuring — skipped (MVP limitation)
}

export function extractEntitiesFromFile(
  sourceFile: ts.SourceFile,
  ctx: FileExtractionContext,
): FileExtractionResult {
  const entities: Entity[] = [];
  const declares: FileExtractionResult['declares'] = [];
  const pending: PendingTask[] = [];
  const nodeToEntityId = new Map<ts.Node, string>();

  const fileId = fileEntityId(ctx.projectId, ctx.relativeFilePath);
  const lineCount = sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1;
  entities.push({
    id: fileId,
    projectId: ctx.projectId,
    kind: 'file',
    name: ctx.relativeFilePath.split('/').pop() ?? ctx.relativeFilePath,
    filePath: ctx.relativeFilePath,
    range: { startLine: 1, endLine: lineCount },
    revision: ctx.revision,
  });

  function createEntity(
    kind: 'class' | 'interface' | 'function' | 'method',
    name: string,
    node: ts.Node,
    state: WalkState,
    nameNode?: ts.Node,
  ): { id: string; symbolPath: string } {
    const symbolPath = [...state.containerNames, name].join('.');
    const id = symbolEntityId(ctx.projectId, ctx.relativeFilePath, symbolPath);
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    entities.push({
      id,
      projectId: ctx.projectId,
      kind,
      name,
      filePath: ctx.relativeFilePath,
      range: { startLine: start.line + 1, endLine: end.line + 1 },
      revision: ctx.revision,
    });
    declares.push({
      containerEntityId: state.containerEntityId,
      memberEntityId: id,
      memberNode: nameNode ?? node,
    });
    nodeToEntityId.set(node, id);
    return { id, symbolPath };
  }

  function visitHeritage(node: ts.ClassDeclaration | ts.InterfaceDeclaration, entityId: string) {
    for (const clause of node.heritageClauses ?? []) {
      const relType: 'IMPLEMENTS' | 'EXTENDS' =
        clause.token === ts.SyntaxKind.ImplementsKeyword ? 'IMPLEMENTS' : 'EXTENDS';
      for (const type of clause.types) {
        pending.push({ kind: 'heritage', sourceFile, entityId, typeNode: type, relType });
      }
    }
  }

  function visit(node: ts.Node, state: WalkState): void {
    // --- containers ---
    if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? 'default';
      const { id } = createEntity('class', name, node, state, node.name);
      visitHeritage(node, id);
      const nextState: WalkState = {
        containerNames: [...state.containerNames, name],
        containerEntityId: id,
        callSourceEntityId: null,
      };
      for (const member of node.members) visit(member, nextState);
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      const { id } = createEntity('interface', name, node, state, node.name);
      visitHeritage(node, id);
      // Interface 멤버는 Entity를 생성하지 않는다 (ADR-0002 §2) — 하위 탐색 불필요.
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.body) {
      const name = node.name?.text ?? 'default';
      const { id, symbolPath } = createEntity('function', name, node, state, node.name);
      const nextState: WalkState = {
        containerNames: symbolPath.split('.'),
        containerEntityId: id,
        callSourceEntityId: id,
      };
      visit(node.body, nextState);
      return;
    }

    if (ts.isMethodDeclaration(node) && node.body) {
      const name = memberName(node.name);
      if (name === undefined) {
        // computed method name — 추적 불가, 하위는 현재 컨텍스트로 계속 방문
        ts.forEachChild(node, (c) => visit(c, state));
        return;
      }
      const { id, symbolPath } = createEntity('method', name, node, state, node.name);
      const nextState: WalkState = {
        containerNames: symbolPath.split('.'),
        containerEntityId: id,
        callSourceEntityId: id,
      };
      visit(node.body, nextState);
      return;
    }

    if (ts.isPropertyDeclaration(node) && node.initializer && isFunctionLikeInitializer(node.initializer)) {
      const name = memberName(node.name);
      if (name === undefined) {
        ts.forEachChild(node, (c) => visit(c, state));
        return;
      }
      const fnNode = node.initializer;
      const { id, symbolPath } = createEntity('method', name, node, state, node.name);
      nodeToEntityId.set(fnNode, id); // 호출부는 initializer 노드로도 심볼 해석될 수 있음
      const nextState: WalkState = {
        containerNames: symbolPath.split('.'),
        containerEntityId: id,
        callSourceEntityId: id,
      };
      visit(fnNode.body, nextState);
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isFunctionLikeInitializer(node.initializer) &&
      ts.isIdentifier(node.name)
    ) {
      const name = node.name.text;
      const fnNode = node.initializer;
      const { id, symbolPath } = createEntity('function', name, node, state, node.name);
      nodeToEntityId.set(fnNode, id);
      const nextState: WalkState = {
        containerNames: symbolPath.split('.'),
        containerEntityId: id,
        callSourceEntityId: id,
      };
      visit(fnNode.body, nextState);
      return;
    }

    // --- relationship sources that are not containers ---
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      pending.push({
        kind: 'dynamic-import',
        sourceFile,
        fileEntityId: fileId,
        containingFileAbsPath: sourceFile.fileName,
        callExprNode: node,
      });
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (state.callSourceEntityId) {
        pending.push({
          kind: 'call',
          sourceFile,
          node,
          callSourceEntityId: state.callSourceEntityId,
          callSourceNode: node,
        });
      }
    }

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      pending.push({
        kind: 'import',
        sourceFile,
        fileEntityId: fileId,
        containingFileAbsPath: sourceFile.fileName,
        specifierNode: node.moduleSpecifier,
        statementNode: node,
      });
    }

    ts.forEachChild(node, (c) => visit(c, state));
  }

  const rootState: WalkState = { containerNames: [], containerEntityId: fileId, callSourceEntityId: null };
  ts.forEachChild(sourceFile, (c) => visit(c, rootState));

  return { entities, declares, pending, nodeToEntityId };
}
