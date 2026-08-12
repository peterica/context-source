# ContextSource Query API Spec

- **문서 버전**: 0.1 (Draft)
- **근거 문서**: [PRD.md](./PRD.md) 5.2/5.4장, OQ-3/OQ-4 결정, [DATA-MODEL.md](./DATA-MODEL.md)
- **기계 판독 가능 스펙**: [openapi.yaml](./openapi.yaml) — HTTP API(2장)를 OpenAPI 3.0으로 옮긴 것(BENCHMARK.md 5.18). 내용이 어긋나면 이 문서(API.md)가 우선한다. MCP tool(3장)은 HTTP가 아니므로 OpenAPI 스펙에 없다.

두 인터페이스를 제공하며 동일한 내부 Query 서비스를 공유한다 (OQ-3, OQ-4).

- **HTTP API**: Web UI 및 일반 클라이언트용. Base URL `http://localhost:9080/api/v1` (기본값, `PORT`/`API_PORT` 환경변수로 변경 가능 — README.md 참고)
- **MCP Server**: AI 에이전트용. HTTP API의 조회 기능을 MCP tool로 노출한다. **읽기 전용** — 분석 실행은 MCP로 노출하지 않는다.

---

## 1. 공통 규약

### 1.1 DTO

HTTP path의 `{id}`에는 Entity의 canonical `id`를 UTF-8 바이트로 변환한 뒤 padding 없는 Base64url(RFC 4648 URL-safe alphabet)로 인코딩한 `encodedId`를 사용한다. 응답 DTO와 query parameter, MCP tool에서는 원본 canonical `id`를 그대로 사용한다.

예:

```text
canonical id: p1/sym:src/payment/service.ts#PaymentService.charge
HTTP path:    /entities/{base64url(canonical id)}
```

서버는 잘못된 Base64url 또는 디코딩된 canonical ID 형식에 `400 INVALID_PARAM`을 반환한다.

```jsonc
// Entity
{
  "id": "p1/sym:src/payment/service.ts#PaymentService.charge",
  "projectId": "p1",
  "kind": "method",              // file | class | interface | function | method | external_module
  "name": "charge",
  "filePath": "src/payment/service.ts",   // external_module이면 null
  "range": { "startLine": 42, "endLine": 58 },  // external_module이면 null
  "revision": "abc1234"
}

// Relationship (Evidence 포함 — FR-Q6)
{
  "id": "r-7f3a",
  "type": "CALLS",               // DECLARES | IMPORTS | CALLS | IMPLEMENTS | EXTENDS
  "sourceId": "p1/sym:src/api/handler.ts#createOrder",
  "targetId": "p1/sym:src/payment/service.ts#PaymentService.charge",
  "resolution": "static",        // static | inferred
  "confidence": 1.0,
  "evidence": [
    {
      "filePath": "src/api/handler.ts",
      "range": { "startLine": 17, "startCol": 9, "endLine": 17, "endCol": 32 },
      "snippet": "paymentService.charge(order)",
      "analyzer": "ts-analyzer@0.1.0",
      "revision": "abc1234"
    }
  ]
}
```

### 1.2 에러

```jsonc
{ "error": { "code": "ENTITY_NOT_FOUND", "message": "..." } }
```

| HTTP | code | 상황 |
|------|------|------|
| 400 | `INVALID_PARAM` | 잘못된 kind/type/depth 등, 또는 workspace-root를 벗어나거나 존재하지 않는 프로젝트 경로 |
| 404 | `ENTITY_NOT_FOUND` | 존재하지 않는 Entity id (다른 프로젝트 소속인 경우도 포함) |
| 404 | `PROJECT_NOT_FOUND` | 존재하지 않는 프로젝트 id |
| 409 | `PROJECT_ALREADY_EXISTS` | 이미 존재하는 id로 프로젝트 등록 시도 |
| 404 | `RUN_NOT_FOUND` | 존재하지 않는 분석 실행 id |
| 409 | `ANALYSIS_IN_PROGRESS` | 분석 실행 중 새 분석 요청 |
| 401 | `UNAUTHORIZED` | API key가 설정된 서버에서 변경 오퍼레이션에 `x-api-key` 헤더가 없거나 틀림 (1.4) |

### 1.3 한도 (FR-AI3, NFR-4)

| 파라미터 | 기본값 | 최대 |
|----------|--------|------|
| `limit` (검색) | 50 | 200 |
| `depth` (서브그래프) | 2 | 5 |
| `maxNodes` (서브그래프) | 200 | 1000 |

한도 초과분은 잘라내고 응답에 `truncated: true`를 표시한다.

### 1.4 인증 — 옵트인 API key (ADR-0010)

서버 기동 시 `--api-key`(또는 환경변수 `CONTEXTSOURCE_API_KEY`)를 지정하지 않으면 이 절은 적용되지 않는다 — 기본값은 여전히 인증 없는 로컬 단일 사용자 실행이다(PRD NFR-6).

지정한 경우: `GET`/`HEAD`/`OPTIONS`가 아닌 모든 `/api/v1` 요청은 `x-api-key: <설정한 값>` 헤더가 정확히 일치해야 하며, 없거나 틀리면 `401 UNAUTHORIZED`를 반환한다. 조회(`GET`)는 API key 설정 여부와 무관하게 항상 열려 있다. `GET /health`는 `/api/v1` 밖에 있어 이 절과 무관하게 항상 열려 있다(Docker healthcheck용).

**Web UI는 이 키를 모른다.** 브라우저에 배포되는 정적 JS 번들에 넣는 값은 진짜 비밀이 될 수 없기 때문이다 — API key를 켜면 Web UI의 쓰기 동작(프로젝트 등록/삭제, 기술 스택 편집, 분석 실행)도 함께 401로 막힌다. 이 옵션은 "API 포트에 직접 접근할 수 있는 임의의 네트워크 클라이언트를 막는다"가 목적이며 "Web UI만 예외로 신뢰한다"가 아니다(자세한 이유는 ADR-0010 "하지 않는 것" 참고).

---

## 2. HTTP API

Phase 2(ADR-0004)부터 서버는 프로젝트 하나에 고정되지 않는다. 모든 그래프 조회/분석 실행 endpoint는
`/projects/{projectId}/...` 아래에 있다. `{projectId}`는 Entity id의 `projectId` 세그먼트와 같은 값이다.

### 2.0 프로젝트 등록/관리 — ADR-0004

```
GET /workspace
```

- 응답: `{ "root": "/abs/path/to/workspace" }` — 서버에 설정된 workspace-root의 실제 절대 경로. `POST /projects`의 `path`가 이 값 기준 상대 경로임을 Web UI가 등록 폼에서 보여주기 위한 읽기 전용 endpoint다(UX 감사 P1-1, 이전에는 이 값을 확인할 방법이 UI 어디에도 없었다).

```
GET /projects
```

- 응답: `{ "items": [ { "project": Project, "entityCount": N, "relationshipCount": N, "lastRun": AnalysisRun | null } ] }`
- 전체 그래프가 아니라 프로젝트별 집계만 준다 (Query-first).

```
POST /projects
body: { "name": "My Service", "path": "my-service", "tsconfigPath": "tsconfig.json", "id"?: "my-service", "description"?: "..." }
```

- `path`는 서버의 workspace-root(`--workspace-root`/`CONTEXTSOURCE_WORKSPACE_ROOT`) 기준 상대 경로다. workspace-root를 벗어나거나 존재하지 않으면 `400 INVALID_PARAM`.
- `tsconfigPath`는 `path`로 정해진 프로젝트 루트 기준 상대 경로다.
- `id`를 생략하면 `name`에서 kebab-case로 자동 생성한다(충돌 시 `-2`, `-3`... 접미사).
- 성공 시 `201`, 본문: `{ "project": Project }`. `Project`는 항상 절대 경로(`rootPath`, `tsconfigPath`)로 저장된다.

```
GET    /projects/{id}                 // { project, entityCount, relationshipCount, lastRun }
PATCH  /projects/{id}   body: { name?, tsconfigPath?, description? }
DELETE /projects/{id}                 // 204. entity/relationship/evidence는 CASCADE로 함께 삭제
```

### 2.1 Entity 검색 — FR-Q2

```
GET /projects/{id}/entities?name={partial}&kind={kind}&filePath={prefix}&limit=&offset=
```

- `name`: 부분 일치, 대소문자 무시. `kind`, `filePath`(접두 일치)와 AND 조합.
- 응답: `{ "items": [Entity], "total": 123 }`

### 2.2 Entity 상세 — FR-V2

```
GET /projects/{id}/entities/{encodedId}
```

- 응답: `{ "entity": Entity, "relationshipCounts": { "in": 12, "out": 5 } }`
- 목록이 아니라 개수만 준다. 관계 목록은 2.3으로 조회한다.

### 2.3 연결 관계 목록 — FR-V2, FR-Q5

```
GET /projects/{id}/entities/{encodedId}/relationships?direction=in|out|both&types=CALLS,IMPORTS&resolution=static|inferred&limit=&offset=
```

- 응답: `{ "items": [ { "relationship": Relationship, "counterpart": Entity } ], "total": 40 }`
- `counterpart`: direction 기준 반대편 Entity (in이면 source, out이면 target).

### 2.4 Caller / Callee — FR-Q3

```
GET /projects/{id}/entities/{encodedId}/callers    // 들어오는 CALLS
GET /projects/{id}/entities/{encodedId}/callees    // 나가는 CALLS
```

- 2.3의 `types=CALLS` 고정 단축 경로. 응답 형태는 2.3과 동일.

### 2.5 서브그래프 — FR-Q4, FR-Q5, FR-Q6

```
GET /projects/{id}/entities/{encodedId}/subgraph?direction=out|in|both&depth=2&types=&resolution=&maxNodes=200&includeSnippets=true
```

- 응답:

```jsonc
{
  "rootId": "p1/sym:...",
  "entities": [Entity],
  "relationships": [Relationship],   // 포함된 entities 사이의 관계만
  "truncated": false,
  "stats": { "entityCount": 34, "relationshipCount": 51, "maxDepthReached": 2 }
}
```

- **변경 영향 그래프(FR-V1) = `direction=in`** — 별도 endpoint를 두지 않는다. UI는 이 호출로 영향 그래프를 그린다.
- `includeSnippets=false`면 Evidence에서 `snippet`을 생략한다 (토큰/전송량 절감, FR-AI3).

### 2.6 분석 실행 — FR-A6, FR-A7, FR-A8

```
POST /projects/{id}/analysis/runs          body: { "mode": "full" | "incremental" }
```

- 202 응답: `{ "runId": "run-01" }`. 실행 중이면 409. `tsconfigPath`는 프로젝트 등록 시 저장된 값을 그대로 쓴다(요청에 포함하지 않음).
- incremental은 마지막 완료 run의 revision을 base로 git diff를 계산하고, 직전 run의 실패 파일을 변경 여부와 관계없이 재분석 대상에 합친다 (DATA-MODEL 3.2의 재분석 규칙).
- 파일 분석이 실패하면 해당 파일의 기존 graph data를 보존하고, `failures`에 `preservedRevision`을 포함한다.

```
GET /projects/{id}/analysis/runs/{runId}
GET /projects/{id}/analysis/runs?limit=
```

- 응답: `{ "id", "projectId", "mode", "status", "revision", "baseRevision", "startedAt", "finishedAt", "entityCount", "relationshipCount", "failures": [ { "filePath", "message", "preservedRevision" } ] }`

### 2.7 구현 확장 — Web UI 전용 집계/검토 endpoint (claude-do.md M4)

이 문서 초안에는 없었으나, M4 Web UI의 "Entity/Relationship/Evidence 통계"와 "분석 실패 및 inferred 관계 검토" 화면을 구현하기 위해 추가한 보조 endpoint다. 둘 다 읽기 전용이며 전체 그래프를 내려주지 않는다(Query-first, FR-AI1 원칙 유지) — 개수 집계이거나 페이지네이션된 목록이다.

```
GET /projects/{id}/stats
```

- 응답: `{ "entities": { "total", "byKind": {...} }, "relationships": { "total", "byType": {...}, "byResolution": {...} }, "evidence": { "total" }, "unresolvedReferences": { "total", "byKind": {...}, "byReason": {...} } }`
- `unresolvedReferences`는 ADR-0011 — 아래 `GET .../unresolved-references`가 다루는 사각지대의 집계다.

```
GET /projects/{id}/inferred-relationships?limit=&offset=
```

- `resolution=inferred`인 관계를 confidence 오름차순으로 페이지네이션하여 반환한다 (검토 우선순위).
- 응답: `{ "items": [ { "relationship": Relationship, "source": Entity, "target": Entity } ], "total": N }`
- `limit`/`offset` 한도는 1.3절과 동일(기본 50, 최대 200).

```
GET /projects/{id}/unresolved-references?limit=&offset=
```

- ADR-0011(BENCHMARK.md 5.5) — analyzer가 호출/import/상속을 발견했지만 대상 Entity를 확정하지 못한 경우를 페이지네이션하여 반환한다. **Relationship이 아니다** — target Entity가 없고, 어떤 그래프 순회(subgraph/impact 등)에도 나타나지 않는 별도의 진단 목록이다.
- 응답: `{ "items": [ { "reference": UnresolvedReference, "source": Entity } ], "total": N }`
- `UnresolvedReference`: `{ "id", "sourceId", "kind": "CALLS"|"IMPORTS"|"IMPLEMENTS"|"EXTENDS", "reason": "entity-not-extracted"|"ambiguous-callable-type"|"internal-path-not-in-project"|"unresolvable-specifier", "filePath", "range", "snippet", "analyzer", "revision" }` — Evidence와 같은 위치/스니펫 필드를 갖지만 `relationship_id`가 없다.
- 외부 패키지·TS ambient 선언(예: `console.log`)에 대한 실패는 기록하지 않는다 — OQ-11("외부 심볼에 대한 CALLS는 저장하지 않는다")과 같은 경계를 적용해, 실제 코드베이스에서 흔한 외부 API 호출이 신호를 소음에 묻히게 하지 않는다.
- `limit`/`offset` 한도는 1.3절과 동일(기본 50, 최대 200).

### 2.8 기술 스택 — ADR-0005 (Phase 2)

```
GET    /projects/{id}/tech-stack                          → { "items": [ { "category", "value" } ] }
POST   /projects/{id}/tech-stack   { category, value }     → 201, { "items": [...] } (idempotent 추가)
DELETE /projects/{id}/tech-stack   { category, value }     → 204 (idempotent 삭제, 없어도 204)
POST   /projects/{id}/tech-stack/detect                    → { "items": [...], "added": [...] }
```

- `category`는 `language | runtime | framework | orm | database | build_tool` 중 하나. 아니면 `400 INVALID_PARAM`.
- `value`는 1~50자 문자열.
- `detect`는 프로젝트의 `package.json`(`tsconfigPath` 디렉터리 우선, 없으면 `rootPath`)을 읽어 알려진 패키지를 매핑하고 기존 항목과 병합한다. `added`는 이번 호출로 새로 추가된 항목만 포함한다(이미 있던 항목은 제외).

### 2.9 유사 프로젝트 탐색 — ADR-0006 (Phase 2)

```
GET /projects/{id}/similar?limit=10
```

- 유사도 = 두 프로젝트의 기술 스택(`project_tech_stack`) 태그 **교집합 크기**. 임베딩/Vector Search가 아니며, Project를 그래프 노드나 저장된 관계로 만들지 않는 조회 시점 계산이다(claude-do.md의 "Vector Search 추가", "다중 Project 지식 그래프 확장" 금지사항을 지키기 위한 설계 — ADR-0006 참고).
- 응답: `{ "items": [ { "project": Project, "sharedTechStack": [TechStackEntry], "score": N } ] }`. `score` 내림차순, 동점이면 프로젝트 이름 오름차순. 공유 태그가 없는 프로젝트나 대상 프로젝트 자신은 제외한다.
- 대상 프로젝트에 등록된 기술 스택이 없으면 빈 목록을 반환한다.
- `limit`은 1~50, 기본 10.
- "기술 스택 기반 검색"은 별도 endpoint 없이 `GET /projects` 응답에 이미 포함된 `techStack`을 Web UI가 클라이언트에서 필터링한다(ADR-0006 §3).

### 2.10 변경 영향 분석 — ADR-0008 (Phase 2)

`GET /entities/{id}/subgraph?direction=in`(2.5)이 그래프만 줄 뿐 "가장 확실하고 가까운 후보가 뭔지", "왜 영향을 받는지"는 답하지 않는다는 갭(BENCHMARK.md 5.1~5.3)을 메운다. 새 Relationship Type이나 범용 Path Query 언어는 추가하지 않으며, 기존 5개 관계 타입 위에 후보 랭킹·이유·경로·신뢰도를 얹은 조회다(ADR-0008 결정 1·2·4).

```
GET /projects/{id}/entities/{encodedId}/impact?depth=3&types=&resolution=&maxCandidates=50
```

- 방향은 파라미터로 노출하지 않는다 — "impact"는 항상 `direction=in`("누가 나에게 의존하는가")을 뜻한다. 정방향이 필요하면 2.5의 `direction=out`을 쓴다.
- `depth` 기본 3, 최대 5. `types` 기본값은 `DECLARES`를 제외한 4종(`IMPORTS,CALLS,IMPLEMENTS,EXTENDS`) — 명시하면 덮어쓴다. `maxCandidates` 기본 50, 최대 200.
- 응답:

```jsonc
{
  "rootId": "p1/sym:src/payment/service.ts#PaymentService.charge",
  "candidates": [
    {
      "candidate": "p1/sym:src/api/handler.ts#createOrder",
      "reason": "createOrder가 charge를 호출합니다",       // 2-hop 이상이면 " (경로 N단계)" 접미
      "confidence": 1.0,        // 경로 위 각 관계의 confidence를 곱한 값(새 필드를 만들지 않음)
      "hasInferredHop": false,  // 경로 중 하나라도 inferred면 true
      "path": [ { "sourceId", "targetId", "type", "resolution", "confidence", "evidence": [Evidence] } ]  // 후보 → root 순, 기존 Relationship DTO 필드 재사용
    }
  ],
  "truncated": false,
  "stats": { "candidateCount": 1, "maxDepthReached": 1 }
}
```

- 정렬(랭킹): `confidence` 내림차순 → 경로 길이(hop 수) 오름차순 → `candidate` id 오름차순(결정적). `maxCandidates`로 자르기 전에 정렬한다.

```
GET /projects/{id}/analysis/runs/{runId}/changed-impact?depth=3&types=&resolution=&maxCandidates=100
```

- 해당 run의 `baseRevision`~`revision` 사이 git diff를 **조회 시점에 재계산**한다(저장하지 않음 — Query-first, 2.6의 incremental이 이미 쓰는 `diffNameStatus`/`resolveGitRoot` 재사용). `baseRevision`이 `null`인 run(최초 전체 분석)은 비교 대상이 없으므로 `400 INVALID_PARAM`.
- 변경된 각 파일이 선언한 Entity(파일 자체는 제외)를 "변경된 Entity"로 삼아 각각 위 impact를 계산하고, 후보를 합쳐 중복 제거한다(같은 후보가 여러 변경 Entity에서 도달되면 confidence가 더 높은 쪽, 동률이면 경로가 더 짧은 쪽이 남는다).
- 응답은 위 `candidates` 배열에 세 필드를 더한 것 — 새 DTO를 만들지 않는다:
  - `changedEntityId` — 이 후보가 어느 변경된 Entity 때문에 발견됐는지.
  - `isDirectImpact` — 변경된 Entity를 한 hop(depth 1)으로 바로 참조하는가.
  - `isLikelyTestFile` — 후보의 `filePath`가 `*.test.ts`/`*.spec.ts` 패턴이거나 `test/`·`tests/`·`__tests__/` 아래에 있는지의 **경로 패턴 휴리스틱**이다. 구조적 관계(`TESTS` Relationship Type)가 아니므로 100% 정확하지 않다(ADR-0008 결정 4.2) — 새 Relationship Type을 만들지 않기로 한 결정 1과 일관되게, 필드 이름도 단정적으로 짓지 않았다.
- 응답 최상위에 `runId`, `changedEntities`(변경된 Entity id 목록)를 포함한다.

Web UI는 이 두 endpoint를 "변경 영향" 탭에서 쓴다 — 최신 완료 run을 기본으로, `isDirectImpact`(직접 영향) → 나머지(간접 영향) → `isLikelyTestFile`(관련 테스트로 보이는 파일) 순서로 그룹핑해 보여준다(ADR-0008 결정 5, BENCHMARK.md 5.3의 검토 순서). MCP tool로는 아직 노출하지 않는다(ADR-0008 "하지 않는 것").

---

## 3. MCP Tools — FR-Q7, FR-AI1, FR-AI3

모든 tool은 읽기 전용이며 HTTP API와 동일한 Query 서비스를 사용한다 (Shared Context 원칙 — 사람의 UI와 AI가 같은 데이터를 본다).

MCP 서버 프로세스는 (HTTP API와 달리) 여전히 프로젝트 하나에 고정된다 — 기동 시 `--project-id`로 지정한다(ADR-0004 §3). 여러 프로젝트를 다루려면 AI 클라이언트 설정에 프로젝트별로 별도 MCP 서버 항목을 등록한다. 그래서 아래 tool 파라미터에는 `project_id`가 없다.

| Tool | 파라미터 | 대응 HTTP | 용도 |
|------|----------|-----------|------|
| `search_entities` | `name?`, `kind?`, `filePath?`, `limit?` | 2.1 | Entity 탐색 진입점 |
| `get_entity` | `id` | 2.2 | Entity 상세와 관계 개수 |
| `get_callers` / `get_callees` | `id`, `limit?` | 2.4 | 호출 관계 (Evidence 포함) |
| `get_subgraph` | `id`, `direction?`, `depth?`, `types?`, `maxNodes?`, `includeSnippets?` | 2.5 | 영향 분석·구조 설명용 서브그래프 |

- 응답 JSON은 HTTP API와 동일한 DTO를 사용한다. Evidence가 항상 포함되므로 AI는 답변에 코드 위치를 인용할 수 있다 (FR-AI2).
- `maxNodes`와 `includeSnippets=false`가 토큰 예산 제어 수단이다 (FR-AI3). 전체 그래프 덤프 tool은 의도적으로 제공하지 않는다 (FR-AI1, Query-first).

---

## 4. FR 추적표

| FR | 대응 |
|----|------|
| FR-Q1 | DATA-MODEL.md (entity/relationship 테이블) |
| FR-Q2 | 2.1 `GET /entities`, `search_entities` |
| FR-Q3 | 2.4 callers/callees, `get_callers`/`get_callees` |
| FR-Q4 | 2.5 subgraph (direction/depth) |
| FR-Q5 | 2.3/2.5의 `types`, `resolution` 필터 |
| FR-Q6 | Relationship DTO에 evidence 항상 포함 |
| FR-Q7 | 3장 MCP tools |
| FR-V1 | 2.5 `direction=in` |
| FR-V2 | 2.2 + 2.3 |
| FR-V3 | Relationship DTO의 evidence |
| FR-V4 | 2.5 `depth`, `types` |
| FR-V5 | Relationship DTO의 `resolution` 필드 (표시 구분은 UI 책임) |
| FR-V6 | 서브그래프 endpoint만 제공, 전체 덤프 없음 |
| FR-AI1 | 3장 — 서브그래프 tool만 노출 |
| FR-AI2 | evidence 포함 DTO |
| FR-AI3 | `maxNodes`, `includeSnippets`, `truncated` |
| FR-A6/A7/A8 | 2.6 분석 실행 API |
