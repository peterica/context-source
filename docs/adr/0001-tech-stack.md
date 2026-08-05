# ADR-0001: MVP 기술 스택

- **상태**: 확정
- **날짜**: 2026-08-05
- **근거 문서**: PRD.md OQ-1/OQ-3/OQ-4/OQ-5, ROADMAP.md 로컬 개발 환경, claude-do.md 개발 환경

## 배경

`claude-do.md`는 "실제 프로젝트 기술 스택은 기존 저장소 구성을 우선한다. 기존 구성이 없다면 TypeScript 생태계에 적합하고 로컬 실행이 단순한 기술을 선택한다"고 지시한다. 저장소에 기존 소스가 없으므로 아래 스택을 새로 선택하고 구현 전에 기록한다.

## 결정

| 영역 | 선택 | 이유 |
|------|------|------|
| 런타임 | Node.js (LTS 20+, 로컬 v24로 검증) | TypeScript Compiler API가 Node 위에서 동작. 별도 런타임 설치 불필요 |
| 언어 | TypeScript (strict) | 분석 대상과 구현 언어를 통일하여 TS Compiler API 사용에 자연스러움 |
| 패키지 관리자 | npm workspaces | 별도 글로벌 설치 없이 Node에 내장. pnpm/yarn 대비 추가 설치 요구가 없어 "로컬 실행 단순성" 기준에 부합 |
| 모노레포 구조 | npm workspaces (`packages/*`) | core(분석·저장·Query 공유 로직) / cli / api / web / mcp 분리. api가 SQLite 단독 소유(ROADMAP) 원칙을 패키지 경계로 강제 |
| 정적 분석 | TypeScript Compiler API (`ts.Program`, `ts.TypeChecker`) | FR-A1/A2가 tsconfig 기반 Program/TypeChecker를 명시. tree-sitter 등 구문 전용 파서는 심볼 해석(NFR-5 false positive 0%)을 만족할 수 없음 |
| HTTP 프레임워크 | Express 4 | API.md의 REST 스타일 엔드포인트에 충분히 단순. 의존성 최소, 문서화 성숙도 높음 |
| SQLite 드라이버 | Node.js 내장 `node:sqlite` (`DatabaseSync`) | Node 22.5+에서 제공되는 표준 내장 모듈. 동기 API로 DATA-MODEL.md의 `DEFERRABLE INITIALLY DEFERRED` 복합 FK를 하나의 트랜잭션 안에서 명확히 제어 가능(직접 검증 완료). 네이티브 컴파일이나 별도 패키지 설치가 전혀 필요 없어 `better-sqlite3`보다도 로컬 실행 단순성(NFR-6)에 부합. 이 개발 환경에 Xcode Command Line Tools가 없어 `better-sqlite3`의 node-gyp 네이티브 빌드가 실패하는 것을 확인하고 대안으로 전환함 |
| UI 프레임워크 | React + Vite | 빠른 로컬 dev server, production build 단순(`vite build`), Web Worker 등 향후 확장 여지 |
| 그래프 시각화 라이브러리 | Cytoscape.js | 방향성 그래프 레이아웃(dagre/breadthfirst), 엣지·노드 스타일 규칙 기반 지정(static/inferred 구분, FR-V5)에 적합. 서브그래프 단위 렌더링(FR-V6, Query-first)과 궁합이 좋음 |
| MCP 서버 | `@modelcontextprotocol/sdk` (공식 TypeScript SDK), stdio transport | AI 클라이언트(Claude Desktop 등)의 표준 로컬 연동 방식. 네트워크 서버가 아닌 stdio 기반이므로 NFR-6과 충돌 없음 |
| 테스트 프레임워크 | Vitest | TypeScript 네이티브, 모노레포 각 패키지에서 동일 설정 재사용, watch/CI 모두 빠름 |
| Lint / Format | ESLint + Prettier | TypeScript 생태계 표준 |
| Git 연동 | Node `child_process` + 로컬 `git` 바이너리 직접 호출 | 별도 라이브러리 의존성 없이 `git rev-parse`, `git diff --name-status` 등 필요한 명령만 실행. 네트워크 접근 없음 |

## 컨테이너 구성

ROADMAP.md 결정을 그대로 따른다: Docker Compose 서비스는 `api`(analyzer 내부 모듈 포함, SQLite 단독 소유, 분석 대상 저장소를 read-only 볼륨 마운트)와 `ui` 두 개뿐이다. SQLite는 별도 서비스가 아니다. MCP 서버는 컨테이너 서비스가 아니라 로컬 stdio 프로세스로 실행한다 — AI 클라이언트(Claude Desktop 등)가 로컬에서 `node packages/mcp/dist/index.js`를 기동해 api와 동일한 SQLite 파일을 읽기 전용으로 여는 것이 표준 MCP 연동 방식이다. `docker compose up`으로 만든 named volume(`contextsource-data`) 안의 DB 파일을 MCP가 직접 읽게 하려면 볼륨 마운트 경로를 로컬 `--db` 인자와 맞춰 구성한다.

## 대안 검토

- **pnpm/yarn**: 더 빠른 설치·엄격한 workspace 격리 장점이 있으나 별도 글로벌 설치가 필요해 "Docker 없이도 단순 실행" 기준에서 npm workspaces보다 불리해 채택하지 않음.
- **Fastify**: 성능 이점이 있으나 MVP 트래픽 규모에서 이점이 크지 않고 Express가 더 널리 알려져 있어 채택하지 않음.
- **better-sqlite3**: 성숙한 네이티브 바인딩이나 node-gyp 네이티브 빌드가 필요해 Xcode Command Line Tools 등 시스템 툴체인에 의존한다. 이 개발 환경에서 실제로 빌드가 실패했고, `node:sqlite`가 동일한 동기 API와 deferred FK 동작을 제공함을 확인하여 채택하지 않음.
- **sql.js**: WASM 기반이라 네이티브 빌드는 피할 수 있으나 파일 저장을 수동 직렬화해야 하는 오버헤드가 있어 `node:sqlite`보다 불리해 채택하지 않음.
- **vis-network / react-flow**: 그래프 레이아웃 커스터마이징과 대규모 노드 처리 성능에서 Cytoscape.js가 더 성숙하다고 판단.
- **Cypher 지원 그래프 DB(Neo4j 등)**: OQ-1 결정(SQLite 자체 스키마)과 배치 단순성 요구에 위배되어 제외.
