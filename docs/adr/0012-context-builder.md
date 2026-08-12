# ADR-0012: Graph-only Context Builder (BENCHMARK.md 5.6)

- **상태**: 채택, 구현 완료 (2026-08-12 — core/api/mcp 전 단계, IMPLEMENTATION_REPORT.md §20)
- **날짜**: 2026-08-12
- **근거 문서**: BENCHMARK.md 5.6, PRD.md FR-Q7·FR-AI1·FR-AI3, API.md 3장, ADR-0008(변경 영향 분석), claude-do.md
- **검토**: 초안을 `codex exec`(읽기 전용)로 독립 검토받아 결정 1·2를 실질적으로 다시 설계했다 — 아래 각주 참고.

## 배경

BENCHMARK.md 5.6은 MCP의 원시 조회 tool(`search_entities`/`get_entity`/`get_callers`/`get_callees`/`get_subgraph`) 위에 다음을 수행하는 "Context Builder"를 두자고 제안한다: 질문에서 seed Entity 추출, 관계 유형별 우선순위 적용, 경로 기반 확장, Evidence 중복 제거, 토큰 예산 기반 pruning, 선택한 Context의 이유 반환.

**지금 실제로 없는 것과 있는 것을 먼저 구분한다** — 5개 원시 MCP tool을 실제로 점검한 결과:

| 5.6이 요구하는 것 | 지금 상태 |
|---|---|
| seed Entity 추출 | `search_entities`가 이름 부분 일치로 이미 한다 |
| 경로 기반 확장 | `get_subgraph`가 노드 집합은 찾아준다(BFS, depth/방향/타입 필터) — 다만 seed까지의 실제 발견 경로(predecessor)는 보존하지 않는다(→ 결정 1에서 이유가 됨) |
| 관계 유형별 우선순위 적용 | **없음** — subgraph는 발견 순서로만 잘린다(`maxNodes`), 중요도로 정렬하지 않는다 |
| 선택한 Context의 이유 반환 | **없음** — subgraph는 노드/엣지만 줄 뿐 "왜 포함됐는지" 문장이 없다(ADR-0008의 `computeImpact`가 이미 만든 것과 같은 문제였다) |
| 토큰 예산 기반 pruning | **부분적** — `get_subgraph`의 `maxNodes`/`includeSnippets`는 노드 개수·스니펫 유무로만 자르지, 실제 텍스트 분량(토큰) 기준이 아니다 |
| Evidence 중복 제거 | 실질적으로 문제였던 적 없음(관계당 Evidence는 이미 유일) — 다만 같은 Entity가 여러 경로로 발견되면 어느 경로의 Evidence를 대표로 보여줄지는 정해진 바 없었다 |

**처음에는 seed 추출만 재사용하고 나머지는 기존 함수 위에 얇게 얹으면 될 것으로 가정했으나, 결정 1에서 그 가정이 깨졌다** — "경로 기반 확장"은 있지만 "그 경로 위에서 이유를 설명할 수 있는" 형태로는 없었다. 실제로 새로 만드는 것은 (1) 이 기능 전용 BFS(결정 1), (2) 우선순위 랭킹 + 이유 문장(결정 2), (3) 토큰 예산 기반 pruning(결정 3) 세 가지다. seed 추출(`searchEntities`)만 그대로 재사용한다.

## 결정 1 — seed 추출은 `searchEntities` 재사용, 경로 확장은 **전용 다중 소스 양방향 BFS**를 새로 둔다(`getSubgraph` 재사용 안 함)

seed 추출은 `searchEntities(name=query)`를 그대로 호출한다(질문 원문에서 검색어를 뽑는 것은 AI 클라이언트의 역할이지 서버의 역할이 아니다 — MCP tool을 호출하는 주체가 이미 자연어 질문을 이해하고 있으므로, "질문에서 seed 추출"은 여기서 "검색어로 Entity를 찾는다"로 구체화한다).

**초안은 경로 확장에 `getSubgraph(direction='both')`를 그대로 재사용하려 했으나, `codex exec` 독립 검토에서 실질적인 결함을 지적받아 폐기했다**: `getSubgraph`는 포함된 노드 집합 **사이의 모든 관계**를 돌려준다 — seed에서 후보까지 실제로 밟은 탐색 경로의 edge만이 아니다. 그 결과를 놓고 "후보와 맞닿은 가장 강한 관계"를 고르면, 그 관계가 seed와 무관한 우연한 교차 edge일 수 있다 — "왜 이 후보가 context에 포함됐는가"를 묻는데 "이 후보 주변에 어쩌다 있던 강한 관계는 무엇인가"를 답하는 셈이다. 이 기능의 핵심 가치가 "선택한 Context의 이유 반환"(BENCHMARK.md 5.6)인 이상 이유가 실제 발견 경로와 다를 수 있다는 건 받아들일 수 없는 결함이다. 부수적으로, `getSubgraph`가 자체 `maxNodes`로 먼저 잘라내면 그 절단이 `(depth, entity_id)` 순서로 일어나 우선순위 랭킹이 후보를 보기도 전에 중요한 후보가 사라질 수 있다는 지적도 있었다.

**그러므로**: `computeImpact`(ADR-0008)와 구조적으로 비슷하지만 **다중 소스(모든 seed가 동시에 depth 0) + 양방향**인 전용 BFS를 `context-builder.ts` 안에 새로 작성한다. `computeImpact` 자체는 건드리지 않는다(여전히 `direction=in` 전용으로 남는다 — ADR-0008 결정 4.1). `getSubgraph`도 그대로 둔다 — 이 기능이 쓰지 않을 뿐 기존 계약을 바꾸지 않는다.

```
frontier = seeds (hopDepth 0, predecessor 없음)
visited = { s.id: {hopDepth: 0, predecessor: null, viaRelationship: null} for s in seeds }
for d in 1..depth:
  다음 hop 후보 = relationship WHERE (source_id IN frontier OR target_id IN frontier)  -- both
  아직 방문 안 한 상대편 노드만 새로 방문 처리, 그 노드를 발견시킨 관계를 predecessor로 기록
  (같은 hop에서 여러 관계로 동시에 발견되면 confidence 높은 쪽을 predecessor로 남긴다)
  frontier = 새로 방문된 노드들
```

이렇게 하면 후보마다 "실제로 그 노드를 처음 발견시킨 관계"(`viaRelationship`)와 "가장 가까운 seed까지의 hop 수"(`hopDepth`)가 항상 진짜 발견 경로를 가리킨다 — 대표 관계가 더 이상 "우연히 강한 이웃 edge"가 아니라 "실제로 이 후보를 찾아낸 이유"가 된다. 내부적으로 넉넉한 방문 상한(예: 1000노드, `computeChangedImpact`의 `INTERNAL_PER_ENTITY_CANDIDATE_LIMIT`과 같은 패턴)까지 모은 뒤, 실제 절단은 아래 결정 2·3의 우선순위·예산 로직에서만 한다 — 탐색 단계의 우연한 절단이 랭킹 결과를 왜곡하지 않게 한다.

**재검토 조건**: `computeImpact`(단일 소스, in 전용, 경로 재구성) / `getSubgraph`(임의 소스, 임의 방향, 경로 없음) / 이 BFS(다중 소스, 양방향, predecessor 추적)까지 유사한 그래프 순회가 세 벌이 됐다. 네 번째 변형이 필요해지는 시점에는 공용 파라미터화된 BFS 유틸리티로 통합하는 것을 검토한다 — 지금은 이미 출시된 두 함수를 흔들 위험을 감수할 만큼 급하지 않다.

## 결정 2 — 우선순위: 관계 타입별 가중치 + 실제 발견 경로의 confidence

```
TYPE_PRIORITY = { CALLS: 4, IMPLEMENTS: 3, EXTENDS: 3, IMPORTS: 2, DECLARES: 1 }
```

`DECLARES`를 기본에서 제외하는 ADR-0008과 달리 여기서는 **기본 포함**한다 — impact 분석은 "누가 이 변경에 의존하는가"만 중요해 컨테이너-멤버 관계가 소음이지만, Context Builder는 "이 심볼이 어디 소속인지" 같은 구조적 맥락도 유용한 정보이기 때문이다. 다만 우선순위 최하위로 둬서, 예산이 빠듯하면 가장 먼저 잘린다.

정렬 기준: `viaRelationship.type`의 `TYPE_PRIORITY` 내림차순 → `hopDepth` 오름차순(가까운 seed일수록 우선) → `confidence` 내림차순 → 결정적 tie-break(entity id). **confidence는 결정 1의 BFS가 실제로 밟은 경로 위 각 hop의 confidence를 곱한 값**이다(ADR-0008의 `computeImpact`와 같은 정의) — 단일 edge의 confidence만 보면 다중 hop 경로에 섞인 inferred 관계가 가려진다는 지적을 반영했다.

각 후보의 Evidence는 `viaRelationship`(실제 발견 경로의 마지막 hop)의 Evidence를 그대로 쓴다 — 이게 "Evidence 중복 제거"의 실질적 의미다: 같은 Entity가 여러 경로로 발견돼도(다중 seed에서 동시에 도달 가능) 후보 목록에는 한 번만, 그 발견을 만든 진짜 근거 하나와 함께 나타난다.

**이유(reason) 문장**: ADR-0008의 `REASON_TEMPLATES`(관계 타입별 한국어 템플릿, 예: `"{source}가 {target}를 호출합니다"`)를 `viaRelationship`에 적용해 그대로 재사용한다(`packages/core/src/query/impact.ts`에서 export). 새 문장 생성 로직을 만들지 않는다. 2-hop 이상이면 ADR-0008과 같은 관례로 `"(경로 N단계)"`를 덧붙인다.

## 결정 3 — 토큰 예산: 문자 수 기반 근사치, 새 의존성 추가 안 함

실제 토크나이저(tiktoken 등) 의존성을 추가하지 않는다 — 이 프로젝트는 소스 코드를 외부로 보내지 않고 로컬에서 동작해야 하며(NFR-6), 정확한 토큰 계산이 이 기능의 핵심 가치가 아니다. 대신 널리 쓰이는 근사치를 그대로 채택한다:

```
estimateTokens(text) = Math.ceil(text.length / 4)
```

이 근사치는 "정확한 토큰 수"가 아니라 "예산을 넘지 않는 선에서 최대한 채운다"는 목적에 충분하다는 것을 문서화하고, 응답에 `estimatedTokens`로 실제 사용된 근사치를 그대로 노출해 호출자(AI 클라이언트)가 스스로 판단할 수 있게 한다. 한국어·식별자·JSON 구조가 많으면 이 근사치가 실제 토큰 수를 과소평가할 수 있다는 것도 명시한다 — "예산 이하를 보장"하는 정밀한 계약이 아니라 "대략 이 정도"라는 신호다.

**무엇을 셀지**: reason 문장이나 snippet 일부만이 아니라, 응답에 실제로 직렬화되는 후보 항목 전체(entity의 id/name/kind/filePath, relationshipType, reason, resolution, confidence, evidence의 filePath/snippet/위치)를 대상으로 센다 — 그래야 "예산 근처"라는 근사치가 실제 응답 크기와 크게 어긋나지 않는다.

**Pruning 절차**: 후보를 결정 2의 순서로 정렬한 뒤, 누적 `estimatedTokens`가 `tokenBudget`을 넘기 전까지 순서대로 채운다. 넘는 순간 중단하고(더 작은 항목을 찾아 계속 채우려 하지 않는다 — 우선순위 순서를 그대로 지키는 게 "왜 이게 잘렸는지" 설명 가능성을 유지하는 데 더 중요하다) `truncated: true`를 표시한다. **알려진 트레이드오프**: 우선순위가 가장 높은 항목 하나가 유독 크면(예: 긴 snippet) 그 뒤에 낮은 우선순위지만 작은 항목들이 예산에 여유가 있어도 전부 잘릴 수 있다 — "먼저 채우고 못 채우면 멈춘다"는 예측 가능성을 "최대한 채운다"는 효율성보다 우선한 의도적 선택이다.

## 결정 4 — HTTP API + MCP tool 둘 다, Web UI는 만들지 않는다

Shared Context 원칙(사람의 UI와 AI가 같은 데이터를 본다)에 따라 core 함수 하나를 HTTP API와 MCP tool 양쪽에서 공유한다(ADR-0008과 같은 패턴).

- `GET /projects/{id}/context?query=&tokenBudget=&maxSeeds=&depth=&types=&resolution=&includeSnippets=`
- MCP tool `build_context` — 5번째가 아니라 6번째 tool로 추가(기존 5개는 그대로 둔다).

**Web UI는 만들지 않는다.** 이 기능은 태생적으로 AI 클라이언트를 위한 것이다 — 사람이 브라우저에서 "토큰 예산 안에 눌러 담은 텍스트 뭉치"를 볼 필요는 낮다(사람에게는 이미 탐색/영향/검토 탭이 있다). 나중에 "AI가 실제로 어떤 context를 받았는지 디버깅하고 싶다"는 실제 요구가 확인되면 최소한의 미리보기 패널을 별도로 검토한다.

**신뢰 경계는 기존 5개 MCP tool과 동일하다, 새로 넓히지 않는다**: `build_context`도 `get_subgraph`처럼 Evidence 스니펫(소스 코드 일부)을 응답에 담을 수 있다. 이건 새로운 노출이 아니다 — 이미 `get_callers`/`get_callees`/`get_subgraph`가 같은 일을 하고, PRD NFR-6("로컬 또는 사용자 통제 환경")이 전제하는 것은 "MCP 클라이언트는 사용자가 직접 설정한 자신의 AI 에이전트"라는 것이다. `includeSnippets` 파라미터를 `get_subgraph`와 동일하게 노출해 호출자가 필요하면 스니펫을 뺄 수 있게 한다. "AI 클라이언트가 질문을 해석한다"는 결정 1의 표현은 서버가 소스를 임의의 외부 AI API로 보내도 된다는 뜻이 아니다 — MCP는 언제나 로컬 stdio이고, 그 반대편의 AI 에이전트가 무엇이든 이미 사용자가 신뢰하고 선택한 대상이라는 기존 전제를 그대로 따른다는 뜻이다.

## 하지 않는 것

- `computeImpact`(ADR-0008)와 `getSubgraph`의 시그니처나 알고리즘을 바꾸지 않는다 — 둘 다 그대로 두고, 다중 소스·양방향·predecessor 추적이 필요한 이 기능만을 위한 전용 BFS를 새로 둔다(결정 1).
- 실제 토크나이저 의존성을 추가하지 않는다 — 문자 수 기반 근사치로 충분하다고 명시한다.
- 자연어 질문을 서버가 직접 파싱(NLP/임베딩)하지 않는다 — claude-do.md의 Vector Search 금지와 직결되며, "질문 이해"는 이미 AI 클라이언트가 하고 있는 일이다. `query` 파라미터는 검색어 문자열로 취급한다.
- Web UI 화면을 만들지 않는다(위 결정 4).
- Phase 4의 Vector Search 결합은 다루지 않는다 — BENCHMARK.md 5.6 자신도 "Phase 1은 Graph-only"라고 명시했고, claude-do.md 금지사항과 직결된다.

## 구현 순서 (제안)

1. core: `packages/core/src/query/impact.ts`에서 `REASON_TEMPLATES` export. `packages/core/src/query/context-builder.ts` 신규 — 다중 소스·양방향 BFS + `buildContext()` + 단위 테스트(우선순위/hopDepth/confidence 정렬, 토큰 예산 pruning과 그 트레이드오프, seed 없음/빈 프로젝트, 여러 seed에서 동시에 도달 가능한 후보의 중복 제거, 순환 그래프 안전성).
2. api: `GET /projects/{id}/context` + 통합 테스트.
3. mcp: `build_context` tool 추가 + 통합 테스트, API.md 3장 갱신.
4. API.md/openapi.yaml/IMPLEMENTATION_REPORT.md 갱신, BENCHMARK.md 5.6을 [해결됨]으로 표시.
