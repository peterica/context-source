import { z } from 'zod';
import {
  buildContext,
  getEntity,
  getRelationshipCounts,
  getSubgraph,
  listCallees,
  listCallers,
  searchEntities,
  type Db,
  type EntityKind,
  type RelationshipType,
  type Resolution,
} from '@contextsource/core';

const ENTITY_KINDS = ['file', 'class', 'interface', 'function', 'method', 'external_module'] as const;
const RELATIONSHIP_TYPES = ['DECLARES', 'IMPORTS', 'CALLS', 'IMPLEMENTS', 'EXTENDS'] as const;
const RESOLUTIONS = ['static', 'inferred'] as const;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function notFound(id: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: 'ENTITY_NOT_FOUND', message: `no entity with id ${id}` } }) }],
    isError: true,
  };
}

export interface ToolContext {
  db: Db;
  projectId: string;
}

/**
 * API.md 3장 MCP Tools — search_entities / get_entity / get_callers / get_callees / get_subgraph /
 * build_context(ADR-0012). 모두 읽기 전용이며 HTTP API와 동일한 core Query 서비스를 공유한다
 * (Shared Context 원칙).
 */
export function buildToolDefinitions(ctx: ToolContext) {
  return {
    search_entities: {
      title: 'Search entities',
      description:
        'Entity를 이름(부분 일치)/종류/파일 경로(접두 일치)로 검색한다. 관계 탐색의 시작점으로 사용한다 (FR-Q2).',
      inputSchema: {
        name: z.string().optional().describe('이름 부분 일치 (대소문자 무시)'),
        kind: z.enum(ENTITY_KINDS).optional(),
        filePath: z.string().optional().describe('파일 경로 접두 일치'),
        limit: z.number().int().min(1).max(200).optional().describe('기본 50, 최대 200'),
      },
      handler: (args: { name?: string; kind?: EntityKind; filePath?: string; limit?: number }) => {
        const result = searchEntities(ctx.db, {
          projectId: ctx.projectId,
          name: args.name,
          kind: args.kind,
          filePath: args.filePath,
          limit: args.limit ?? 50,
          offset: 0,
        });
        return json(result);
      },
    },

    get_entity: {
      title: 'Get entity detail',
      description: 'Entity 상세 정보와 들어오는/나가는 관계 개수를 반환한다 (FR-V2).',
      inputSchema: {
        id: z.string().describe('Entity의 canonical id (예: p1/sym:src/a.ts#Foo)'),
      },
      handler: (args: { id: string }) => {
        const entity = getEntity(ctx.db, args.id);
        if (!entity) return notFound(args.id);
        const relationshipCounts = getRelationshipCounts(ctx.db, args.id);
        return json({ entity, relationshipCounts });
      },
    },

    get_callers: {
      title: 'Get callers',
      description: '이 Entity를 호출하는(들어오는 CALLS) Entity 목록을 Evidence와 함께 반환한다 (FR-Q3).',
      inputSchema: {
        id: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      handler: (args: { id: string; limit?: number }) => {
        const entity = getEntity(ctx.db, args.id);
        if (!entity) return notFound(args.id);
        return json(listCallers(ctx.db, args.id, args.limit ?? 50, 0));
      },
    },

    get_callees: {
      title: 'Get callees',
      description: '이 Entity가 호출하는(나가는 CALLS) Entity 목록을 Evidence와 함께 반환한다 (FR-Q3).',
      inputSchema: {
        id: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      handler: (args: { id: string; limit?: number }) => {
        const entity = getEntity(ctx.db, args.id);
        if (!entity) return notFound(args.id);
        return json(listCallees(ctx.db, args.id, args.limit ?? 50, 0));
      },
    },

    get_subgraph: {
      title: 'Get impact/dependency subgraph',
      description:
        '지정한 Entity를 기준으로 direction/depth 안의 서브그래프(Entity+Relationship+Evidence)를 반환한다. ' +
        '영향 분석(direction=in)이나 구조 설명에 사용한다 (FR-Q4, FR-AI1). maxNodes와 includeSnippets=false로 ' +
        '토큰 예산을 제어할 수 있다 (FR-AI3). 전체 그래프 덤프는 제공하지 않는다.',
      inputSchema: {
        id: z.string(),
        direction: z.enum(['out', 'in', 'both']).optional().describe('기본 out'),
        depth: z.number().int().min(0).max(5).optional().describe('기본 2, 최대 5'),
        types: z.array(z.enum(RELATIONSHIP_TYPES)).optional(),
        resolution: z.enum(RESOLUTIONS).optional(),
        maxNodes: z.number().int().min(1).max(1000).optional().describe('기본 200, 최대 1000'),
        includeSnippets: z.boolean().optional().describe('기본 true. false면 응답 크기를 줄인다'),
      },
      handler: (args: {
        id: string;
        direction?: 'out' | 'in' | 'both';
        depth?: number;
        types?: RelationshipType[];
        resolution?: Resolution;
        maxNodes?: number;
        includeSnippets?: boolean;
      }) => {
        const entity = getEntity(ctx.db, args.id);
        if (!entity) return notFound(args.id);
        const result = getSubgraph(ctx.db, {
          rootId: args.id,
          direction: args.direction ?? 'out',
          depth: args.depth ?? 2,
          types: args.types,
          resolution: args.resolution,
          maxNodes: args.maxNodes ?? 200,
          includeSnippets: args.includeSnippets ?? true,
        });
        return json(result);
      },
    },

    build_context: {
      title: 'Build ranked, token-budgeted context around a search term',
      description:
        'search_entities와 같은 방식으로 검색어에 맞는 seed Entity를 찾고, 거기서 양방향으로 ' +
        '뻗어나가며 발견한 Entity를 관계 우선순위(CALLS>IMPLEMENTS/EXTENDS>IMPORTS>DECLARES)와 ' +
        'hopDepth·confidence로 랭킹해 반환한다(ADR-0012, BENCHMARK.md 5.6). 각 항목은 왜 포함됐는지 ' +
        '설명하는 reason 문장과 그 근거(Evidence)를 함께 준다. query는 자연어 질문 자체가 아니라 ' +
        '그 질문에서 뽑아낸 검색어다 — 서버는 질문을 해석하지 않는다. tokenBudget(문자수/4 근사치)을 ' +
        '넘기 전까지 우선순위 순서대로 채우고, 넘으면 그 자리에서 멈춘다(truncated:true).',
      inputSchema: {
        query: z.string().describe('seed Entity를 찾을 검색어(이름 부분 일치)'),
        tokenBudget: z.number().int().min(100).max(20000).optional().describe('기본 4000, 최대 20000'),
        maxSeeds: z.number().int().min(1).max(20).optional().describe('기본 5, 최대 20'),
        depth: z.number().int().min(0).max(5).optional().describe('기본 3, 최대 5'),
        types: z.array(z.enum(RELATIONSHIP_TYPES)).optional().describe('기본 5종 전부(DECLARES 포함)'),
        resolution: z.enum(RESOLUTIONS).optional(),
        includeSnippets: z.boolean().optional().describe('기본 true. false면 응답 크기를 줄인다'),
      },
      handler: (args: {
        query: string;
        tokenBudget?: number;
        maxSeeds?: number;
        depth?: number;
        types?: RelationshipType[];
        resolution?: Resolution;
        includeSnippets?: boolean;
      }) => {
        const result = buildContext(ctx.db, {
          projectId: ctx.projectId,
          query: args.query,
          tokenBudget: args.tokenBudget ?? 4000,
          maxSeeds: args.maxSeeds ?? 5,
          depth: args.depth ?? 3,
          types: args.types,
          resolution: args.resolution,
          includeSnippets: args.includeSnippets ?? true,
        });
        return json(result);
      },
    },
  };
}
