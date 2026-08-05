import type {
  AnalysisRun,
  AnalysisRunMode,
  Entity,
  EntityKind,
  Relationship,
  RelationshipType,
  Resolution,
} from '@contextsource/core';

const API_BASE =
  (window as unknown as { __CONTEXTSOURCE_API_BASE__?: string }).__CONTEXTSOURCE_API_BASE__ ??
  '/api/v1';

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const body = await res.json();
  if (!res.ok) {
    throw new ApiRequestError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText, res.status);
  }
  return body as T;
}

async function post<T>(path: string, payload: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export function encodeEntityId(canonicalId: string): string {
  const bytes = new TextEncoder().encode(canonicalId);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
}

export interface ProjectStats {
  entities: { total: number; byKind: Record<EntityKind, number> };
  relationships: {
    total: number;
    byType: Record<RelationshipType, number>;
    byResolution: Record<Resolution, number>;
  };
  evidence: { total: number };
}

export const api = {
  getProject: () => request<{ project: Project; lastRun: AnalysisRun | null }>('/project'),

  getStats: () => request<ProjectStats>('/project/stats'),

  listInferredRelationships: (limit = 50, offset = 0) =>
    request<{ items: { relationship: Relationship; source: Entity; target: Entity }[]; total: number }>(
      `/project/inferred-relationships?limit=${limit}&offset=${offset}`,
    ),

  searchEntities: (params: { name?: string; kind?: EntityKind; filePath?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.name) q.set('name', params.name);
    if (params.kind) q.set('kind', params.kind);
    if (params.filePath) q.set('filePath', params.filePath);
    q.set('limit', String(params.limit ?? 50));
    return request<{ items: Entity[]; total: number }>(`/entities?${q.toString()}`);
  },

  getEntity: (encodedId: string) =>
    request<{ entity: Entity; relationshipCounts: { in: number; out: number } }>(
      `/entities/${encodedId}`,
    ),

  getRelationships: (
    encodedId: string,
    params: { direction?: 'in' | 'out' | 'both'; types?: RelationshipType[]; resolution?: Resolution },
  ) => {
    const q = new URLSearchParams();
    if (params.direction) q.set('direction', params.direction);
    if (params.types && params.types.length > 0) q.set('types', params.types.join(','));
    if (params.resolution) q.set('resolution', params.resolution);
    return request<{ items: { relationship: Relationship; counterpart: Entity }[]; total: number }>(
      `/entities/${encodedId}/relationships?${q.toString()}`,
    );
  },

  getCallers: (encodedId: string) =>
    request<{ items: { relationship: Relationship; counterpart: Entity }[]; total: number }>(
      `/entities/${encodedId}/callers`,
    ),

  getCallees: (encodedId: string) =>
    request<{ items: { relationship: Relationship; counterpart: Entity }[]; total: number }>(
      `/entities/${encodedId}/callees`,
    ),

  getSubgraph: (
    encodedId: string,
    params: {
      direction?: 'in' | 'out' | 'both';
      depth?: number;
      types?: RelationshipType[];
      resolution?: Resolution;
      maxNodes?: number;
    },
  ) => {
    const q = new URLSearchParams();
    if (params.direction) q.set('direction', params.direction);
    if (params.depth !== undefined) q.set('depth', String(params.depth));
    if (params.types && params.types.length > 0) q.set('types', params.types.join(','));
    if (params.resolution) q.set('resolution', params.resolution);
    if (params.maxNodes !== undefined) q.set('maxNodes', String(params.maxNodes));
    return request<{
      rootId: string;
      entities: Entity[];
      relationships: Relationship[];
      truncated: boolean;
      stats: { entityCount: number; relationshipCount: number; maxDepthReached: number };
    }>(`/entities/${encodedId}/subgraph?${q.toString()}`);
  },

  listRuns: (limit = 20) => request<{ items: AnalysisRun[] }>(`/analysis/runs?limit=${limit}`),

  getRun: (id: string) => request<AnalysisRun>(`/analysis/runs/${id}`),

  triggerRun: (mode: AnalysisRunMode) => post<{ runId: string }>('/analysis/runs', { mode }),
};
