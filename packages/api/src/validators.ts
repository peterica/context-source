import type { EntityKind, RelationshipType, Resolution } from '@contextsource/core';
import { ApiError } from './errors.js';

const ENTITY_KINDS: EntityKind[] = [
  'file',
  'class',
  'interface',
  'function',
  'method',
  'external_module',
];
const RELATIONSHIP_TYPES: RelationshipType[] = [
  'DECLARES',
  'IMPORTS',
  'CALLS',
  'IMPLEMENTS',
  'EXTENDS',
];
const RESOLUTIONS: Resolution[] = ['static', 'inferred'];
const DIRECTIONS = ['in', 'out', 'both'] as const;

function parseIntParam(raw: unknown, name: string, def: number, min: number, max: number): number {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiError('INVALID_PARAM', `${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function parseLimit(raw: unknown, def = 50, max = 200): number {
  return parseIntParam(raw, 'limit', def, 1, max);
}

export function parseOffset(raw: unknown): number {
  return parseIntParam(raw, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
}

export function parseDepth(raw: unknown): number {
  return parseIntParam(raw, 'depth', 2, 0, 5);
}

export function parseMaxNodes(raw: unknown): number {
  return parseIntParam(raw, 'maxNodes', 200, 1, 1000);
}

export function parseDirection(raw: unknown, def: (typeof DIRECTIONS)[number] = 'both') {
  if (raw === undefined) return def;
  if (!DIRECTIONS.includes(raw as (typeof DIRECTIONS)[number])) {
    throw new ApiError('INVALID_PARAM', `direction must be one of ${DIRECTIONS.join(', ')}`);
  }
  return raw as (typeof DIRECTIONS)[number];
}

export function parseKind(raw: unknown): EntityKind | undefined {
  if (raw === undefined) return undefined;
  if (!ENTITY_KINDS.includes(raw as EntityKind)) {
    throw new ApiError('INVALID_PARAM', `kind must be one of ${ENTITY_KINDS.join(', ')}`);
  }
  return raw as EntityKind;
}

export function parseTypes(raw: unknown): RelationshipType[] | undefined {
  if (raw === undefined || raw === '') return undefined;
  const values = String(raw).split(',').map((s) => s.trim());
  for (const v of values) {
    if (!RELATIONSHIP_TYPES.includes(v as RelationshipType)) {
      throw new ApiError(
        'INVALID_PARAM',
        `types must be a comma-separated list from ${RELATIONSHIP_TYPES.join(', ')}`,
      );
    }
  }
  return values as RelationshipType[];
}

export function parseResolution(raw: unknown): Resolution | undefined {
  if (raw === undefined) return undefined;
  if (!RESOLUTIONS.includes(raw as Resolution)) {
    throw new ApiError('INVALID_PARAM', `resolution must be one of ${RESOLUTIONS.join(', ')}`);
  }
  return raw as Resolution;
}

export function parseBoolean(raw: unknown, def: boolean): boolean {
  if (raw === undefined) return def;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ApiError('INVALID_PARAM', 'expected a boolean query parameter (true|false)');
}

const PROJECT_ID_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export function requireNonEmptyString(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ApiError('INVALID_PARAM', `${field} must be a non-empty string`);
  }
  return raw.trim();
}

export function parseOptionalString(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new ApiError('INVALID_PARAM', `${field} must be a string`);
  }
  return raw;
}

export function parseProjectId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !PROJECT_ID_RE.test(raw)) {
    throw new ApiError(
      'INVALID_PARAM',
      'id must be lowercase alphanumeric with hyphens (kebab-case), 1-64 chars',
    );
  }
  return raw;
}
