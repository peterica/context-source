# ADR-0008: 변경 영향 분석 (Impact Analysis)

- **상태**: 제안 (구현 전, 사용자 확인 대기)
- **날짜**: 2026-08-12
- **근거 문서**: PRD.md 목표 #4·FR-Q4·FR-V1, BENCHMARK.md 5.1~5.3, DATA-MODEL.md, API.md 2.5, claude-do.md

## 배경

PRD 목표 #4("선택한 Entity의 변경 영향 범위를 그래프로 시각화한다")는 현재 `GET /entities/{id}/subgraph?direction=in`으로 충족된 것으로 간주됐다(API.md 2.5: "변경 영향 그래프(FR-V1) = `direction=in`"). 하지만 이건 **그래프**를 줄 뿐, "왜 영향을 받는지", "가장 직접적인 후보가 뭔지", "이 관계가 얼마나 확실한지"는 사용자가 그래프를 직접 읽어야 알 수 있다.

BENCHMARK.md 5.1~5.3(경쟁 벤치마킹 최초 분석, 2026-08-04)이 지적한 갭이 바로 이것이다 — CodeQL의 "경로 전체를 설명하는 Evidence UX", Sourcegraph의 "결과 생성 방식 구분"과 비교하면, ContextSource는 그래프는 있지만 **후보를 랭킹하고 이유를 설명하는 계층**이 없다.

이 ADR은 5.1~5.3을 하나의 기능으로 설계한다: **`GET /entities/{id}/impact`** — 서브그래프 순회 위에 랭킹·이유·경로·신뢰도를 얹은 조회, 그리고 이를 Git diff와 연결하는 Web UI 진입점.

## 결정 1 — 범위: 새 Relationship Type을 추가하지 않는다

BENCHMARK.md 5.1은 `REFERENCES`, `TYPE_USES`, `INSTANTIATES`, `OVERRIDES`, `EXPORTS`/`REEXPORTS`, `TESTS` 6종의 새 관계 타입을 "후속 우선순위"로 제안한다. **이번 설계에서는 전부 미룬다.**

이유:
- 각 타입은 ADR-0002 수준의 독립적인 추출 규칙 설계·구현·골든 fixture가 필요한 별도 작업이다 — 6개를 한 번에 묶으면 "임팩트 분석"이라는 하나의 기능이 사실상 "Analyzer 재작업"이 되어 범위가 통제 불가능해진다.
- 기존 5개 타입(`DECLARES`/`IMPORTS`/`CALLS`/`IMPLEMENTS`/`EXTENDS`)만으로도 "후보 랭킹 + 이유 + 경로 + 신뢰도 + Evidence"라는 **구조**는 완전히 만들 수 있다 — 부족한 건 recall(더 많은 관계를 발견하는 것)이지 이 기능의 아키텍처가 아니다.
- PRD/DATA-MODEL은 여전히 5개 타입만 정의한다(claude-do.md의 "PRD에 없는 기능 추가 금지" 원칙과 직결) — 새 타입 추가는 PRD/DATA-MODEL 자체를 개정하는 별도 결정이어야 하며, 이 ADR이 몰래 끼워 넣을 일이 아니다.

**재검토 조건**: 이 기능을 실제로 써본 뒤 "CALLS/IMPORTS/IMPLEMENTS/EXTENDS로 못 잡는 영향이 너무 많다"는 게 확인되면, 그때 개별 관계 타입을 하나씩(우선순위: `REFERENCES` → `TYPE_USES`) ADR로 추가한다.

## 결정 2 — 의미: "구조적 영향 후보", 단정적 예측 아님

BENCHMARK.md 5.1의 정의를 그대로 채택한다. 응답은 "이 Entity가 깨진다"가 아니라 "이 Entity는 변경된 Entity에 구조적으로 의존하고 있으니 검토 대상이다"를 말한다. 모든 후보는 후보로 이어지는 **관계 경로**와 **Evidence**를 근거로 갖는다 — Evidence 없는 관계를 저장하지 않는 PRD 4.2 원칙의 조회 계층 버전이다.

## 결정 3 — 알고리즘: 기존 서브그래프 순회 + 경로 재구성 + 신뢰도 곱

새 순회 로직을 만들지 않는다. `getSubgraph`(`packages/core/src/query/subgraph.ts`)의 `direction=in` recursive CTE와 동일한 그래프를 쓰되, **후보별로 root까지의 대표 경로 하나**를 재구성해야 하므로 애플리케이션 레벨에서 BFS를 직접 수행한다(SQL recursive CTE는 `MIN(depth) GROUP BY entity_id`로 노드만 모으고 "어느 edge로 처음 도달했는지"는 버리기 때문 — 이미 `findReverseImporters`의 전이적 폐포도 같은 이유로 애플리케이션 레벨 반복문을 쓴다, ADR 없음이지만 fd1e207 참고).

```
function computeImpact(db, rootId, { depth, types, resolution, maxCandidates }):
  visited = { rootId: { predecessor: null, viaRelationship: null, hopDepth: 0 } }
  frontier = [rootId]
  for d in 1..depth:
    if frontier empty: break
    nextFrontier = []
    for nodeId in frontier (정렬된 순서로 — 결정적 재분석을 위해):
      for (rel, neighborId) in incomingRelationships(nodeId, types, resolution):  # direction=in
        if neighborId not in visited:
          visited[neighborId] = { predecessor: nodeId, viaRelationship: rel, hopDepth: d }
          nextFrontier.push(neighborId)
    frontier = nextFrontier
  candidates = visited.keys() - { rootId }
  truncated = candidates.length > maxCandidates
  candidates = candidates.slice(0, maxCandidates)  # 정렬 후 자르기 (아래 랭킹 참고)
  for each candidate: reconstruct path by following predecessor pointers back to root
```

**정렬 기준 (랭킹)**: `confidence` 내림차순 → `hopDepth` 오름차순 → `candidate id` 오름차순(결정적). `maxNodes`가 아니라 `maxCandidates`로 자르되, **자르기 전에 정렬**한다 — subgraph처럼 "먼저 발견된 순서대로 자르기"가 아니라 "가장 확실하고 가까운 후보부터 보여주기"가 이 기능의 핵심이므로.

**신뢰도(confidence)**: 새 필드를 만들지 않고 경로 위 각 관계의 기존 `confidence` 값(ADR-0002가 이미 static=1.0, inferred=0.8/0.6으로 정의)을 **곱**한다. 3-hop 경로에 inferred 관계가 하나 섞이면 confidence가 0.8배로 줄어드는 식 — "가장 약한 연결이 전체 신뢰도를 깎는다"는 직관을 그대로 반영하고, 새로운 추정 규칙을 발명하지 않는다.

**이유(reason) 생성**: 후보에서 root 방향으로 첫 번째 hop(후보 자신이 소스인 관계)을 아래 템플릿으로 문장화한다. 관계 타입별 한국어 템플릿:

| type | 템플릿 |
|------|--------|
| CALLS | `{source}가 {target}를 호출합니다` |
| IMPORTS | `{source}가 {target}를 import합니다` |
| IMPLEMENTS | `{source}가 {target}를 구현합니다` |
| EXTENDS | `{source}가 {target}를 상속합니다` |
| DECLARES | `{source}가 {target}를 선언합니다` (기본적으로 impact 순회에서 제외되지만 `types` 파라미터로 켤 수 있으므로 템플릿은 준비) |

2-hop 이상이면 문장 뒤에 `(경로 {N}단계)`를 붙인다 — 전체 경로는 `path` 필드에 구조화된 형태로 항상 함께 준다(문장만으로 다 설명하려 하지 않는다).

**기본적으로 제외하는 관계 타입**: `DECLARES`는 기본 `types` 필터에서 제외한다(컨테이너→멤버 관계는 "누가 이 변경에 의존하는가"가 아니라 "이게 어디 소속인가"이므로 impact 의미와 맞지 않음). `types` 파라미터로 명시하면 포함할 수 있다 — 기존 subgraph 엔드포인트의 필터 관례를 그대로 따른다.

## 결정 4 — API 형태

BENCHMARK.md 5.2가 제안한 3개 endpoint 중 하나(`GET /paths?from=&to=`)는 채택하지 않는다 — PRD.md OQ-3의 기존 결정("실제 사용자가 고정 오퍼레이션으로 못 푸는 질문을 반복 제기하기 전까지 범용 Query 언어를 추가하지 않는다", 2026-08-11 갱신)과 정면으로 배치된다. 나머지 둘은 이름을 다듬어 채택한다.

### 4.1 `GET /projects/{id}/entities/{encodedId}/impact`

```
GET /projects/{id}/entities/{encodedId}/impact?depth=3&types=&resolution=&maxCandidates=50
```

- `depth` 기본 3, 최대 5(subgraph와 동일 한도, API.md 1.3).
- `types` 기본값은 `DECLARES`를 제외한 4종(`IMPORTS,CALLS,IMPLEMENTS,EXTENDS`). 명시하면 덮어쓴다.
- `maxCandidates` 기본 50, 최대 200(검색 엔드포인트의 `limit`과 동일 한도 재사용).
- 방향은 파라미터로 노출하지 않는다 — "impact"라는 이름 자체가 `direction=in`(역방향, "누가 나에게 의존하는가")을 의미하도록 고정한다. 정방향("나는 무엇에 의존하는가")이 필요하면 기존 `/subgraph?direction=out`을 그대로 쓰면 된다 — 새 파라미터로 의미를 흐리지 않는다.

응답:

```jsonc
{
  "rootId": "p1/sym:src/payment/service.ts#PaymentService.charge",
  "candidates": [
    {
      "candidate": "p1/sym:src/api/handler.ts#createOrder",
      "reason": "createOrder가 charge를 호출합니다",
      "confidence": 1.0,
      "hasInferredHop": false,
      "path": [
        {
          "sourceId": "p1/sym:src/api/handler.ts#createOrder",
          "targetId": "p1/sym:src/payment/service.ts#PaymentService.charge",
          "type": "CALLS",
          "resolution": "static",
          "confidence": 1.0,
          "evidence": [ /* Evidence.md 1.1과 동일한 Evidence[] */ ]
        }
      ]
    }
  ],
  "truncated": false,
  "stats": { "candidateCount": 1, "maxDepthReached": 1 }
}
```

- `path`는 후보 → root 순서로, 각 원소는 기존 Relationship DTO와 같은 필드(Evidence 포함)를 쓴다 — 새 DTO 형태를 만들지 않고 기존 것을 재사용한다.
- `truncated`/`stats`는 기존 subgraph 응답 관례를 그대로 따른다(API.md 1.3의 한도 초과 표시 방식과 일관).

### 4.2 `GET /projects/{id}/analysis/runs/{runId}/changed-impact`

BENCHMARK.md 5.2의 `changed-subgraph`를 "raw graph가 아니라 랭킹된 impact"로 바꿔 이름도 바꾼다 — 이 문서 전체의 방향(그래프 대신 후보 랭킹)과 이름을 맞춘다.

```
GET /projects/{id}/analysis/runs/{runId}/changed-impact?depth=3&maxCandidates=100
```

- 해당 run의 `revision`/`baseRevision`으로 git diff를 **다시 계산**한다(저장하지 않고 조회 시점에 재계산 — Query-first, 이미 있는 `diffNameStatus`/`resolveGitRoot`를 그대로 재사용). `baseRevision`이 `null`이면(최초 full scan) `400 INVALID_PARAM` — 비교 대상이 없다.
- 변경된 각 파일에 대해 `entity.file_path = ?`인 Entity(파일 자체는 제외)를 "직접 변경된 Entity"로 삼는다.
- 직접 변경된 Entity 각각에 대해 4.1의 impact 계산을 수행하고, 후보를 합쳐 중복 제거한다(같은 후보가 여러 변경 Entity에서 도달되면 가장 짧은 경로/가장 높은 confidence를 남긴다).
- 각 후보에 `changedEntityId`(어느 변경 Entity 때문에 후보가 됐는지)와 `isDirectImpact`(hopDepth === 1)를 추가로 표시한다 — BENCHMARK 5.3의 "직접 영향 후보 → 간접 영향 후보" 구분을 이 두 필드로 표현한다.
- **"관련 테스트"(BENCHMARK 5.3)**: 새 `TESTS` 관계 타입 없이(결정 1), 후보의 `filePath`가 `\.(test|spec)\.tsx?$` 패턴이거나 `test/`·`__tests__/`·`tests/` 디렉터리 아래면 `isLikelyTestFile: true`로 표시하는 휴리스틱만 적용한다 — 구조적 관계가 아니라 경로 패턴 기반 힌트임을 필드 이름에 명시(`isLikelyTestFile`, `isTestFile`처럼 단정적으로 이름 짓지 않음).

응답 형태는 4.1의 `candidates` 배열에 `changedEntityId`/`isDirectImpact`/`isLikelyTestFile`을 얹은 것 — 새 DTO를 만들지 않는다.

```jsonc
{
  "runId": "run-01",
  "changedEntities": ["p1/sym:src/payment/service.ts#PaymentService.charge"],
  "candidates": [
    {
      "candidate": "...",
      "changedEntityId": "p1/sym:src/payment/service.ts#PaymentService.charge",
      "isDirectImpact": true,
      "isLikelyTestFile": false,
      "reason": "...", "confidence": 1.0, "hasInferredHop": false, "path": [...]
    }
  ],
  "truncated": false,
  "stats": { "changedEntityCount": 1, "candidateCount": 12 }
}
```

## 결정 5 — Web UI: Git diff를 진입점으로 삼는 새 화면

BENCHMARK.md 5.3의 흐름(변경된 Entity → 직접 영향 후보 → 간접 영향 후보 → 관련 테스트 → Evidence 기반 검토 순서)을 그대로 화면 구조로 옮긴다.

- 기존 탭(Overview/탐색/검토/분석 이력)에 **"변경 영향"** 탭을 추가한다. 라우팅은 기존 `router.ts` 패턴을 따라 `/projects/:id/impact`.
- 최신 완료 run을 기본으로 보여주되(`GET /projects/{id}/analysis/runs?limit=1`로 조회), 분석 이력 탭에서 과거 run을 선택해 들어올 수도 있게 한다(그 run의 `changed-impact`를 조회).
- 목록은 `isDirectImpact` 그룹(직접 영향) → 나머지(간접 영향) → `isLikelyTestFile`인 항목은 별도 소제목("관련 테스트로 보이는 파일")으로 묶어 보여준다 — BENCHMARK가 요구한 검토 순서.
- 각 후보 클릭 시 기존 탐색 탭의 Entity 상세로 이동(기존 `onSelectEntity`/`goToEntity` 패턴 재사용)하거나, 목록 안에서 `path`를 펼쳐 Evidence를 바로 보여주는 인라인 확장(RunHistory의 실패 목록 펼치기 UX와 동일한 패턴 재사용).
- `reason`/`confidence`/`hasInferredHop`은 이미 존재하는 `RESOLUTION_TOOLTIP`(glossary.ts) 스타일의 짧은 설명과 함께 배지로 표시한다 — P1-3에서 만든 툴팁 패턴 재사용.

## 하지 않는 것

- 새 Relationship Type 추가(`REFERENCES` 등) — 결정 1.
- 범용 Path Query 언어(`GET /paths?from=&to=`) — 결정 4, OQ-3 기존 결정과 일관.
- "이게 실제로 깨진다"는 단정적 예측이나 자동 수정 제안 — PRD 비목표(2.2, 코드 자동 수정은 범위 밖).
- `TESTS` 관계 타입 기반의 정확한 테스트 매핑 — 경로 패턴 휴리스틱으로 대체(결정 4.2).
- MCP tool 노출 — 이 ADR은 HTTP API/Web UI까지만 다룬다. `get_impact` MCP tool 추가 여부는 이 기능이 Web UI에서 검증된 뒤 별도로 판단한다(API.md 3장 확장은 후속 작업).

## 구현 순서 (제안)

1. core: `computeImpact()` 쿼리 함수 + 골든 스타일 단위 테스트(단일 hop, 다중 hop, inferred 섞인 경로의 confidence 곱셈, maxCandidates 절단, 순환 그래프에서 무한루프 없음).
2. api: `GET /entities/{encodedId}/impact` — core 함수를 감싸는 라우트 + 통합 테스트.
3. api: `GET /analysis/runs/{runId}/changed-impact` — git diff 재계산 + 여러 변경 Entity의 impact 병합 + 통합 테스트.
4. web: "변경 영향" 탭 — 직접/간접/테스트 그룹핑 UI, Playwright로 실제 브라우저 검증.
5. API.md/DATA-MODEL.md(변경 없음, 새 테이블 없음)/README.md 문서 갱신, BENCHMARK.md 5.1~5.3을 [해결됨]으로 표시.
