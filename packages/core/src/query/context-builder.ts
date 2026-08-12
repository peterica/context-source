import type { Db } from '../storage/db.js';
import type { Entity, Evidence, RelationshipType, Resolution } from '../types.js';
import { searchEntities, getEntitiesByIds } from './entity-queries.js';
import { loadEvidenceForRelationships } from './relationship-queries.js';
import { REASON_TEMPLATES } from './impact.js';
import type { RelationshipRow } from '../storage/mappers.js';

/**
 * ADR-0012 — Graph-only Context Builder. `computeImpact`(ADR-0008, direction=in 전용,
 * 단일 소스)와 `getSubgraph`(임의 방향, 임의 소스, 경로 정보 없음) 둘 다 이 기능에 맞지 않아
 * (초안이 getSubgraph를 재사용하려다 codex 독립 검토에서 "대표 관계가 실제 발견 경로와
 * 무관할 수 있다"는 결함을 지적받고 폐기 — 커밋 로그 참고) 다중 소스(모든 seed가 동시에
 * depth 0) + 양방향이면서 predecessor(발견시킨 관계)를 추적하는 전용 BFS를 새로 둔다.
 * computeImpact/getSubgraph 자체는 건드리지 않는다.
 */

// impact 분석과 달리 DECLARES를 기본 포함한다 — "이 심볼이 어디 소속인지"도 유용한 맥락이라
// 완전히 배제할 이유가 없다. 다만 우선순위 최하위라 예산이 빠듯하면 가장 먼저 잘린다.
const DEFAULT_CONTEXT_TYPES: RelationshipType[] = ['DECLARES', 'IMPORTS', 'CALLS', 'IMPLEMENTS', 'EXTENDS'];

const TYPE_PRIORITY: Record<RelationshipType, number> = {
  CALLS: 4,
  IMPLEMENTS: 3,
  EXTENDS: 3,
  IMPORTS: 2,
  DECLARES: 1,
};

// 탐색 단계에서 먼저 잘라내면 우선순위 랭킹이 후보를 보기도 전에 중요한 후보가 사라질 수
// 있다(getSubgraph의 maxNodes가 그랬던 문제) — 넉넉한 내부 상한까지 모으고, 실제 절단은
// 우선순위 정렬 + 토큰 예산에서만 한다(computeChangedImpact의 INTERNAL_PER_ENTITY_CANDIDATE_LIMIT
// 과 같은 패턴).
const INTERNAL_VISIT_CAP = 1000;

export interface ContextBuilderParams {
  projectId: string;
  /** 검색어 — 자연어 질문 자체가 아니라 그 질문을 이해한 AI 클라이언트가 뽑아낸 검색어다. */
  query: string;
  tokenBudget: number;
  maxSeeds: number;
  depth: number;
  types?: RelationshipType[];
  resolution?: Resolution;
  includeSnippets: boolean;
}

export interface ContextItem {
  entity: Entity;
  /** 이 후보를 처음 발견시킨 관계(가장 가까운 seed 쪽 마지막 hop)의 타입. */
  relationshipType: RelationshipType;
  reason: string;
  /** 발견 경로 위 각 hop의 confidence를 곱한 값(ADR-0008 computeImpact와 같은 정의). */
  confidence: number;
  hasInferredHop: boolean;
  /** 가장 가까운 seed까지의 hop 수. */
  hopDepth: number;
  /** 발견시킨 마지막 hop의 Evidence — 같은 Entity가 여러 경로로 발견돼도 이거 하나만 남는다. */
  evidence: Evidence[];
}

export interface ContextBuildResult {
  seeds: Entity[];
  items: ContextItem[];
  estimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
}

/**
 * 실제 토크나이저(tiktoken 등) 없이 문자 수 기반 근사치를 쓴다(ADR-0012 결정 3) — 정확한
 * 토큰 수 보장이 아니라 "예산 근처"라는 신호다. 한국어·JSON 구조가 많으면 과소평가될 수 있다.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateItemTokens(item: ContextItem): number {
  const parts = [
    item.entity.id,
    item.entity.name,
    item.entity.kind,
    item.entity.filePath ?? '',
    item.relationshipType,
    item.reason,
    String(item.confidence),
    ...item.evidence.map((e) => `${e.filePath}:${e.range.startLine}:${e.range.startCol} ${e.snippet}`),
  ];
  return estimateTokens(parts.join(' '));
}

interface VisitedInfo {
  hopDepth: number;
  /** 이 노드를 발견시킨 관계. seed 자신이면 null. */
  viaRelationshipRow: RelationshipRow | null;
  /** 이 노드에서 seed 방향으로 한 칸 더 가까운 노드. seed 자신이면 null. */
  predecessor: string | null;
}

/**
 * ADR-0012 — 여러 seed에서 동시에 시작해 depth 안에서 양방향으로 확장하며, 각 노드를 처음
 * 발견시킨 관계(predecessor)를 추적하는 BFS. `getSubgraph`와 달리 "포함된 노드 사이의 모든
 * 관계"가 아니라 "실제로 이 노드를 찾아낸 그 관계 하나"만 남기므로, reason이 항상 진짜 발견
 * 경로를 가리킨다.
 */
export function buildContext(db: Db, params: ContextBuilderParams): ContextBuildResult {
  const seedsResult = searchEntities(db, {
    projectId: params.projectId,
    name: params.query,
    limit: params.maxSeeds,
    offset: 0,
  });
  const seeds = seedsResult.items;

  if (seeds.length === 0) {
    return { seeds: [], items: [], estimatedTokens: 0, tokenBudget: params.tokenBudget, truncated: false };
  }

  const types = params.types && params.types.length > 0 ? params.types : DEFAULT_CONTEXT_TYPES;
  const seedIds = seeds.map((s) => s.id);

  const visited = new Map<string, VisitedInfo>();
  for (const id of seedIds) {
    visited.set(id, { hopDepth: 0, viaRelationshipRow: null, predecessor: null });
  }

  let frontier = seedIds;
  for (let d = 1; d <= params.depth; d++) {
    if (frontier.length === 0 || visited.size >= INTERNAL_VISIT_CAP) break;

    const frontierSet = new Set(frontier);
    const conditions = [
      '(source_id IN (SELECT value FROM json_each(:frontier)) OR target_id IN (SELECT value FROM json_each(:frontier)))',
      'type IN (SELECT value FROM json_each(:types))',
    ];
    const bind: Record<string, string> = {
      frontier: JSON.stringify(frontier),
      types: JSON.stringify(types),
    };
    if (params.resolution) {
      conditions.push('resolution = :resolution');
      bind.resolution = params.resolution;
    }

    // confidence 내림차순 — 같은 hop에서 한 후보가 여러 관계로 동시에 발견되면 가장 확실한
    // 관계를 predecessor로 남긴다(computeImpact와 같은 관례).
    const rows = db
      .prepare(
        `SELECT id, type, source_id, target_id, resolution, confidence, primary_evidence_id
         FROM relationship WHERE ${conditions.join(' AND ')}
         ORDER BY confidence DESC, id ASC`,
      )
      .all(bind) as unknown as RelationshipRow[];

    const nextFrontier: string[] = [];
    for (const row of rows) {
      // 양방향이므로 frontier 쪽 끝의 "상대편"이 이번 hop의 새 후보다. 두 끝 다 frontier에
      // 있으면(예: seed끼리 직접 연결) 새로 발견되는 노드가 없다 — 아무 것도 안 한다.
      const sourceInFrontier = frontierSet.has(row.source_id);
      const targetInFrontier = frontierSet.has(row.target_id);
      let candidateId: string | null = null;
      let predecessorId: string | null = null;
      if (sourceInFrontier && !targetInFrontier) {
        candidateId = row.target_id;
        predecessorId = row.source_id;
      } else if (targetInFrontier && !sourceInFrontier) {
        candidateId = row.source_id;
        predecessorId = row.target_id;
      }
      if (!candidateId || visited.has(candidateId)) continue;
      visited.set(candidateId, { hopDepth: d, viaRelationshipRow: row, predecessor: predecessorId });
      nextFrontier.push(candidateId);
    }
    frontier = nextFrontier;
  }

  const candidateIds = [...visited.keys()].filter((id) => !seedIds.includes(id));

  const allRelRows = [...visited.values()]
    .map((v) => v.viaRelationshipRow)
    .filter((r): r is RelationshipRow => r !== null);
  const evidenceByRel = loadEvidenceForRelationships(
    db,
    allRelRows.map((r) => r.id),
    params.includeSnippets,
  );

  const entitiesById = new Map(
    getEntitiesByIds(db, [...seedIds, ...candidateIds]).map((e) => [e.id, e]),
  );

  // 경로 전체의 confidence 곱(ADR-0008과 같은 정의) — 마지막 hop의 confidence만 보면
  // 다중 hop 경로에 섞인 inferred 관계가 가려진다.
  function pathConfidence(candidateId: string): { confidence: number; hasInferredHop: boolean } {
    let confidence = 1;
    let hasInferredHop = false;
    let cur: string | null = candidateId;
    for (;;) {
      const info: VisitedInfo | undefined = cur ? visited.get(cur) : undefined;
      if (!info || !info.viaRelationshipRow) break;
      confidence *= info.viaRelationshipRow.confidence;
      if (info.viaRelationshipRow.resolution === 'inferred') hasInferredHop = true;
      cur = info.predecessor;
    }
    return { confidence, hasInferredHop };
  }

  const unsorted: ContextItem[] = candidateIds
    .map((id) => {
      const info = visited.get(id)!;
      const row = info.viaRelationshipRow!;
      const entity = entitiesById.get(id);
      if (!entity) return null;
      const { confidence, hasInferredHop } = pathConfidence(id);
      const sourceName = entitiesById.get(row.source_id)?.name ?? row.source_id;
      const targetName = entitiesById.get(row.target_id)?.name ?? row.target_id;
      const reasonBase = REASON_TEMPLATES[row.type as RelationshipType](sourceName, targetName);
      const reason = info.hopDepth > 1 ? `${reasonBase} (경로 ${info.hopDepth}단계)` : reasonBase;
      const item: ContextItem = {
        entity,
        relationshipType: row.type as RelationshipType,
        reason,
        confidence,
        hasInferredHop,
        hopDepth: info.hopDepth,
        evidence: evidenceByRel.get(row.id) ?? [],
      };
      return item;
    })
    .filter((item): item is ContextItem => item !== null);

  unsorted.sort((a, b) => {
    const prioDiff = TYPE_PRIORITY[b.relationshipType] - TYPE_PRIORITY[a.relationshipType];
    if (prioDiff !== 0) return prioDiff;
    if (a.hopDepth !== b.hopDepth) return a.hopDepth - b.hopDepth;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.entity.id.localeCompare(b.entity.id);
  });

  // 토큰 예산 pruning — 우선순위 순서대로 채우다 넘으면 멈춘다(더 작은 항목을 찾아 계속
  // 채우지 않는다 — 순서 유지가 "왜 잘렸는지" 설명 가능성에 더 중요하다는 의도적 선택).
  const items: ContextItem[] = [];
  let estimatedTokens = 0;
  let truncated = false;
  for (const item of unsorted) {
    const cost = estimateItemTokens(item);
    if (estimatedTokens + cost > params.tokenBudget) {
      truncated = true;
      break;
    }
    estimatedTokens += cost;
    items.push(item);
  }

  return { seeds, items, estimatedTokens, tokenBudget: params.tokenBudget, truncated };
}
