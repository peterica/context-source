# IMPLEMENTATION_REPORT.md

- **작성일**: 2026-08-06
- **범위**: `claude-do.md`가 지시한 ContextSource MVP(Phase 1, M1~M5) 전체
- **SSOT**: `PRD.md` (문서 우선순위는 `claude-do.md` §최우선 원칙 2를 따름)

---

## 1. 구현 요약

TypeScript 소스 코드를 정적으로 분석하여 **Entity / Relationship / Evidence**로 변환하고, SQLite에 저장한 뒤 HTTP API·Web UI·MCP로 조회할 수 있는 코드 관계 분석 시스템을 처음부터 끝까지 구현했다. M1(분석 코어) → M2(저장/Query) → M3(증분 분석) → M4(Web UI) → M5(MCP 연동) 순서로 진행했으며, 각 단계는 claude-do.md에 명시된 품질 Gate(타입체크·단위 테스트·골든 fixture·스키마 무결성·HTTP 통합 테스트·Git fixture 증분 테스트·production build·브라우저 smoke test·MCP 통합 smoke test)를 실제로 통과시킨 뒤 다음 단계로 진행했다.

핵심 성과:

- TypeScript Compiler API 기반 분석기가 실제 샘플 프로젝트(`samples/demo-project`)와 9종의 골든 fixture(기본/alias import, barrel re-export, 상속/구현, 오버로드/제네릭, 콜백/고차함수, dynamic import, 외부 패키지, 파싱 실패)에서 정확히 동작함을 확인했다.
- SQLite 스키마는 `DATA-MODEL.md`의 DDL을 문자 그대로 적용했고, "Evidence 없는 Relationship 저장 불가"를 deferred 복합 FK로 스키마 수준에서 강제함을 테스트로 검증했다.
- 실제 Git 저장소(임시 디렉터리에 다중 commit)로 증분 분석의 add/modify/delete/rename, 역방향 1단계 재분석, 실패 파일 재시도, "증분 결과 == 동일 revision full scan 결과" 동등성을 모두 검증했다. 이 과정에서 실제 버그(범위 밖 파일 참조 관계 유실)를 발견하고 수정했다 (ADR-0003).
- Web UI는 실제 브라우저(Playwright/Chromium headless)로 Overview → Entity 검색 → 영향 그래프 렌더링 → 엣지 클릭 → Evidence 패널까지 전체 플로우를 스크린샷과 함께 확인했다.
- MCP 서버는 실제 stdio 프로세스로 기동해 MCP Client로 5개 tool을 모두 호출하는 통합 테스트를 작성·통과시켰다.
- `docker compose up --build`로 api/ui 두 컨테이너를 실제로 빌드·기동하고, 분석 트리거부터 통계 조회, UI의 `/api` 프록시까지 curl로 검증했다.

---

## 2. 사용 기술

상세 근거는 [`docs/adr/0001-tech-stack.md`](./docs/adr/0001-tech-stack.md) 참고.

| 영역 | 선택 |
|------|------|
| 런타임 | Node.js ≥ 22.5.0 |
| 언어 | TypeScript (strict) |
| 패키지 관리 | npm workspaces |
| 정적 분석 | TypeScript Compiler API (`ts.Program`, `ts.TypeChecker`) |
| HTTP 프레임워크 | Express 4 |
| SQLite 드라이버 | Node.js 내장 `node:sqlite` (`DatabaseSync`) — 애초 계획한 `better-sqlite3`는 이 개발 환경에 Xcode Command Line Tools가 없어 네이티브 빌드가 실패해 전환함 |
| UI | React 18 + Vite 5 |
| 그래프 시각화 | Cytoscape.js + cytoscape-dagre |
| MCP | `@modelcontextprotocol/sdk` (stdio transport) |
| 테스트 | Vitest (core/api/mcp), Playwright(Chromium) 수동 브라우저 smoke test |
| Lint/Format | ESLint + Prettier |
| Git 연동 | Node `child_process` + 로컬 `git` 바이너리 |

---

## 3. 아키텍처

```text
packages/
  core   Analyzer(Parser/Resolver) + SQLite Storage + Query 엔진 + 증분 분석
         — 순수 로직, 네트워크 의존 없음. api/cli/mcp가 모두 이 모듈을 재사용한다.
  cli    전체/증분 분석 CLI (JSON stdout 또는 SQLite 직접 저장)
  api    HTTP Query API 서버 (Express) — core를 내부 모듈로 포함, SQLite 파일을 단독 소유
  mcp    읽기 전용 MCP 서버 (stdio) — core Query 엔진을 api와 동일하게 재사용, 읽기 전용 connection
  web    Web UI (React + Vite + Cytoscape.js) — HTTP API만 호출
samples/demo-project   분석 대상 예시 TypeScript 프로젝트 (M1 CLI 스모크, M4 브라우저 테스트, Docker Compose 기본값에 사용)
docs/adr/              ADR-0001(기술 스택), ADR-0002(추출 규칙), ADR-0003(증분 분석 심볼 해석)
```

```text
Source Code
    │  (TypeScript Compiler API)
    ▼
core/analyzer  →  Entity + Relationship + Evidence (in-memory)
    │
    ▼
core/storage   →  SQLite (entity / relationship / evidence / analysis_run / analysis_failure)
    │
    ▼
core/query     →  search / callers / callees / subgraph / stats
    │                                   │
    ├── api (HTTP, Express) ───────────┤
    │       │                          │
    │       ▼                          ▼
    │   web (React)                mcp (stdio)
    │   사람이 탐색                 AI가 조회
```

사람(Web UI → HTTP API)과 AI(MCP)가 **동일한 `core` Query 엔진과 동일한 SQLite 스키마**를 공유한다 (PRD "Shared Context" 원칙). `api`가 SQLite 파일의 유일한 쓰기 주체이며, `mcp`는 읽기 전용(`node:sqlite`의 `readOnly: true`) connection만 연다.

### Docker Compose 구성

ROADMAP.md 결정대로 서비스는 `api`와 `ui` 두 개뿐이다. SQLite는 `api` 컨테이너에 임베디드된 파일이며(named volume), 분석 대상 저장소는 `api` 컨테이너에 **read-only**로 마운트한다.

---

## 4. 주요 설계 결정

전체 ADR은 `docs/adr/`에 있다. 요약:

- **ADR-0001**: 기술 스택 전체(위 표) — 특히 `better-sqlite3` → `node:sqlite` 전환(네이티브 빌드 회피, 의존성 0개).
- **ADR-0002**: Entity/Relationship 추출 세부 규칙 — Function 범위(변수에 대입된 함수 표현식 포함), 오버로드는 구현 시그니처로 귀결, DECLARES 범위, **CALLS 3단계 해석**(직접 심볼 해석=static, 단일 호출 시그니처를 통한 타입 기반 추정=inferred confidence 0.8, 그 외에는 관계를 아예 생성하지 않음 — false positive 방지 우선), IMPORTS의 내부/외부 경계 해석, dynamic import 처리(inferred confidence 0.6), 파싱 실패 격리, 관계 중복 제거 규칙.
- **ADR-0003**: 증분 분석에서 재분석 범위(`onlyFiles`) 밖 파일의 심볼을 정확히 참조하기 위해, 비용이 낮은 AST 순회(Phase A)는 전체 파일에 대해 수행하되 비용이 큰 TypeChecker 관계 해석(Phase B)과 DB 쓰기는 재분석 대상으로만 좁힌다. 이 결정은 실제 회귀 버그(범위 밖 파일 참조 관계 유실)를 고치는 과정에서 나왔다.
- **DTO 설계**: `packages/core/src/types.ts`의 Entity/Relationship/Evidence 필드가 `API.md`의 JSON 예시와 1:1로 대응하도록 설계해 HTTP 계층에서 별도 매핑 코드 없이 그대로 직렬화한다.
- **Relationship id/Evidence id는 내용 기반 결정적 해시**(타입+source+target, 관계+위치)로 생성해 재분석 시 동일 관계가 동일 id로 수렴하도록 했다 — 증분 교체와 골든 동등성 테스트 모두 이 성질에 의존한다.
- **API.md에 없던 보조 endpoint 2개** (`GET /project/stats`, `GET /project/inferred-relationships`)를 M4 Web UI의 필수 화면(통계, inferred 관계 검토)을 구현하기 위해 추가했다. 둘 다 읽기 전용·집계/페이지네이션이며 전체 그래프를 덤프하지 않아 Query-first 원칙을 지킨다 (API.md §2.8에 명시).

---

## 5. 변경 파일 목록

저장소가 빈 상태에서 시작했으므로 사실상 전체가 신규 파일이다. 패키지 단위로 요약한다 (전체 목록은 `git ls-files` 참고):

- **루트**: `package.json`, `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc.json`, `Makefile`, `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.ui`, `.dockerignore`, `docs/adr/000{1,2,3}-*.md`
- **`packages/core`**: `src/types.ts`, `src/id.ts`, `src/analyzer/*`(9개 파일 — program/file-analyzer/resolve-module/resolve-symbol/resolve-relationships/evidence-builder/pending-tasks/package-name/project-analyzer), `src/storage/*`(schema/db/ingest/mappers/project-repo/run-repo), `src/query/*`(entity-queries/relationship-queries/subgraph/stats), `src/incremental/*`(git/reverse-imports/incremental-runner), `src/orchestrator.ts`, `src/index.ts`, `test/*`(fixtures 9종 + 7개 테스트 파일, 70 tests)
- **`packages/cli`**: `src/index.ts`, `src/git.ts`
- **`packages/api`**: `src/app.ts`, `src/errors.ts`, `src/id-encoding.ts`, `src/validators.ts`, `src/git.ts`, `src/index.ts`, `test/*`(2개 파일, 17 tests)
- **`packages/mcp`**: `src/db.ts`, `src/tools.ts`, `src/index.ts`, `test/mcp.test.ts`(8 tests)
- **`packages/web`**: `src/App.tsx`, `src/api/client.ts`, `src/components/*`(Overview/Explore/EntitySearch/EntityExplorer/ImpactGraph/EvidencePanel/Review/RunHistory), `src/main.tsx`, `src/styles.css`, `server.mjs`(Docker용 정적+프록시 서버), `vite.config.ts`, `index.html`
- **`samples/demo-project`**: 4개 TypeScript 파일 + `tsconfig.json` — 도메인/인프라/서비스 계층의 작은 예시 프로젝트
- **문서 갱신**: `README.md`(구현 상태·아키텍처·실행 방법 추가), `PRD.md`(상태 라인), `API.md`(§2.8 확장 endpoint), `DATA-MODEL.md`(구현 상태 라인)

---

## 6. 실행 방법

### Docker Compose (권장)

```bash
docker compose up --build
```

- API: `http://localhost:9080/api/v1` — 기동 시 `samples/demo-project`를 read-only로 분석 대상 마운트
- UI: `http://localhost:9090` — 접속 후 "전체 분석" 버튼으로 최초 분석 실행
- 다른 프로젝트 분석: `ANALYZE_TARGET=/absolute/path TSCONFIG_PATH=tsconfig.json docker compose up --build`
- 포트 충돌 시: `API_PORT=9081 UI_PORT=9091 docker compose up --build`

> 최초 검증 당시에는 기본 포트가 8080/5173이었으나, 이후 로컬 환경의 다른 서비스와 충돌해 9080/9090(호스트 매핑 기준)으로 변경했다. 컨테이너 내부 포트(api=8080, ui=3000)는 그대로다.

**검증 완료**: 실제로 `docker compose build && docker compose up -d`를 실행해 두 이미지를 빌드하고 두 컨테이너를 기동한 뒤, `POST /analysis/runs`로 분석을 트리거하고 `GET /project/stats`가 올바른 집계를 반환하는 것과 `ui` 컨테이너의 `/api` 프록시가 `api` 컨테이너로 정상 전달되는 것을 curl로 확인했다.

### Docker 없이 (Node.js ≥ 22.5.0)

```bash
make setup      # npm install
make test       # core/api/mcp 테스트 (95 tests)
make analyze    # samples/demo-project 전체 분석 → data/contextsource.sqlite
make run-api    # HTTP API 서버
make run-web    # Web UI dev server
make run-mcp    # MCP 서버 (stdio)
```

---

## 7. 테스트 명령과 결과

```bash
$ make test
```

| 패키지 | 파일 | 테스트 수 | 결과 |
|--------|------|-----------|------|
| core | `id.test.ts` | 6 | ✅ |
| core | `schema-integrity.test.ts` | 11 | ✅ |
| core | `storage-query.test.ts` | 11 | ✅ |
| core | `stats.test.ts` | 3 | ✅ |
| core | `project-analyzer.test.ts` | 34 | ✅ |
| core | `incremental.test.ts` | 5 | ✅ |
| api | `app.test.ts` | 15 | ✅ |
| api | `incremental-endpoint.test.ts` | 2 | ✅ |
| mcp | `mcp.test.ts` | 8 | ✅ |
| **합계** | **9개 파일** | **95** | **95/95 통과** |

추가로 `make typecheck`(5개 패키지 모두 `tsc --noEmit` 통과), `make lint`(5개 패키지 모두 ESLint 0 error/warning), `npm run build -w @contextsource/web`(production build 성공, 337 모듈) 확인.

### 단계별 품질 Gate 통과 근거

| Gate | 근거 |
|------|------|
| M1: 타입체크, analyzer 단위 테스트, 골든 fixture | `project-analyzer.test.ts` 34개(9개 fixture 시나리오) + `id.test.ts` 6개, 전부 통과. CLI로 `samples/demo-project` 실제 분석 확인 |
| M2: 스키마 무결성, HTTP API 통합 테스트 | `schema-integrity.test.ts` 11개(deferred FK, CHECK 제약, UNIQUE, CASCADE 전부 실제 SQL로 검증) + `app.test.ts` 15개(실제 HTTP 서버 기동, fetch로 호출) |
| M3: Git fixture 증분, 실패 재시도, 동등성 | `incremental.test.ts` 5개 — 실제 임시 Git 저장소에 4개 commit을 만들어 add/modify/delete/rename, 역방향 1단계, 실패 재시도, "증분==full" 동등성 전부 검증. 이 과정에서 실제 버그를 발견·수정(ADR-0003) |
| M4: production build, 브라우저 smoke test | `vite build` 성공 + Playwright Chromium으로 Overview/검색/영향그래프/Evidence패널/검토/이력 전 화면 스크린샷 확인, 콘솔 에러 0건 |
| M5: MCP tool 통합 smoke test | `mcp.test.ts` 8개 — 빌드된 서버를 실제 자식 프로세스로 spawn, MCP Client로 5개 tool 모두 호출·검증 |

---

## 8. FR별 구현 상태

### 5.1 Analysis (M1)

| FR | 상태 | 구현 위치 |
|----|------|-----------|
| FR-A1 | ✅ | `analyzer/program.ts`(tsconfig 기반 Program/Checker), `analyzer/file-analyzer.ts`(Entity 추출) |
| FR-A2 | ✅ | `analyzer/resolve-relationships.ts`, `analyzer/resolve-module.ts` |
| FR-A3 | ✅ | `analyzer/evidence-builder.ts` + 스키마 deferred FK로 이중 강제 |
| FR-A4 | ✅ | `id.ts`(symbolPath 기반, 라인 무관) — `id.test.ts`, `project-analyzer.test.ts`의 "Entity id stability" |
| FR-A5 | ✅ | `resolve-relationships.ts`의 static/inferred 3단계 해석 |
| FR-A6 | ✅ | `incremental/incremental-runner.ts` — 변경+역방향1단계+실패파일 재분석, 삭제 정리, 원자적 교체 |
| FR-A7 | ✅ | `orchestrator.ts`의 `runFullAnalysis`, CLI `--mode full`, `POST /analysis/runs {mode:"full"}` |
| FR-A8 | ✅ | `project-analyzer.ts`의 syntactic diagnostics 격리 |

### 5.2 Storage & Query (M2)

| FR | 상태 | 구현 위치 |
|----|------|-----------|
| FR-Q1 | ✅ | `storage/schema.ts`(DATA-MODEL.md DDL 그대로) |
| FR-Q2 | ✅ | `query/entity-queries.ts` `searchEntities` |
| FR-Q3 | ✅ | `query/relationship-queries.ts` `listCallers`/`listCallees` |
| FR-Q4 | ✅ | `query/subgraph.ts` `getSubgraph`(방향/depth) |
| FR-Q5 | ✅ | `listConnectedRelationships`/`getSubgraph`의 types/resolution 필터 |
| FR-Q6 | ✅ | 모든 Relationship DTO에 evidence 배열 포함 |
| FR-Q7 | ✅ | CLI + HTTP API(`packages/api`) + MCP(`packages/mcp`) |

### 5.3 Visualization (M4)

| FR | 상태 | 구현 위치 |
|----|------|-----------|
| FR-V1 | ✅ | `ImpactGraph.tsx`의 `direction=in` 기본 옵션 |
| FR-V2 | ✅ | `EntityExplorer.tsx` |
| FR-V3 | ✅ | `EvidencePanel.tsx` — 브라우저 테스트로 snippet 렌더링 확인 |
| FR-V4 | ✅ | `ImpactGraph.tsx`의 depth 슬라이더 + type 체크박스 |
| FR-V5 | ✅ | static=실선/녹색, inferred=점선/황색 + 배지 |
| FR-V6 | ✅ | 서브그래프 endpoint만 사용, 전체 덤프 없음 |

### 5.4 AI Integration (M5)

| FR | 상태 | 구현 위치 |
|----|------|-----------|
| FR-AI1 | ✅ | MCP 5개 tool만 노출, 전체 그래프 tool 없음 |
| FR-AI2 | ✅ | 모든 tool 응답에 evidence 포함 |
| FR-AI3 | ✅ | `maxNodes`, `includeSnippets`, `limit`, `truncated` |

**PRD에 정의된 FR 24개 전부 구현 완료.**

### 비기능 요구사항(NFR) 상태

| NFR | 상태 |
|-----|------|
| NFR-1 추적 가능성 | ✅ 스키마 수준 강제 |
| NFR-5 정확성 우선 | ✅ 설계(3단계 CALLS 해석, 모호하면 관계 미생성)로 확보. 대규모 실제 코드베이스 대상 recall 95% 정량 측정은 미수행(§10) |
| NFR-6 로컬 실행 | ✅ 분석/저장/Query가 네트워크 호출 없음(코드 검토로 확인 — analyzer/storage/query 어디에도 fetch/http client 없음) |
| NFR-2/3/4 (성능) | ⚠️ 아키텍처상 목표를 향해 설계했으나(증분은 변경 파일만 재분석·재쓰기, SQLite 인덱스) 수치 벤치마크는 미수행 — §10 참고 |
| NFR-7 확장성 | ⚠️ Entity/Relationship 모델과 Parser/Resolver가 모듈로 분리되어 있으나 실제 플러그인 인터페이스는 아직 없음(TypeScript 전용) |

---

## 9. 완료하지 못한 항목

- **NFR-2/3/4의 수치 벤치마크**: "증분 분석이 전체 대비 5% 이하 시간", "10만 LOC 수 분 이내", "Query p95 1초 이내"를 대규모 실제 코드베이스로 측정하지 않았다. 골든 fixture와 `samples/demo-project`(파일 7개 규모)에서는 모든 동작이 즉시(수 ms~수백 ms) 완료됨을 확인했지만, 이는 PRD가 요구하는 규모의 정량 검증이 아니다.
- **`static` false positive 0% / recall 95%의 정량 측정**: 골든 fixture 9종에서는 명시적 assertion으로 0 false positive를 확인했지만, PRD 성공 지표가 요구하는 "샘플 코드베이스 수작업 검증" 규모의 recall 측정은 수행하지 않았다.
- **Web UI 자동화 컴포넌트 테스트**: M4 Gate(claude-do.md)가 요구하는 것은 "production build + 브라우저 smoke test"이며 둘 다 통과했다. 다만 Vitest+React Testing Library 같은 컴포넌트 단위 테스트는 작성하지 않았다.
- **CI 파이프라인**: GitHub Actions 등 자동화된 CI는 구성하지 않았다(claude-do.md에서 명시적으로 요구하지 않음).

---

## 10. 알려진 제한사항

- **Entity 추출 범위**: 이름 있는 `FunctionDeclaration`/클래스 메서드/변수에 대입된 함수 표현식만 Function/Method Entity가 된다. 익명 클래스 표현식(`const X = class {...}`)이나 computed property name을 가진 메서드는 Entity로 추출되지 않는다(ADR-0002 §1~2). 실제 코드베이스에서 이 비중이 크면 recall이 낮아질 수 있다.
- **Interface 멤버**: interface의 메서드 시그니처는 별도 Entity가 아니므로, 인터페이스 타입을 통한 호출(`this.repository.save(...)`)은 대상을 특정할 수 없어 CALLS 관계가 생성되지 않는다 — false positive를 만들지 않기 위한 의도적 설계이지만, DI 패턴이 많은 코드베이스에서는 CALLS recall이 낮아질 수 있다(`samples/demo-project`에서 실제로 관찰됨: `TaskService`가 `TaskRepository` 인터페이스를 통해 호출하는 부분은 관계가 생성되지 않는다).
- **`unresolved` resolution 없음**: BENCHMARK.md가 제안한 `unresolved`(발견은 했지만 대상을 특정 못 함) 상태는 PRD/DATA-MODEL에 정의되어 있지 않아 구현하지 않았다. 현재는 그런 경우 관계를 아예 생성하지 않는다.
- **Web 번들 크기**: production build가 단일 청크 약 700KB(gzip 228KB)로, code splitting을 적용하지 않았다. MVP 규모에서는 문제 없으나 확장 시 개선 여지가 있다.
- **인증 없음**: HTTP API/MCP 모두 인증이 없다. PRD 범위가 로컬 단일 사용자 실행이므로 의도된 설계이지만, 로컬 외 환경에 배포할 경우 반드시 추가해야 한다.
- **Docker 이미지**: macOS(Apple Silicon) Docker Desktop에서만 실제 빌드·기동을 검증했다. 멀티 아키텍처 빌드나 이미지 크기 최적화는 하지 않았다.
- **Node.js 버전 요구**: `node:sqlite`가 Node ≥ 22.5.0에서만 제공되므로, 이보다 낮은 버전에서는 전혀 동작하지 않는다.

---

## 11. 다음 단계 권고

1. `samples/demo-project`보다 훨씬 큰(실제 오픈소스 규모) TypeScript 프로젝트로 NFR-2/3/4와 recall 95% 성공 지표를 실측하고, 필요하면 인덱스·쿼리를 튜닝한다.
2. BENCHMARK.md P0 제안 중 "변경 영향 분석의 의미 정의"(구조적 영향 후보 vs 단정적 예측 구분)와 "Path 조회"는 이번 MVP에서 의도적으로 제외했다 — PRD에 반영되면 다음 단계로 고려한다.
3. Web 번들 code splitting(특히 Cytoscape.js 지연 로딩) 적용.
4. GitHub Actions 등으로 `make typecheck && make lint && make test`를 PR마다 자동 실행하는 CI 구성.
5. 로컬 외 환경 배포 시 HTTP API에 최소한의 인증(API key 등)을 추가.
6. Interface 기반 호출의 recall을 높이고 싶다면, "인터페이스를 구현하는 클래스가 정확히 하나"인 경우에 한해 `inferred`로 연결하는 규칙을 ADR로 추가 검토(현재는 정확성을 우선해 보수적으로 미생성).

---

## 12. 부록 — Phase 2 착수: Project Entity (2026-08-11)

MVP(Phase 1) 완료 이후, 사용자 요청에 따라 [ROADMAP.md](./ROADMAP.md) Phase 2 "Project Knowledge Base"의 첫 조각인 **Project Entity**를 구현했다. 설계는 [ADR-0004](./docs/adr/0004-project-entity.md)에 기록했다.

**구현 요약**

- `project` 테이블에 `tsconfig_path`(NOT NULL)/`description`/`updated_at` 컬럼 추가. 기존 DB는 `PRAGMA user_version` 기반 경량 마이그레이션(`packages/core/src/storage/migrations.ts`)이 연결 시점에 자동 적용한다.
- HTTP API가 더 이상 프로젝트 하나에 고정되지 않는다 — 전체 endpoint를 `/projects/{id}/...`로 재구성(breaking change, API.md 개정)하고 `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` 등록 API를 추가했다.
- 소스 접근은 "상위 workspace 디렉터리 하나를 read-only 마운트 + 등록 시 상대 경로 지정" 방식을 택했다(Docker의 `WORKSPACE_ROOT`, 로컬의 `--workspace-root`). 등록된 프로젝트의 `root_path`/`tsconfig_path`는 항상 절대 경로로 저장한다.
- MCP 서버는 의도적으로 바꾸지 않았다 — 여전히 프로세스당 프로젝트 1개(`--project-id`)로 고정된다.
- Web UI에 프로젝트 목록/검색/등록 화면(`ProjectList`)을 추가하고, 기존 Overview/탐색/검토/이력 화면은 선택된 프로젝트로 스코프되도록 재구성(`ProjectWorkspace`)했다.
- core 9개 신규 테스트(CRUD, 집계, 마이그레이션) + api 9개 신규 테스트(등록/조회/수정/삭제/격리/경로 검증)를 추가했다. 실제 브라우저(Playwright)로 프로젝트 2개를 등록·분석해 통계와 Entity 검색 결과가 서로 격리됨을 확인했다.

**의도적으로 하지 않은 것** (ADR-0004에 명시): 기술 스택 메타데이터 수집, 유사 프로젝트 탐색, 프로젝트 간 관계 분석, MCP의 다중 프로젝트 파라미터화. 이들은 Project Entity가 자리잡은 뒤의 후속 과제다.

**알려진 제한**: workspace-root 상대 경로 등록 방식은 Docker에서 "여러 프로젝트가 같은 상위 디렉터리 아래 있어야 한다"는 제약을 만든다(README §Docker Compose 참고). 서로 다른 최상위 디렉터리에 있는 프로젝트를 등록하려면 그 디렉터리들을 포함하는 더 상위 경로를 workspace-root로 잡거나, 컨테이너 재시작 시 마운트를 바꿔야 한다.

---

## 13. 부록 — Phase 2 계속: 기술 스택 관리 (2026-08-11)

Project Entity 다음으로 ROADMAP.md Phase 2의 "기술 스택 관리"를 구현했다. 설계는 [ADR-0005](./docs/adr/0005-tech-stack-management.md)에 기록했다.

**구현 요약**

- 새 테이블 `project_tech_stack` (project_id, category, value) — category는 `language`/`runtime`/`framework`/`orm`/`database`/`build_tool` 6종으로 고정. 새 테이블이라 `CREATE TABLE IF NOT EXISTS`만으로 기존 DB에도 안전하게 적용되며 별도 마이그레이션이 필요 없다.
- `package.json` 기반 자동 감지(`detectTechStack`) — `language: TypeScript`/`runtime: Node.js`는 항상 고정으로 추가하고, `dependencies`/`devDependencies`의 알려진 패키지 이름(react/express/@nestjs/core/typeorm/prisma/pg/mysql2/vite/webpack 등)을 category별로 매핑한다. 네트워크 호출이나 버전 파싱 없이 로컬 파일만 읽는다.
- API: `GET/POST/DELETE /projects/{id}/tech-stack`(개별 추가·삭제, chip UI에 맞춘 idempotent 설계), `POST /projects/{id}/tech-stack/detect`(자동 감지 결과를 기존 항목과 병합 — 수동으로 추가한 항목을 지우지 않음).
- Web UI: Overview 화면에 카테고리별 chip 편집 패널(추가/삭제/자동 감지 버튼)을 추가하고, 프로젝트 목록 화면의 각 행에 기술 스택 배지를 표시해 여러 프로젝트를 훑어볼 때 바로 눈에 띄도록 했다.
- core 9개 + api 8개, 총 17개 신규 테스트. 실제 브라우저(Playwright)로 자동 감지 → 수동 추가 → 삭제 → 프로젝트 목록 배지 반영까지 전 과정을 확인했다(콘솔 에러 0건).

**의도적으로 하지 않은 것** (ADR-0005에 명시): 기술 스택 기반 프로젝트 검색/유사 프로젝트 탐색(다음 Phase 2 과제), npm 레지스트리 조회나 버전 파싱, TypeScript/Node.js 이외 스택(Java/Spring 등) 감지.

**알려진 제한**: 자동 감지 매핑 목록은 의도적으로 짧다(주요 프레임워크/ORM/DB 드라이버/빌드 도구 위주) — 목록에 없는 패키지는 감지되지 않으며 수동으로 추가해야 한다.
