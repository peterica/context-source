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

- ~~**NFR-2/3/4의 수치 벤치마크**: "증분 분석이 전체 대비 5% 이하 시간", "10만 LOC 수 분 이내", "Query p95 1초 이내"를 대규모 실제 코드베이스로 측정하지 않았다.~~ **2026-08-12 완료** — typeorm(약 28만 LOC)으로 실측. 상세는 [§15](#15-부록--실제-규모-검증-2026-08-12) 참고. 실측 과정에서 실제 P0 결함 2건을 발견해 모두 수정 완료.
- ~~**`static` false positive 0% / recall 95%의 정량 측정**: 골든 fixture 9종에서는 명시적 assertion으로 0 false positive를 확인했지만, PRD 성공 지표가 요구하는 "샘플 코드베이스 수작업 검증" 규모의 recall 측정은 수행하지 않았다.~~ **2026-08-12 소규모 실측 완료** — 실제 소스 수작업 표본(4건)에서 recall 100%, false positive 0. 95% 기준의 대규모 정량 recall(전수/샘플링 검증)은 여전히 별도 골든셋이 필요해 근사치로 남아있다.
- **Web UI 자동화 컴포넌트 테스트**: M4 Gate(claude-do.md)가 요구하는 것은 "production build + 브라우저 smoke test"이며 둘 다 통과했다. 다만 Vitest+React Testing Library 같은 컴포넌트 단위 테스트는 작성하지 않았다.
- ~~**CI 파이프라인**: GitHub Actions 등 자동화된 CI는 구성하지 않았다(claude-do.md에서 명시적으로 요구하지 않음).~~ **2026-08-11 완료** — `.github/workflows/ci.yml`에서 push/PR마다 `build → typecheck → lint → test`를 자동 실행한다(BENCHMARK.md 5.13).

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

1. ~~`samples/demo-project`보다 훨씬 큰(실제 오픈소스 규모) TypeScript 프로젝트로 NFR-2/3/4와 recall 95% 성공 지표를 실측하고, 필요하면 인덱스·쿼리를 튜닝한다.~~ **2026-08-12 완료** ([§15](#15-부록--실제-규모-검증-2026-08-12)). 실측 중 발견한 증분 분석의 관계 유실 결함도 같은 날 근본 수정 완료(전이적 폐포 역방향 조회).
2. BENCHMARK.md P0 제안 중 "변경 영향 분석의 의미 정의"(구조적 영향 후보 vs 단정적 예측 구분)와 "Path 조회"는 이번 MVP에서 의도적으로 제외했다 — PRD에 반영되면 다음 단계로 고려한다.
3. Web 번들 code splitting(특히 Cytoscape.js 지연 로딩) 적용.
4. ~~GitHub Actions 등으로 `make typecheck && make lint && make test`를 PR마다 자동 실행하는 CI 구성.~~ **2026-08-11 완료.**
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

---

## 14. 부록 — Phase 2 완결: 유사 프로젝트 탐색 / 프로젝트 간 관계 분석, Phase 2 마무리 (2026-08-11)

기술 스택 관리 다음으로 ROADMAP.md Phase 2에 남아있던 마지막 두 항목 — "유사 프로젝트 탐색"과 "프로젝트 간 관계 분석" — 을 구현하며 Phase 2를 완결했다. 사용자는 이 시점에 명시적으로 범위를 "Phase 2까지"로 확정했고(Phase 3 Semantic Code Knowledge Base·Phase 4 AI Context Engine은 착수하지 않음), Phase 2 완료 후 벤치마크로 완성도를 높이는 것을 다음 단계로 지정했다.

**설계 배경**: 두 기능의 명칭만 보면 claude-do.md가 명시적으로 금지한 "Vector Search 추가"와 "다중 Project 지식 그래프 확장"과 충돌하는 것처럼 보인다(유사도 = 보통 임베딩, 관계 분석 = 보통 그래프). 이 충돌을 피하기 위해 두 금지사항을 위반하지 않는 설계를 [ADR-0006](./docs/adr/0006-similar-project-discovery.md)에 먼저 기록한 뒤 구현했다.

**구현 요약**

- 유사도 = 두 프로젝트의 `project_tech_stack` 태그 **교집합 크기**. 임베딩 모델·벡터 인덱스·외부 API 호출이 전혀 없는 순수 SQL/메모리 집합 연산이다.
- "관계 분석" = Project를 그래프 노드로 만들거나 Project 간 관계를 `relationship` 테이블에 저장하는 대신, 유사 프로젝트 목록의 각 항목에 "공유 기술 스택 태그"를 조회 시점에 계산해 근거로 함께 제공한다 — Evidence-first 원칙과 같은 정신.
- API: `GET /projects/{id}/similar?limit=` → `{ items: [{ project, sharedTechStack, score }] }`. `score` 내림차순, 동점이면 이름 오름차순, 대상 프로젝트 자신과 교집합 0인 프로젝트는 제외.
- "기술 스택 기반 검색"은 새 endpoint 없이, 이미 `GET /projects`가 내려주는 `techStack`을 Web UI 프로젝트 목록에서 클라이언트 필터링(드롭다운)으로 구현 — 이름 검색과 동일한 패턴.
- `findSimilarProjects`는 `project_tech_stack` 전체를 한 번의 쿼리로 읽어 프로젝트별로 메모리에서 묶은 뒤 교집합을 계산한다(대상 프로젝트마다 반복 쿼리하지 않음) — 직전 커밋에서 Codex가 지적한 N+1 패턴을 재발시키지 않기 위함.
- Web UI: Overview 화면에 "유사한 프로젝트" 패널(SimilarProjects, 클릭 시 해당 프로젝트로 전환)을 추가하고, 프로젝트 목록 화면에 기술 스택 드롭다운 필터를 추가했다.
- core 3개(`findSimilarProjects` 랭킹/limit/빈 결과) + api 6개(엔드포인트 통합, 404, limit 검증), 총 9개 신규 테스트. 전체 스위트 140개(api 40 + core 92 + mcp 8) 통과, typecheck/lint/production build 모두 통과.
- 실제 브라우저(Playwright, 로컬 API+Vite dev 서버)로 임시 프로젝트 2~3개를 등록해 확인: 기술 스택 드롭다운 필터 동작, 유사 프로젝트 패널의 공유 태그·점수 표시, 패널 클릭 시 다른 프로젝트로 전환, 기술 스택 태그 제거 시 패널이 실시간으로 갱신되는 것(아래 Codex 재검증 참고)까지 전 과정을 확인했다.

**Codex 재검증**: `codex review --uncommitted`로 독립 검토를 받아 실제 버그 3건을 찾아 모두 수정했다.

1. `SimilarProjects` 패널이 인접한 기술 스택 편집기(`TechStackEditor`)의 변경에 반응하지 않아 stale 데이터를 보여줄 수 있었던 문제 — `TechStackEditor`에 `onChange` 콜백을 추가하고 `Overview`가 로컬 버전 카운터를 올려 `SimilarProjects`의 `refreshKey`에 반영하도록 수정.
2. 요청 실패 시 설정된 `error`가 다음 프로젝트로 전환해도 초기화되지 않아 패널이 영구적으로 숨겨지는 문제 — effect 시작 시 `error`를 초기화하도록 수정.
3. 프로젝트를 빠르게 전환할 때 이전 요청의 늦은 응답이 새 프로젝트의 결과를 덮어쓸 수 있는 race condition — effect cleanup에서 `cancelled` 플래그로 stale 응답을 무시하도록 수정.

**의도적으로 하지 않은 것** (ADR-0006에 명시): 코드 임베딩/벡터 인덱스(Phase 3 범위), Project를 그래프 순회 가능한 노드로 만드는 것, 기술 스택 외 요인(코드 규모, 아키텍처 패턴 등)을 유사도에 반영하는 것.

이로써 ROADMAP.md Phase 2 "Project Knowledge Base"의 모든 항목(Project Entity, 기술 스택 관리, 프로젝트 검색, 유사 프로젝트 탐색, 프로젝트 간 관계 분석)이 구현 완료되었다. Phase 3/4는 별도 승인 전까지 보류한다.

---

## 15. 부록 — 실제 규모 검증 (2026-08-12)

Phase 2 완결과 벤치마크 P0/P1/P2 항목 정리 이후, 사용자가 "실제 규모 검증"과 "핵심 영향 분석 기능 구현" 중 하나를 선택해 실제 규모 검증을 먼저 진행하기로 했다(BENCHMARK.md 5.11 — PRD 성공 지표를 실제로 측정한 적이 없다는 지적).

**대상**: [typeorm/typeorm](https://github.com/typeorm/typeorm) `df07bf1`. 자체 `tsconfig.json`의 `include`(`src`, `test`, `*.ts`) 기준 3,245 파일, 약 285,676 LOC — PRD가 목표로 삼은 "약 10만 LOC"의 약 2.85배 규모. 모노레포가 아닌 단일 `tsconfig.json` 구조라 프로젝트 등록 모델(경로+tsconfigPath 하나)과 그대로 맞았다. `tsconfig.json`이 npm 패키지 `@tsconfig/node20`을 `extends`했는데, 이 저장소는 `pnpm`을 강제해 `npm install`이 `EBADDEVENGINES`로 거부되어 별도 스크래치 디렉터리에서 그 한 패키지만 받아 `node_modules`에 배치하는 방식으로 우회했다(전체 의존성 설치 불필요 — 정적 분석 자체는 `node_modules` 없이도 동작함을 확인).

**측정 결과** (표는 BENCHMARK.md 5.11에도 동일하게 기록):

- **NFR-3 (초기 인덱싱)**: 2.85배 규모를 3.7~4.1초에 완료 — "수 분 이내" 목표에 여유가 크다.
- **NFR-4 (Query 응답성)**: entity 상세 25ms, callers/callees 6~7ms, 검색 10ms, subgraph(depth2, 200노드) 28ms, **subgraph(depth3, both, 1000노드 — 의도적 최악 케이스) 71ms**, stats 91ms. 1초 목표 대비 최악 케이스도 14배 여유.
- **NFR-5 (정확성)**: 전체 관계 25,761건 중 100% `static`, 0% `inferred` — interface 경유 호출을 아예 생성하지 않는 기존 보수적 설계(§10 알려진 제한사항)와 일치한다. 실제 소스에서 수작업으로 고른 호출 4건(`Repository→EntityManager` 3건, `EntityManager→DataSource` 1건) 전부 정확히 캡처됨을 확인 — 소규모 표본이라 PRD의 95% 정량 기준을 대체하지는 않는다.
- **NFR-2 (증분 성능)**: 파일 15개(0.5%) 변경 후 수정 전 서버 측 2.4초(단, 관계 17.7% 유실 — 아래 결함 2번), 관계 유실을 고친 뒤 재측정하면 서버 측 3.5초(전체 스캔 대비 약 10~15% 단축, 유실 0건). "초 단위"는 달성하지만 "유의미하게 빠름"이라 하기엔 약하다 — 역방향 전이적 폐포로 재분석 대상이 넓어지는 것은 정확성을 위한 불가피한 트레이드오프다.

**실제 규모에서만 드러난 결함 2건, 둘 다 수정 완료** (7파일짜리 데모 프로젝트·골든 fixture로는 전혀 발견되지 않았던 것들):

1. **크래시 버그.** 전체 분석이 `UNIQUE constraint failed: entity.id`로 중간에 죽었다. 원인: `containerNames + name`만으로 symbolPath를 만드는데, (a) 같은 클래스의 동명 instance/static 메서드(`BaseEntity.hasId` 인스턴스 메서드와 `static hasId`), (b) 같은 파일의 동명 interface+class(`typings.ts`의 `TypedEventEmitter`), (c) 같은 부모 함수 안 서로 다른 형제 블록(if/else)의 동명 지역 함수(`*QueryRunner.connect` 안의 `onErrorCallback`)가 전부 같은 entity id로 충돌했다. 파일 단위 occurrence counter를 추가해 두 번째 발생부터 `$2`, `$3`... suffix를 붙이는 방식으로 고쳤다 — AST 방문 순서가 같은 소스에 대해 항상 동일하므로 재분석해도 결정적으로 같은 id가 나온다(FR-A4 entity id 안정성 보존, 충돌 없는 절대다수 케이스는 기존 id 형식 그대로 유지). `duplicate-symbol-names` fixture로 3가지 패턴 모두 회귀 테스트화. 수정 후 재분석: 중복 0건, 관계 25,713→25,761건으로 오히려 증가(이전엔 충돌로 가려졌던 심볼의 관계가 이제 정확히 잡힘). 커밋 `6f32246`.
2. **관계 유실 버그.** 파일 15개만 바꿨는데 전체 관계 25,761건 중 4,552건(17.7%)이 사라졌다 — 그것도 전부 **바꾸지 않은** 파일들 사이의 관계였다. 근본 원인을 정확히 특정했다: 변경된 파일의 역방향 importer(예: `DataSource.ts`, 여러 변경 파일을 import하고 있어 재분석 대상에 포함됨)는 재분석되며 그 entity가 delete 후 reinsert된다. 이때 그 entity를 **호출하지만 자신은 재분석 대상이 아닌** 파일(예: `EntityManager.ts`가 `DataSource.createQueryRunner()`를 호출)의 관계는 (1) target entity가 지워질 때 FK cascade로 함께 삭제되고, (2) `analyzeProject({ onlyFiles })`는 재분석 대상 파일을 **source**로 하는 관계만 재생성하므로 다시는 복구되지 않았다. 사라진 4,552건을 전수 대조한 결과 **100%가 이 패턴**과 일치했다(직접 변경한 15개 파일이 target인 경우는 0건). ADR-0003이 고친 것은 "역방향 참조를 **해석**하는 능력"(Phase A 전체 파일 심볼맵)이었지, "대상 entity가 지워질 때 그걸 가리키던 관계를 누가 다시 만드는가"는 아니었다 — 이번에 드러난 것은 후자다.

   **근본 원인**: `findReverseImporters`가 변경 파일의 역방향 importer를 1단계만 구했다. `EntityManager.ts`는 `DataSource.ts`를 `import type`으로 직접 참조하는데(2단계 연쇄: `EntityManager → DataSource → (변경 파일)`), 1단계 조회는 "변경 파일을 직접 import하는 파일"만 찾으므로 `DataSource.ts`는 찾아도 `EntityManager.ts`는 찾지 못했다. **수정**: `findReverseImporters`가 새로 찾은 파일이 없을 때까지("고정점") 계속 반복해 역방향 import의 전이적 폐포를 구하도록 변경했다(`packages/core/src/incremental/reverse-imports.ts`). 2단계 체인 fixture로 회귀 테스트를 추가해 수정 전엔 실패·수정 후엔 통과함을 직접 확인했고, **typeorm 전체로 재검증해 관계 손실이 정확히 0건(25,761 → 25,761)임을 확인**했다.

**재현 방법** (검증 재현용): typeorm 같은 대형 프로젝트를 등록 → 전체 분석 → git으로 관리되는 여러(10개 이상) 파일에 사소한 변경(빈 줄 추가 등)을 만들어 커밋 → 증분 분석 실행 → `GET /projects/{id}/stats`의 `relationships.total`이 전체 분석 때보다 줄어드는지 확인(수정 후에는 줄어들지 않아야 한다). 안전을 위해 스크래치 클론에서 진행했다(원본 typeorm 저장소나 이 저장소 자체에는 어떤 변경도 하지 않았다).

**의도적으로 하지 않은 것**: PRD 95% recall 기준의 대규모 정량 검증(전수/샘플링 골든셋 구축은 별도 과제), 두 번째 오픈소스 프로젝트로의 교차 검증.

---

## 16. 부록 — M6: 변경 영향 분석 (2026-08-12)

실제 규모 검증(§15)에서 드러난 두 결함을 먼저 고친 뒤, 사용자가 BENCHMARK.md 5.1~5.3("영향 분석 기능부터 설계하자")을 다음 작업으로 지정했다. `GET /entities/{id}/subgraph?direction=in`이 그래프는 주지만 "왜 영향을 받는지", "가장 확실한 후보가 뭔지"는 답하지 않는다는 갭을 메우는 기능으로, 설계를 먼저 [ADR-0008](./docs/adr/0008-impact-analysis.md)에 기록해 사용자 확인을 받은 뒤 구현했다.

**설계 요지** (ADR-0008 전문 참고): 새 Relationship Type(`REFERENCES` 등 6종)이나 범용 Path Query 언어(`GET /paths?from=&to=`)는 추가하지 않는다 — 기존 5개 관계 타입 위에 "후보 랭킹 + 이유 + 경로 + 신뢰도"라는 조회 계층만 얹는다(claude-do.md의 "PRD에 없는 기능 추가 금지", PRD.md OQ-3의 범용 Query 언어 보류 결정과 일관). 알고리즘은 SQL recursive CTE 대신 애플리케이션 레벨 BFS로 후보별 대표 경로를 재구성한다(SQL CTE의 `MIN(depth) GROUP BY`는 "어느 edge로 처음 도달했는지"를 버리기 때문 — `findReverseImporters`의 전이적 폐포 구현(§15, 커밋 `fd1e207`)과 같은 이유로 같은 패턴을 재사용).

**구현 요약** (구현 순서 그대로 4단계, 각 단계마다 typecheck/lint/test 통과 후 개별 커밋):

1. **core**: `computeImpact(db, params)` — root부터 역방향(`direction=in`)으로 BFS하며 `visited` 맵에 `{predecessor, viaRelationshipRow, hopDepth}`를 기록해 후보별 대표 경로를 재구성한다. `confidence`는 새 필드 없이 경로 위 각 관계의 기존 `confidence`를 곱한 값, `reason`은 관계 타입별 한국어 템플릿(`"{source}가 {target}를 호출합니다"` 등)으로 후보에 가장 가까운 첫 hop을 문장화한다. `DECLARES`는 기본 순회 대상에서 제외(컨테이너→멤버는 "누가 의존하는가"가 아니므로). 단위 테스트 9개(단일/다중 hop, inferred 섞인 confidence 곱셈, depth/maxCandidates 절단, 순환 그래프 안전성, resolution 필터, 동점 처리).
2. **api**: `GET /projects/{id}/entities/{encodedId}/impact` — `computeImpact`를 감싸는 조회 endpoint. `depth` 기본 3(subgraph의 2보다 깊게 — impact는 더 먼 후보까지 보고 싶은 용도), `maxCandidates` 기본 50/최대 200. 통합 테스트 5개.
3. **core+api**: `computeChangedImpact` / `GET /projects/{id}/analysis/runs/{id}/changed-impact` — run의 `baseRevision`~`revision` 사이 git diff를 **저장하지 않고 조회 시점에 재계산**(`loadProgram`으로 TS Program을 다시 만들지 않고 `diffNameStatus`/`resolveGitRoot`만 재사용 — §15의 NFR-3 실측 이후 불필요한 재빌드로 성능 회귀를 만들지 않기 위함). 변경된 각 파일이 선언한 Entity마다 impact를 구해 병합·중복 제거(동일 후보가 여러 changed entity에서 나오면 confidence가 더 높은 쪽, 동률이면 경로가 짧은 쪽이 남는다)하고, `isDirectImpact`(hopDepth===1)와 `isLikelyTestFile`(새 `TESTS` 관계 타입 없이 파일 경로 패턴 휴리스틱만 적용 — ADR-0008이 명시적으로 구조적 관계 도입을 보류)을 추가한다. `baseRevision`이 없는 run(최초 전체 분석)은 API 경계에서 `400 INVALID_PARAM`으로 거부(검증 책임을 core가 아닌 API에 둬 core 함수의 파라미터는 non-nullable로 유지). core 통합 테스트 2개(직접/간접 영향 판정, 여러 changed entity 병합 시 절단) + api 통합 테스트 4개(성공 케이스, baseRevision 없음, 알 수 없는 run, depth 상한) — 전부 실제 임시 git repo + 실제 HTTP 서버로 검증.
4. **web**: "변경 영향" 탭(`/projects/:id/impact`) — BENCHMARK.md 5.3이 요구한 검토 순서(직접 영향 → 간접 영향 → 관련 테스트로 보이는 파일)를 그대로 화면 구조로 옮겼다. 분석 run 선택 드롭다운(기본값은 최신 완료 run), 각 후보는 `reason` 문장 + confidence 배지(기존 `RESOLUTION_TOOLTIP` 툴팁 패턴 재사용)로 표시하고 클릭 시 탐색 탭의 Entity 상세로 이동한다(`clickableRowProps` 재사용 — 키보드 접근성 유지). 경로 펼치기는 RunHistory의 실패 목록 인라인 펼치기와 같은 패턴을 재사용해 각 hop의 관계 타입·resolution·confidence·Evidence 스니펫을 보여준다. `path` 배열이 entity 이름을 담지 않아(새 DTO를 만들지 않기로 한 결정) 후보 수만큼 개별 entity를 조회하는 대신, DATA-MODEL.md §1의 안정된 id 스킴을 파싱하는 `entityIdLabel()`(format.ts)로 표시용 라벨만 뽑았다. Playwright로 실제 브라우저에서 3개 그룹 렌더링, 경로 펼치기, 후보 클릭 → 탐색 탭 네비게이션, baseRevision 없는 run 선택 시 에러 메시지, 키보드(Tab+Enter) 네비게이션을 확인 — 콘솔 에러 없음.

**API 문서화**: API.md 2.10절과 openapi.yaml에 두 endpoint(`/impact`, `/changed-impact`)와 관련 스키마(`ImpactCandidate`, `ImpactPathStep`, `ImpactResult`, `ChangedImpactCandidate`, `ChangedImpactResult`)를 추가했다. `openapi.yaml`은 기존에도 `security-defined`/`operationId` 관련 경고·에러가 전체 endpoint에 걸쳐 있었고(인증 없는 로컬 단일 사용자 도구라는 의도된 설계) 이번 추가로 새 카테고리의 에러는 생기지 않았다 — `bundle` 결과 `$ref` 해석 에러 없음을 확인했다.

**총 테스트**: 신규 20개(core 11 + api 9) 포함 전체 스위트 171개(core 110 + api 53 + mcp 8) 통과, typecheck/lint/production build 모두 통과.

**의도적으로 하지 않은 것** (ADR-0008 "하지 않는 것" 절 그대로): 새 Relationship Type 추가, 범용 Path Query 언어, "이게 실제로 깨진다"는 단정적 예측이나 자동 수정 제안, `TESTS` 관계 타입 기반의 정확한 테스트 매핑(경로 패턴 휴리스틱으로 대체), MCP tool 노출(Web UI에서 기능이 검증된 뒤 별도 판단).

---

## 17. 부록 — 골든 fixture 회귀 하네스 (BENCHMARK.md 5.4, 2026-08-12)

ADR-0008(변경 영향 분석) 완료 후 BENCHMARK.md에 남은 미해결 P0 3개(5.4 분석 품질 측정 체계, 5.9 프로젝트 카탈로그 포지셔닝, 5.12 보안/인증 로드맵) 중 어떤 것을 다음으로 할지 사용자에게 확인했고, 5.4를 선택했다.

**갭**: 골든 fixture 9종(`basic-import`, `barrel-reexport`, `inheritance`, `overload-generic`, `duplicate-symbol-names`, `callback-hof`, `dynamic-import`, `external-package`, `parse-failure`)이 이미 저장소에 있었지만, `project-analyzer.test.ts`의 개별 `it()`은 "이 관계가 존재한다"는 spot-check만 했다 — "이게 전부다(초과·누락 없음)"는 어떤 테스트도 검증하지 않았다. 즉 analyzer가 실수로 관계를 하나 더 만들거나(false positive) 기존 관계를 하나 빠뜨려도(recall 저하) 골든 fixture만으로는 전혀 잡히지 않는 상태였다.

**구현**:

- `packages/core/test/golden/normalize.mjs` — `AnalysisResult`(entities/relationships/evidence/failures)를 결정적 순서(id 오름차순)로 정렬하고 `projectId` 같은 파생 필드를 제거하는 순수 함수. `.ts`가 아니라 `.mjs`로 작성한 이유: 이 로직을 두 실행 컨텍스트(vitest가 esbuild로 트랜스파일하는 테스트 파일, 빌드된 `dist/index.js`를 그대로 import하는 node 유지보수 스크립트)가 동일하게 써야 하는데, 순수 JS로 작성하면 두 곳 모두에서 별도 컴파일 단계 없이 그대로 import된다.
- `packages/core/test/golden/generate.mjs` — 각 fixture를 `analyzeProject()`로 분석해 정규화한 뒤 `test/fixtures/<name>/golden.json`에 기록하는 유지보수 스크립트(`npm run generate-golden -w @contextsource/core`, `npm run build`로 dist가 최신인 상태에서 실행). fixture를 의도적으로 바꿀 때만 재실행한다 — 최초 9종+신규 1종은 이미 spot-check 테스트로 정확성이 검증된 현재 analyzer 출력에서 그대로 부트스트랩했다(새로 값을 손으로 추정해 넣지 않음).
- `packages/core/test/golden.test.ts` — fixture 디렉터리를 전부 스캔해 (1) `golden.json`이 없는 fixture가 있으면 "커버리지 누락"으로 실패시키는 가드 테스트 1개, (2) `golden.json`이 있는 fixture마다 실제 `analyzeProject()` 출력을 정규화해 golden과 `toEqual`로 완전 비교하는 테스트를 자동 생성한다. 새 CI 워크플로 변경은 불필요했다 — `npm run test`가 이미 `packages/core` 전체 vitest 스위트를 돈다(5.13에서 CI 자동화가 이미 해결됨).
- 하네스가 실제로 드리프트를 잡는지 직접 검증했다: `basic-import/golden.json`의 confidence 값 하나를 의도적으로 바꿔 테스트가 실패하는 것을 확인한 뒤 원복했다.
- `failures` 배열은 `filePath`와 "메시지가 비어있지 않다"만 golden에 담고 정확한 TS 진단 메시지 문구는 비교하지 않는다 — TypeScript 컴파일러 버전이 바뀌면 메시지 문구도 바뀔 수 있어, 그대로 golden에 박으면 무관한 컴파일러 업그레이드만으로 실패하게 된다.

**신규 fixture — `dependency-injection`**: BENCHMARK.md 5.4가 나열한 9개 시나리오 중 "dependency injection"만 기존 9종에 없었다. `Logger` 인터페이스 → `ConsoleLogger`(구현체) → `OrderService`(생성자로 `Logger` 주입받아 `this.logger.log(...)` 호출) → `main.ts`(`new OrderService(new ConsoleLogger())` 조립) 4개 파일로 구성했다. 분석 결과를 예측하며 §10 "알려진 제한사항"에 이미 산문으로 적혀있던 내용(인터페이스 멤버는 Entity로 추출되지 않으므로(ADR-0002 §2) 인터페이스 타입 필드를 통한 호출은 대상을 특정할 수 없어 CALLS 관계가 생성되지 않는다)을 다시 발견했고, 실제 `analyzeProject()` 실행으로 정확히 확인했다 — `this.logger.log('order placed')`는 어떤 CALLS 관계도 만들지 않는다(반면 `new OrderService(...)`, `new ConsoleLogger()`, `service.placeOrder()`처럼 구체 타입을 통한 호출은 전부 static CALLS로 정확히 잡힌다). 이 결과를 golden.json에 "해당 소스의 CALLS 관계 0건"으로 명시적으로 박아, 산문으로만 존재하던 알려진 한계를 CI가 강제하는 회귀 테스트로 승격시켰다 — 이 한계가 조용히 더 나빠지거나(다른 인터페이스 호출까지 못 잡게 되거나), 반대로 잘못된 방식(예: 휴리스틱 추측)으로 "고쳐져" false positive를 만드는 것을 방지한다. `project-analyzer.test.ts`에도 같은 내용을 spot-check로 추가했다(5개 `it()`).

**총 테스트**: 신규 16개(golden.test.ts 11 + project-analyzer.test.ts DI 스펙 5) 포함 전체 스위트 187개(core 126 + api 53 + mcp 8) 통과, typecheck/lint/production build 모두 통과.

**의도적으로 하지 않은 것**: PRD 95% recall 목표의 대규모 정량 검증(전수/샘플링 골든셋 구축)은 여전히 범위 밖이다 — 그건 §15/§16(BENCHMARK.md 5.11)이 실제 오픈소스 프로젝트(typeorm)로 별도 수행했고, 이번 작업은 "이미 있는 골든 fixture가 실제로 완전성을 강제하는가"라는 좁은 갭만 닫는다. 두 번째 오픈소스 프로젝트로의 교차 검증, `unresolved` resolution 상태 도입(§10에 이미 기록된 별도 미결정 사항)도 하지 않았다.
