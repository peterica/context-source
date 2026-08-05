import type { Entity, EntityKind, Evidence, Relationship, RelationshipType, Resolution } from '../types.js';

export interface EntityRow {
  id: string;
  project_id: string;
  kind: string;
  name: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  revision: string | null;
}

export function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as EntityKind,
    name: row.name,
    filePath: row.file_path,
    range:
      row.start_line !== null && row.end_line !== null
        ? { startLine: row.start_line, endLine: row.end_line }
        : null,
    revision: row.revision,
  };
}

export interface EvidenceRow {
  id: string;
  relationship_id: string;
  file_path: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  snippet: string;
  analyzer: string;
  revision: string;
}

export function rowToEvidence(row: EvidenceRow, includeSnippet = true): Evidence {
  return {
    id: row.id,
    filePath: row.file_path,
    range: {
      startLine: row.start_line,
      startCol: row.start_col,
      endLine: row.end_line,
      endCol: row.end_col,
    },
    snippet: includeSnippet ? row.snippet : '',
    analyzer: row.analyzer,
    revision: row.revision,
  };
}

export interface RelationshipRow {
  id: string;
  type: string;
  source_id: string;
  target_id: string;
  resolution: string;
  confidence: number;
  primary_evidence_id: string;
}

export function rowToRelationship(row: RelationshipRow, evidence: Evidence[]): Relationship {
  return {
    id: row.id,
    type: row.type as RelationshipType,
    sourceId: row.source_id,
    targetId: row.target_id,
    resolution: row.resolution as Resolution,
    confidence: row.confidence,
    evidence,
  };
}
