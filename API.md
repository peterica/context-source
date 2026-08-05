# ContextSource Query API Spec

- **문서 버전**: 0.1 (Draft)
- **근거 문서**: [PRD.md](./PRD.md) 5.2/5.4장, OQ-3/OQ-4 결정, [DATA-MODEL.md](./DATA-MODEL.md)

두 인터페이스를 제공하며 동일한 내부 Query 서비스를 공유한다 (OQ-3, OQ-4).

- **HTTP API**: Web UI 및 일반 클라이언트용. Base URL `http://localhost:8080/api/v1`
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
| 400 | `INVALID_PARAM` | 잘못된 kind/type/depth 등 |
| 404 | `ENTITY_NOT_FOUND` | 존재하지 않는 Entity id |
| 404 | `RUN_NOT_FOUND` | 존재하지 않는 분석 실행 id |
| 409 | `ANALYSIS_IN_PROGRESS` | 분석 실행 중 새 분석 요청 |

### 1.3 한도 (FR-AI3, NFR-4)

| 파라미터 | 기본값 | 최대 |
|----------|--------|------|
| `limit` (검색) | 50 | 200 |
| `depth` (서브그래프) | 2 | 5 |
| `maxNodes` (서브그래프) | 200 | 1000 |

한도 초과분은 잘라내고 응답에 `truncated: true`를 표시한다.

---

## 2. HTTP API

### 2.1 Entity 검색 — FR-Q2

```
GET /entities?name={partial}&kind={kind}&filePath={prefix}&limit=&offset=
```

- `name`: 부분 일치, 대소문자 무시. `kind`, `filePath`(접두 일치)와 AND 조합.
- 응답: `{ "items": [Entity], "total": 123 }`

### 2.2 Entity 상세 — FR-V2

```
GET /entities/{encodedId}
```

- 응답: `{ "entity": Entity, "relationshipCounts": { "in": 12, "out": 5 } }`
- 목록이 아니라 개수만 준다. 관계 목록은 2.3으로 조회한다.

### 2.3 연결 관계 목록 — FR-V2, FR-Q5

```
GET /entities/{encodedId}/relationships?direction=in|out|both&types=CALLS,IMPORTS&resolution=static|inferred&limit=&offset=
```

- 응답: `{ "items": [ { "relationship": Relationship, "counterpart": Entity } ], "total": 40 }`
- `counterpart`: direction 기준 반대편 Entity (in이면 source, out이면 target).

### 2.4 Caller / Callee — FR-Q3

```
GET /entities/{encodedId}/callers    // 들어오는 CALLS
GET /entities/{encodedId}/callees    // 나가는 CALLS
```

- 2.3의 `types=CALLS` 고정 단축 경로. 응답 형태는 2.3과 동일.

### 2.5 서브그래프 — FR-Q4, FR-Q5, FR-Q6

```
GET /entities/{encodedId}/subgraph?direction=out|in|both&depth=2&types=&resolution=&maxNodes=200&includeSnippets=true
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
POST /analysis/runs          body: { "mode": "full" | "incremental" }
```

- 202 응답: `{ "runId": "run-01" }`. 실행 중이면 409.
- incremental은 마지막 완료 run의 revision을 base로 git diff를 계산하고, 직전 run의 실패 파일을 변경 여부와 관계없이 재분석 대상에 합친다 (DATA-MODEL 3.2의 재분석 규칙).
- 파일 분석이 실패하면 해당 파일의 기존 graph data를 보존하고, `failures`에 `preservedRevision`을 포함한다.

```
GET /analysis/runs/{id}
GET /analysis/runs?limit=
```

- 응답: `{ "id", "mode", "status", "revision", "baseRevision", "startedAt", "finishedAt", "entityCount", "relationshipCount", "failures": [ { "filePath", "message", "preservedRevision" } ] }`

### 2.7 프로젝트 정보

```
GET /project
```

- 응답: `{ "project": { "id", "name", "rootPath" }, "lastRun": { ...2.6 응답 요약 } }`

### 2.8 구현 확장 — Web UI 전용 집계/검토 endpoint (claude-do.md M4)

이 문서 초안에는 없었으나, M4 Web UI의 "Entity/Relationship/Evidence 통계"와 "분석 실패 및 inferred 관계 검토" 화면을 구현하기 위해 추가한 보조 endpoint다. 둘 다 읽기 전용이며 전체 그래프를 내려주지 않는다(Query-first, FR-AI1 원칙 유지) — 개수 집계이거나 페이지네이션된 목록이다.

```
GET /project/stats
```

- 응답: `{ "entities": { "total", "byKind": {...} }, "relationships": { "total", "byType": {...}, "byResolution": {...} }, "evidence": { "total" } }`

```
GET /project/inferred-relationships?limit=&offset=
```

- `resolution=inferred`인 관계를 confidence 오름차순으로 페이지네이션하여 반환한다 (검토 우선순위).
- 응답: `{ "items": [ { "relationship": Relationship, "source": Entity, "target": Entity } ], "total": N }`
- `limit`/`offset` 한도는 1.3절과 동일(기본 50, 최대 200).

---

## 3. MCP Tools — FR-Q7, FR-AI1, FR-AI3

모든 tool은 읽기 전용이며 HTTP API와 동일한 Query 서비스를 사용한다 (Shared Context 원칙 — 사람의 UI와 AI가 같은 데이터를 본다).

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
