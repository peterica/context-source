import * as ts from 'typescript';
import { ANALYZER_ID, type Evidence, type EvidenceRange } from '../types.js';
import { evidenceId } from '../id.js';

export function rangeOfNode(sourceFile: ts.SourceFile, node: ts.Node): EvidenceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startCol: start.character + 1,
    endLine: end.line + 1,
    endCol: end.character + 1,
  };
}

export function buildEvidence(
  relId: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  relativeFilePath: string,
  revision: string,
): Evidence {
  const range = rangeOfNode(sourceFile, node);
  const snippet = node.getText(sourceFile).trim();
  return {
    id: evidenceId(
      relId,
      relativeFilePath,
      range.startLine,
      range.startCol,
      range.endLine,
      range.endCol,
    ),
    filePath: relativeFilePath,
    range,
    snippet,
    analyzer: ANALYZER_ID,
    revision,
  };
}
