import * as ts from 'typescript';

export interface PendingCallTask {
  kind: 'call';
  sourceFile: ts.SourceFile;
  node: ts.CallExpression | ts.NewExpression;
  callSourceEntityId: string;
  callSourceNode: ts.Node;
}

export interface PendingImportTask {
  kind: 'import';
  sourceFile: ts.SourceFile;
  fileEntityId: string;
  containingFileAbsPath: string;
  specifierNode: ts.StringLiteralLike;
  statementNode: ts.Node;
}

export interface PendingDynamicImportTask {
  kind: 'dynamic-import';
  sourceFile: ts.SourceFile;
  fileEntityId: string;
  containingFileAbsPath: string;
  callExprNode: ts.CallExpression;
}

export interface PendingHeritageTask {
  kind: 'heritage';
  sourceFile: ts.SourceFile;
  entityId: string;
  typeNode: ts.ExpressionWithTypeArguments;
  relType: 'IMPLEMENTS' | 'EXTENDS';
}

export type PendingTask =
  | PendingCallTask
  | PendingImportTask
  | PendingDynamicImportTask
  | PendingHeritageTask;
