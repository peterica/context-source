import type { Db } from '../storage/db.js';
import type { Evidence, RelationshipType, Resolution } from '../types.js';
import { loadEvidenceForRelationships } from './relationship-queries.js';
import { getEntitiesByIds } from './entity-queries.js';
import type { RelationshipRow } from '../storage/mappers.js';

/**
 * ADR-0008 — 변경 영향 분석. `getSubgraph`(direction=in)와 같은 그래프를 순회하지만,
 * "얼마나 많은 노드가 있는가"가 아니라 "가장 확실하고 가까운 후보부터 랭킹"이 목적이라
 * 후보별 대표 경로(root까지 최초로 도달한 경로 하나)를 추적하는 애플리케이션 레벨 BFS를 쓴다.
 * SQL recursive CTE의 `MIN(depth) GROUP BY entity_id`는 노드만 모으고 "어느 edge로 처음
 * 도달했는지"를 버리기 때문이다(findReverseImporters의 전이적 폐포 구현과 같은 이유로 같은
 * 패턴을 재사용한다, 커밋 fd1e207 참고).
 */

// DECLARES는 기본에서 제외한다 — 컨테이너→멤버는 "누가 이 변경에 의존하는가"가 아니라
// "이게 어디 소속인가"라 impact 의미와 맞지 않는다. types 파라미터로 명시하면 포함할 수 있다.
const DEFAULT_IMPACT_TYPES: RelationshipType[] = ['IMPORTS', 'CALLS', 'IMPLEMENTS', 'EXTENDS'];

const REASON_TEMPLATES: Record<RelationshipType, (source: string, target: string) => string> = {
  CALLS: (s, t) => `${s}가 ${t}를 호출합니다`,
  IMPORTS: (s, t) => `${s}가 ${t}를 import합니다`,
  IMPLEMENTS: (s, t) => `${s}가 ${t}를 구현합니다`,
  EXTENDS: (s, t) => `${s}가 ${t}를 상속합니다`,
  DECLARES: (s, t) => `${s}가 ${t}를 선언합니다`,
};

export interface ImpactParams {
  rootId: string;
  depth: number;
  types?: RelationshipType[];
  resolution?: Resolution;
  maxCandidates: number;
}

export interface ImpactPathStep {
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  resolution: Resolution;
  confidence: number;
  evidence: Evidence[];
}

export interface ImpactCandidate {
  candidate: string;
  reason: string;
  confidence: number;
  hasInferredHop: boolean;
  path: ImpactPathStep[];
}

export interface ImpactResult {
  rootId: string;
  candidates: ImpactCandidate[];
  truncated: boolean;
  stats: { candidateCount: number; maxDepthReached: number };
}

interface VisitedInfo {
  /** root 방향으로 한 칸 더 가까운 노드 id. root 자신이면 null. */
  predecessor: string | null;
  /** 이 노드 → predecessor로 가는 관계 원본 row. root 자신이면 null. */
  viaRelationshipRow: RelationshipRow | null;
  hopDepth: number;
}

export function computeImpact(db: Db, params: ImpactParams): ImpactResult {
  const types = params.types && params.types.length > 0 ? params.types : DEFAULT_IMPACT_TYPES;

  const visited = new Map<string, VisitedInfo>();
  visited.set(params.rootId, { predecessor: null, viaRelationshipRow: null, hopDepth: 0 });
  let frontier = [params.rootId];
  let maxDepthReached = 0;

  for (let d = 1; d <= params.depth; d++) {
    if (frontier.length === 0) break;

    const conditions = [
      'target_id IN (SELECT value FROM json_each(:frontier))',
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

    // confidence 내림차순으로 먼저 처리해, 같은 hop에서 한 후보가 여러 edge로 동시에
    // 발견되면 가장 확실한 edge를 대표 경로로 남긴다(첫 기록만 유지, 이후는 skip).
    const rows = db
      .prepare(
        `SELECT id, type, source_id, target_id, resolution, confidence, primary_evidence_id
         FROM relationship WHERE ${conditions.join(' AND ')}
         ORDER BY confidence DESC, id ASC`,
      )
      .all(bind) as unknown as RelationshipRow[];

    const nextFrontier: string[] = [];
    for (const row of rows) {
      if (visited.has(row.source_id)) continue; // 이미 도달함(더 짧거나 동일 depth 경로, 또는 순환)
      visited.set(row.source_id, { predecessor: row.target_id, viaRelationshipRow: row, hopDepth: d });
      nextFrontier.push(row.source_id);
    }
    if (nextFrontier.length > 0) maxDepthReached = d;
    frontier = nextFrontier;
  }

  const candidateIds = [...visited.keys()].filter((id) => id !== params.rootId);

  const allRelRows = [...visited.values()]
    .map((v) => v.viaRelationshipRow)
    .filter((r): r is RelationshipRow => r !== null);
  const evidenceByRel = loadEvidenceForRelationships(
    db,
    allRelRows.map((r) => r.id),
    true,
  );

  function buildPath(candidateId: string): ImpactPathStep[] {
    const steps: ImpactPathStep[] = [];
    let cur = candidateId;
    for (;;) {
      const info = visited.get(cur);
      if (!info || !info.viaRelationshipRow) break;
      const row = info.viaRelationshipRow;
      steps.push({
        sourceId: row.source_id,
        targetId: row.target_id,
        type: row.type as RelationshipType,
        resolution: row.resolution as Resolution,
        confidence: row.confidence,
        evidence: evidenceByRel.get(row.id) ?? [],
      });
      cur = info.predecessor!;
    }
    return steps;
  }

  const entitiesById = new Map(
    getEntitiesByIds(db, [params.rootId, ...candidateIds]).map((e) => [e.id, e]),
  );

  const unsorted: ImpactCandidate[] = candidateIds.map((id) => {
    const path = buildPath(id);
    const confidence = path.reduce((acc, step) => acc * step.confidence, 1);
    const hasInferredHop = path.some((step) => step.resolution === 'inferred');
    const firstHop = path[0]!; // 후보 자신이 source인 첫 hop — 후보에 가장 가까운 관계
    const sourceName = entitiesById.get(firstHop.sourceId)?.name ?? firstHop.sourceId;
    const targetName = entitiesById.get(firstHop.targetId)?.name ?? firstHop.targetId;
    const reasonBase = REASON_TEMPLATES[firstHop.type](sourceName, targetName);
    const reason = path.length > 1 ? `${reasonBase} (경로 ${path.length}단계)` : reasonBase;
    return { candidate: id, reason, confidence, hasInferredHop, path };
  });

  unsorted.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.candidate.localeCompare(b.candidate);
  });

  const truncated = unsorted.length > params.maxCandidates;
  const candidates = unsorted.slice(0, params.maxCandidates);

  return {
    rootId: params.rootId,
    candidates,
    truncated,
    stats: { candidateCount: candidates.length, maxDepthReached },
  };
}
