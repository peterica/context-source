import type {
  AnalysisRun,
  AnalysisRunMode,
  Entity,
  EntityKind,
  Project,
  Relationship,
  RelationshipType,
  Resolution,
  TechStackCategory,
  TechStackEntry,
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

async function send<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = res.status === 204 ? (undefined as T) : await res.json();
  return { status: res.status, body };
}

export function encodeEntityId(canonicalId: string): string {
  const bytes = new TextEncoder().encode(canonicalId);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

export interface ProjectSummary {
  project: Project;
  entityCount: number;
  relationshipCount: number;
  lastRun: AnalysisRun | null;
  techStack: TechStackEntry[];
}

export interface SimilarProject {
  project: Project;
  sharedTechStack: TechStackEntry[];
  score: number;
}

export interface CreateProjectPayload {
  name: string;
  path: string;
  tsconfigPath: string;
  id?: string;
  description?: string;
}

export const api = {
  // ── 프로젝트 등록/목록 (ADR-0004) ──────────────────────────────────────
  listProjects: () => request<{ items: ProjectSummary[] }>('/projects'),

  getProjectSummary: (projectId: string) => request<ProjectSummary>(`/projects/${projectId}`),

  createProject: (payload: CreateProjectPayload) =>
    send<{ project: Project } | { error: { code: string; message: string } }>('POST', '/projects', payload),

  updateProject: (projectId: string, patch: { name?: string; tsconfigPath?: string; description?: string }) =>
    send<{ project: Project }>('PATCH', `/projects/${projectId}`, patch),

  deleteProject: (projectId: string) => send<void>('DELETE', `/projects/${projectId}`),

  // ── 프로젝트 범위 조회 ────────────────────────────────────────────────
  getStats: (projectId: string) => request<ProjectStats>(`/projects/${projectId}/stats`),

  listInferredRelationships: (projectId: string, limit = 50, offset = 0) =>
    request<{ items: { relationship: Relationship; source: Entity; target: Entity }[]; total: number }>(
      `/projects/${projectId}/inferred-relationships?limit=${limit}&offset=${offset}`,
    ),

  searchEntities: (
    projectId: string,
    params: { name?: string; kind?: EntityKind; filePath?: string; limit?: number },
  ) => {
    const q = new URLSearchParams();
    if (params.name) q.set('name', params.name);
    if (params.kind) q.set('kind', params.kind);
    if (params.filePath) q.set('filePath', params.filePath);
    q.set('limit', String(params.limit ?? 50));
    return request<{ items: Entity[]; total: number }>(`/projects/${projectId}/entities?${q.toString()}`);
  },

  getEntity: (projectId: string, encodedId: string) =>
    request<{ entity: Entity; relationshipCounts: { in: number; out: number } }>(
      `/projects/${projectId}/entities/${encodedId}`,
    ),

  getRelationships: (
    projectId: string,
    encodedId: string,
    params: { direction?: 'in' | 'out' | 'both'; types?: RelationshipType[]; resolution?: Resolution },
  ) => {
    const q = new URLSearchParams();
    if (params.direction) q.set('direction', params.direction);
    if (params.types && params.types.length > 0) q.set('types', params.types.join(','));
    if (params.resolution) q.set('resolution', params.resolution);
    return request<{ items: { relationship: Relationship; counterpart: Entity }[]; total: number }>(
      `/projects/${projectId}/entities/${encodedId}/relationships?${q.toString()}`,
    );
  },

  getCallers: (projectId: string, encodedId: string) =>
    request<{ items: { relationship: Relationship; counterpart: Entity }[]; total: number }>(
      `/projects/${projectId}/entities/${encodedId}/callers`,
    ),

  getCallees: (projectId: string, encodedId: string) =>
    request<{ items: { relationship: Relationship; counterpart: Entity }[]; total: number }>(
      `/projects/${projectId}/entities/${encodedId}/callees`,
    ),

  getSubgraph: (
    projectId: string,
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
    }>(`/projects/${projectId}/entities/${encodedId}/subgraph?${q.toString()}`);
  },

  listRuns: (projectId: string, limit = 20) =>
    request<{ items: AnalysisRun[] }>(`/projects/${projectId}/analysis/runs?limit=${limit}`),

  getRun: (projectId: string, runId: string) =>
    request<AnalysisRun>(`/projects/${projectId}/analysis/runs/${runId}`),

  triggerRun: (projectId: string, mode: AnalysisRunMode) =>
    send<{ runId: string }>('POST', `/projects/${projectId}/analysis/runs`, { mode }),

  // ── 기술 스택 (ADR-0005) ────────────────────────────────────────────────
  getTechStack: (projectId: string) =>
    request<{ items: TechStackEntry[] }>(`/projects/${projectId}/tech-stack`),

  addTechStackEntry: (projectId: string, category: TechStackCategory, value: string) =>
    send<{ items: TechStackEntry[] }>('POST', `/projects/${projectId}/tech-stack`, { category, value }),

  removeTechStackEntry: (projectId: string, category: TechStackCategory, value: string) =>
    send<void>('DELETE', `/projects/${projectId}/tech-stack`, { category, value }),

  detectTechStack: (projectId: string) =>
    send<{ items: TechStackEntry[]; added: TechStackEntry[] }>(
      'POST',
      `/projects/${projectId}/tech-stack/detect`,
    ),

  // ── 유사 프로젝트 탐색 (ADR-0006) ────────────────────────────────────────
  getSimilarProjects: (projectId: string, limit = 10) =>
    request<{ items: SimilarProject[] }>(`/projects/${projectId}/similar?limit=${limit}`),
};
