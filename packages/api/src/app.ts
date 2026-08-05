import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  getEntity,
  getLastCompletedRun,
  getProject,
  getRelationshipCounts,
  getRun,
  getSubgraph,
  isAnyRunInProgress,
  listCallees,
  listCallers,
  listConnectedRelationships,
  listRuns,
  runFullAnalysis,
  runIncrementalAnalysis,
  searchEntities,
  type Db,
} from '@contextsource/core';
import { ApiError, toApiError, toErrorBody } from './errors.js';
import { decodeEntityId, encodeEntityId } from './id-encoding.js';
import {
  parseBoolean,
  parseDepth,
  parseDirection,
  parseKind,
  parseLimit,
  parseMaxNodes,
  parseOffset,
  parseResolution,
  parseTypes,
} from './validators.js';

export interface AppContext {
  db: Db;
  projectId: string;
  projectName: string;
  projectRootPath: string;
  /** POST /analysis/runs (mode=full)에서 사용할 tsconfig 경로. 없으면 해당 endpoint는 501을 반환한다. */
  tsconfigPath?: string;
  /** 분석 시점 revision을 계산한다 (기본은 고정 문자열; CLI/서버 기동부에서 git 기반 구현을 주입한다). */
  resolveRevision?: () => string;
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

function requireEntity(db: Db, encodedId: string) {
  const id = decodeEntityId(encodedId);
  if (id === undefined) {
    throw new ApiError('INVALID_PARAM', 'invalid encodedId (must be unpadded base64url)');
  }
  const entity = getEntity(db, id);
  if (!entity) {
    throw new ApiError('ENTITY_NOT_FOUND', `no entity with id ${id}`);
  }
  return entity;
}

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json());

  // 로컬 개발용 최소 CORS — 별도 패키지 의존성 없이 헤더만 설정한다.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const router = express.Router();

  // 2.1 Entity 검색 — FR-Q2
  router.get(
    '/entities',
    asyncHandler((req, res) => {
      const result = searchEntities(ctx.db, {
        projectId: ctx.projectId,
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
  router.get(
    '/entities/:encodedId',
    asyncHandler((req, res) => {
      const entity = requireEntity(ctx.db, req.params.encodedId!);
      const relationshipCounts = getRelationshipCounts(ctx.db, entity.id);
      res.json({ entity, relationshipCounts });
    }),
  );

  // 2.3 연결 관계 목록 — FR-V2, FR-Q5
  router.get(
    '/entities/:encodedId/relationships',
    asyncHandler((req, res) => {
      const entity = requireEntity(ctx.db, req.params.encodedId!);
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
  router.get(
    '/entities/:encodedId/callers',
    asyncHandler((req, res) => {
      const entity = requireEntity(ctx.db, req.params.encodedId!);
      res.json(listCallers(ctx.db, entity.id, parseLimit(req.query.limit), parseOffset(req.query.offset)));
    }),
  );
  router.get(
    '/entities/:encodedId/callees',
    asyncHandler((req, res) => {
      const entity = requireEntity(ctx.db, req.params.encodedId!);
      res.json(listCallees(ctx.db, entity.id, parseLimit(req.query.limit), parseOffset(req.query.offset)));
    }),
  );

  // 2.5 서브그래프 — FR-Q4, FR-Q5, FR-Q6
  router.get(
    '/entities/:encodedId/subgraph',
    asyncHandler((req, res) => {
      const entity = requireEntity(ctx.db, req.params.encodedId!);
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
  router.post(
    '/analysis/runs',
    asyncHandler((req, res) => {
      const mode = req.body?.mode;
      if (mode !== 'full' && mode !== 'incremental') {
        throw new ApiError('INVALID_PARAM', "mode must be 'full' or 'incremental'");
      }
      if (isAnyRunInProgress(ctx.db, ctx.projectId)) {
        throw new ApiError('ANALYSIS_IN_PROGRESS', 'an analysis run is already in progress');
      }
      if (!ctx.tsconfigPath) {
        throw new ApiError('INVALID_PARAM', 'server was not started with a tsconfig path');
      }
      if (mode === 'incremental') {
        const run = runIncrementalAnalysis({
          db: ctx.db,
          projectId: ctx.projectId,
          tsconfigPath: ctx.tsconfigPath,
        });
        res.status(202).json({ runId: run.id });
        return;
      }
      const revision = ctx.resolveRevision ? ctx.resolveRevision() : 'unversioned';
      const run = runFullAnalysis({
        db: ctx.db,
        projectId: ctx.projectId,
        tsconfigPath: ctx.tsconfigPath,
        revision,
      });
      res.status(202).json({ runId: run.id });
    }),
  );

  router.get(
    '/analysis/runs/:id',
    asyncHandler((req, res) => {
      const run = getRun(ctx.db, req.params.id!);
      if (!run) throw new ApiError('RUN_NOT_FOUND', `no run with id ${req.params.id}`);
      res.json(run);
    }),
  );

  router.get(
    '/analysis/runs',
    asyncHandler((req, res) => {
      res.json({ items: listRuns(ctx.db, ctx.projectId, parseLimit(req.query.limit, 20, 200)) });
    }),
  );

  // 2.7 프로젝트 정보
  router.get(
    '/project',
    asyncHandler((_req, res) => {
      const project = getProject(ctx.db, ctx.projectId) ?? {
        id: ctx.projectId,
        name: ctx.projectName,
        rootPath: ctx.projectRootPath,
      };
      const lastRun = getLastCompletedRun(ctx.db, ctx.projectId) ?? null;
      res.json({ project, lastRun });
    }),
  );

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
