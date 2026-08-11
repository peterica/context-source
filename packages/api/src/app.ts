import * as path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  addTechStackEntry,
  createProject,
  deleteProject,
  detectTechStack,
  findSimilarProjects,
  generateProjectId,
  getEntity,
  getProjectSummary,
  getProjectStats,
  getRelationshipCounts,
  getRun,
  getSubgraph,
  isAnyRunInProgress,
  listCallees,
  listCallers,
  listConnectedRelationships,
  listInferredRelationships,
  listProjectsWithStats,
  listRuns,
  listTechStack,
  mergeTechStack,
  projectExists,
  removeTechStackEntry,
  runFullAnalysis,
  runIncrementalAnalysis,
  searchEntities,
  updateProject,
  type Db,
  type Entity,
  type Project,
  type UpdateProjectInput,
} from '@contextsource/core';
import { ApiError, toApiError, toErrorBody } from './errors.js';
import { decodeEntityId, encodeEntityId } from './id-encoding.js';
import { requireDirectory, requireFile, resolveWithinWorkspace } from './project-paths.js';
import {
  parseBoolean,
  parseDepth,
  parseDirection,
  parseKind,
  parseLimit,
  parseMaxNodes,
  parseOffset,
  parseOptionalString,
  parseProjectId,
  parseResolution,
  parseTypes,
  requireNonEmptyString,
  requireTechStackCategory,
  requireTechStackValue,
} from './validators.js';

export interface AppContext {
  db: Db;
  /** 프로젝트 등록(POST /projects) 시 상대 경로를 해석하는 기준 디렉터리 (ADR-0004 §1). */
  workspaceRoot: string;
  /** 분석 시점 revision을 프로젝트의 root_path 기준으로 계산한다 (git 저장소가 아니면 호출측이 폴백값을 반환). */
  resolveRevision?: (repoRoot: string) => string;
}

function asyncHandler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      fn(req, res);
    } catch (err) {
      next(toApiError(err) ?? err);
    }
  };
}

function requireProject(db: Db, projectId: string): Project {
  const summary = getProjectSummary(db, projectId);
  if (!summary) {
    throw new ApiError('PROJECT_NOT_FOUND', `no project with id ${projectId}`);
  }
  return summary.project;
}

function requireEntity(db: Db, projectId: string, encodedId: string): Entity {
  const id = decodeEntityId(encodedId);
  if (id === undefined) {
    throw new ApiError('INVALID_PARAM', 'invalid encodedId (must be unpadded base64url)');
  }
  const entity = getEntity(db, id);
  if (!entity || entity.projectId !== projectId) {
    throw new ApiError('ENTITY_NOT_FOUND', `no entity with id ${id} in project ${projectId}`);
  }
  return entity;
}

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json());

  // 로컬 개발용 최소 CORS — 별도 패키지 의존성 없이 헤더만 설정한다.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const router = express.Router();

  // ── workspace 정보 (읽기 전용) ───────────────────────────────────────────
  // 프로젝트 등록 폼이 "workspace root 기준 상대 경로"를 요구하는데, 정작 그 root 값을
  // Web UI 어디서도 확인할 수 없었다(UX 감사 P1-1) — 등록 화면에 실제 값을 보여주기 위함.
  router.get(
    '/workspace',
    asyncHandler((_req, res) => {
      res.json({ root: ctx.workspaceRoot });
    }),
  );

  // ── 프로젝트 등록/목록/관리 (ADR-0004) ──────────────────────────────────

  router.get(
    '/projects',
    asyncHandler((_req, res) => {
      res.json({ items: listProjectsWithStats(ctx.db) });
    }),
  );

  router.post(
    '/projects',
    asyncHandler((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = requireNonEmptyString(body.name, 'name');
      const relPath = requireNonEmptyString(body.path, 'path');
      const tsconfigRel = requireNonEmptyString(body.tsconfigPath, 'tsconfigPath');
      const description = parseOptionalString(body.description, 'description') ?? null;
      const explicitId = parseProjectId(body.id);

      const absoluteRoot = resolveWithinWorkspace(ctx.workspaceRoot, relPath);
      requireDirectory(absoluteRoot, relPath, '프로젝트 경로');
      const absoluteTsconfig = path.isAbsolute(tsconfigRel)
        ? tsconfigRel
        : path.join(absoluteRoot, tsconfigRel);
      requireFile(absoluteTsconfig, tsconfigRel, 'tsconfig 경로');

      if (explicitId && projectExists(ctx.db, explicitId)) {
        throw new ApiError('PROJECT_ALREADY_EXISTS', `project ${explicitId} already exists`);
      }
      const id = explicitId ?? generateProjectId(ctx.db, name);

      const project = createProject(ctx.db, {
        id,
        name,
        rootPath: absoluteRoot,
        tsconfigPath: absoluteTsconfig,
        description,
      });
      res.status(201).json({ project });
    }),
  );

  router.get(
    '/projects/:projectId',
    asyncHandler((req, res) => {
      const summary = getProjectSummary(ctx.db, req.params.projectId!);
      if (!summary) throw new ApiError('PROJECT_NOT_FOUND', `no project with id ${req.params.projectId}`);
      res.json(summary);
    }),
  );

  router.patch(
    '/projects/:projectId',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: UpdateProjectInput = {};
      if (body.name !== undefined) patch.name = requireNonEmptyString(body.name, 'name');
      if (body.description !== undefined) {
        patch.description = parseOptionalString(body.description, 'description') ?? null;
      }
      if (body.tsconfigPath !== undefined) {
        const tsRel = requireNonEmptyString(body.tsconfigPath, 'tsconfigPath');
        const abs = path.isAbsolute(tsRel) ? tsRel : path.join(project.rootPath, tsRel);
        requireFile(abs, tsRel, 'tsconfig 경로');
        patch.tsconfigPath = abs;
      }
      const updated = updateProject(ctx.db, project.id, patch);
      res.json({ project: updated });
    }),
  );

  router.delete(
    '/projects/:projectId',
    asyncHandler((req, res) => {
      const existed = deleteProject(ctx.db, req.params.projectId!);
      if (!existed) throw new ApiError('PROJECT_NOT_FOUND', `no project with id ${req.params.projectId}`);
      res.status(204).end();
    }),
  );

  // ── 프로젝트 범위 하위 리소스 ────────────────────────────────────────────
  const projectRouter = express.Router({ mergeParams: true });

  // 2.1 Entity 검색 — FR-Q2
  projectRouter.get(
    '/entities',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const result = searchEntities(ctx.db, {
        projectId: project.id,
        name: typeof req.query.name === 'string' ? req.query.name : undefined,
        kind: parseKind(req.query.kind),
        filePath: typeof req.query.filePath === 'string' ? req.query.filePath : undefined,
        limit: parseLimit(req.query.limit),
        offset: parseOffset(req.query.offset),
      });
      res.json(result);
    }),
  );

  // 2.2 Entity 상세 — FR-V2
  projectRouter.get(
    '/entities/:encodedId',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const entity = requireEntity(ctx.db, project.id, req.params.encodedId!);
      const relationshipCounts = getRelationshipCounts(ctx.db, entity.id);
      res.json({ entity, relationshipCounts });
    }),
  );

  // 2.3 연결 관계 목록 — FR-V2, FR-Q5
  projectRouter.get(
    '/entities/:encodedId/relationships',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const entity = requireEntity(ctx.db, project.id, req.params.encodedId!);
      const result = listConnectedRelationships(ctx.db, {
        entityId: entity.id,
        direction: parseDirection(req.query.direction),
        types: parseTypes(req.query.types),
        resolution: parseResolution(req.query.resolution),
        limit: parseLimit(req.query.limit),
        offset: parseOffset(req.query.offset),
      });
      res.json(result);
    }),
  );

  // 2.4 Caller / Callee — FR-Q3
  projectRouter.get(
    '/entities/:encodedId/callers',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const entity = requireEntity(ctx.db, project.id, req.params.encodedId!);
      res.json(listCallers(ctx.db, entity.id, parseLimit(req.query.limit), parseOffset(req.query.offset)));
    }),
  );
  projectRouter.get(
    '/entities/:encodedId/callees',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const entity = requireEntity(ctx.db, project.id, req.params.encodedId!);
      res.json(listCallees(ctx.db, entity.id, parseLimit(req.query.limit), parseOffset(req.query.offset)));
    }),
  );

  // 2.5 서브그래프 — FR-Q4, FR-Q5, FR-Q6
  projectRouter.get(
    '/entities/:encodedId/subgraph',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const entity = requireEntity(ctx.db, project.id, req.params.encodedId!);
      const direction = parseDirection(req.query.direction, 'out');
      const result = getSubgraph(ctx.db, {
        rootId: entity.id,
        direction,
        depth: parseDepth(req.query.depth),
        types: parseTypes(req.query.types),
        resolution: parseResolution(req.query.resolution),
        maxNodes: parseMaxNodes(req.query.maxNodes),
        includeSnippets: parseBoolean(req.query.includeSnippets, true),
      });
      res.json(result);
    }),
  );

  // 2.6 분석 실행 — FR-A6, FR-A7, FR-A8
  projectRouter.post(
    '/analysis/runs',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const mode = req.body?.mode;
      if (mode !== 'full' && mode !== 'incremental') {
        throw new ApiError('INVALID_PARAM', "mode must be 'full' or 'incremental'");
      }
      if (isAnyRunInProgress(ctx.db, project.id)) {
        throw new ApiError('ANALYSIS_IN_PROGRESS', 'an analysis run is already in progress');
      }
      if (mode === 'incremental') {
        const run = runIncrementalAnalysis({
          db: ctx.db,
          projectId: project.id,
          tsconfigPath: project.tsconfigPath,
        });
        res.status(202).json({ runId: run.id });
        return;
      }
      const revision = ctx.resolveRevision ? ctx.resolveRevision(project.rootPath) : 'unversioned';
      const run = runFullAnalysis({
        db: ctx.db,
        projectId: project.id,
        tsconfigPath: project.tsconfigPath,
        revision,
      });
      res.status(202).json({ runId: run.id });
    }),
  );

  projectRouter.get(
    '/analysis/runs/:id',
    asyncHandler((req, res) => {
      requireProject(ctx.db, req.params.projectId!);
      const run = getRun(ctx.db, req.params.id!);
      if (!run || run.projectId !== req.params.projectId) {
        throw new ApiError('RUN_NOT_FOUND', `no run with id ${req.params.id}`);
      }
      res.json(run);
    }),
  );

  projectRouter.get(
    '/analysis/runs',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      res.json({ items: listRuns(ctx.db, project.id, parseLimit(req.query.limit, 20, 200)) });
    }),
  );

  // 통계 / inferred 관계 검토 — API.md §2.8 (구현 확장)
  projectRouter.get(
    '/stats',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      res.json(getProjectStats(ctx.db, project.id));
    }),
  );

  projectRouter.get(
    '/inferred-relationships',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      res.json(
        listInferredRelationships(
          ctx.db,
          project.id,
          parseLimit(req.query.limit),
          parseOffset(req.query.offset),
        ),
      );
    }),
  );

  // 기술 스택 — ADR-0005
  projectRouter.get(
    '/tech-stack',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      res.json({ items: listTechStack(ctx.db, project.id) });
    }),
  );

  projectRouter.post(
    '/tech-stack',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const category = requireTechStackCategory(body.category);
      const value = requireTechStackValue(body.value);
      addTechStackEntry(ctx.db, project.id, { category, value });
      res.status(201).json({ items: listTechStack(ctx.db, project.id) });
    }),
  );

  projectRouter.delete(
    '/tech-stack',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const category = requireTechStackCategory(body.category);
      const value = requireTechStackValue(body.value);
      removeTechStackEntry(ctx.db, project.id, { category, value });
      res.status(204).end();
    }),
  );

  projectRouter.post(
    '/tech-stack/detect',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const before = new Set(listTechStack(ctx.db, project.id).map((e) => `${e.category}:${e.value}`));
      const detected = detectTechStack(project);
      mergeTechStack(ctx.db, project.id, detected);
      const items = listTechStack(ctx.db, project.id);
      const added = items.filter((e) => !before.has(`${e.category}:${e.value}`));
      res.json({ items, added });
    }),
  );

  // 유사 프로젝트 탐색 — ADR-0006 (기술 스택 태그 교집합, Vector Search 아님)
  projectRouter.get(
    '/similar',
    asyncHandler((req, res) => {
      const project = requireProject(ctx.db, req.params.projectId!);
      const items = findSimilarProjects(ctx.db, project.id, parseLimit(req.query.limit, 10, 50));
      res.json({ items });
    }),
  );

  router.use('/projects/:projectId', projectRouter);

  app.use('/api/v1', router);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(toErrorBody(err));
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' } });
  });

  return app;
}

export { encodeEntityId };
