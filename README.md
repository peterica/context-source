ContextSource는 코드 관계를 중심으로 시스템을 이해하고, 장기적으로 AI를 위한 Context Platform을 구축하는 프로젝트이다.

[![CI](https://github.com/peterica/context-source/actions/workflows/ci.yml/badge.svg)](https://github.com/peterica/context-source/actions/workflows/ci.yml)

# ContextSource 핵심 정리

## 프로젝트 목적

ContextSource는 소스 코드를 **Entity, Relationship, Evidence**로 변환하여 사람이든 AI든 동일한 관계 모델로 시스템을 이해할 수 있도록 하는 **Code Relationship Analyzer**이다.

코드를 파일이나 디렉터리 단위가 아니라 **관계(Graph)** 중심으로 이해하는 것이 핵심이다.

---

## 핵심 가치

- 코드를 Graph로 변환
- 모든 관계는 Evidence를 통해 원본 코드로 추적
- 사람과 AI가 동일한 Context 공유
- Query 기반 코드 탐색
- 변경 영향도 분석
- Git Diff 기반 증분 분석
- 로컬 실행 지원

---

## 구현 상태

MVP(Phase 1, M1~M5)가 구현되어 있다. 상세 내용은 [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md)를 참고한다.

| 단계 | 내용 | 상태 |
|------|------|------|
| M1 | TypeScript Parser/Resolver, Entity/Relationship/Evidence 추출, 전체 분석 CLI | 완료 |
| M2 | SQLite Graph Schema, Query 엔진, HTTP API | 완료 |
| M3 | Git diff 기반 증분 분석 | 완료 |
| M4 | Web UI (탐색·영향 그래프·검토·이력) | 완료 |
| M5 | 읽기 전용 MCP 서버 | 완료 |
| Phase 2 | Project Entity — 여러 프로젝트 등록/검색/관리 ([ADR-0004](./docs/adr/0004-project-entity.md)) | 완료 |
| Phase 2 | 기술 스택 관리 — Language/Runtime/Framework/ORM/Database/Build Tool ([ADR-0005](./docs/adr/0005-tech-stack-management.md)) | 완료 |
| Phase 2 | 유사 프로젝트 탐색 / 프로젝트 간 관계 분석 — 기술 스택 태그 교집합 기반 ([ADR-0006](./docs/adr/0006-similar-project-discovery.md)) | 완료 |

## 아키텍처

```text
packages/
  core   Analyzer(Parser/Resolver) + SQLite Storage + Query 엔진 + 증분 분석 — 순수 로직, 네트워크 의존 없음
  cli    전체/증분 분석 CLI (JSON 출력 또는 SQLite 저장)
  api    HTTP Query API 서버 (Express) — core를 내부 모듈로 포함, SQLite 파일을 단독 소유
  mcp    읽기 전용 MCP 서버 (stdio) — core Query 엔진을 api와 동일하게 재사용
  web    Web UI (React + Vite + Cytoscape.js) — HTTP API만 호출
samples/demo-project   분석 대상 예시 TypeScript 프로젝트 (테스트·데모용)
docs/adr               주요 기술/설계 결정 기록
```

사람(Web UI → HTTP API)과 AI(MCP)가 동일한 `core` Query 엔진과 SQLite 스키마를 공유한다 (Shared Context 원칙).

## 로컬 실행

### Docker Compose

```bash
docker compose up --build
```

- `api`: http://localhost:9080/api/v1 — 기본적으로 `samples/`(여러 프로젝트를 담을 수 있는 상위 디렉터리)를 read-only로 마운트한다 (ADR-0004).
- `ui`: http://localhost:9090 — 접속 후 **"+ 새 프로젝트 등록"**으로 workspace-root 기준 상대 경로(예: `demo-project`)를 입력해 프로젝트를 등록한 뒤, 프로젝트를 열어 "전체 분석"을 실행한다.
- 여러 프로젝트를 담은 실제 디렉터리를 쓰려면: `WORKSPACE_ROOT=/absolute/path/to/your/projects docker compose up --build` — 그 아래의 각 프로젝트를 UI에서 상대 경로로 등록한다.
- 포트가 이미 사용 중이면 `API_PORT=9081 UI_PORT=9091 docker compose up --build`처럼 덮어쓴다.
- `api`/`ui` 모두 `docker compose ps`에서 healthcheck 상태(`healthy`/`unhealthy`)를 확인할 수 있다 — `api`는 `GET /health`로 SQLite 접근 가능 여부까지 확인하고, `ui`는 `GET /healthz`로 정적 파일 서버 프로세스 생존만 확인한다.

#### SQLite 백업/복구

분석 결과(Entity/Relationship/Evidence, 프로젝트 레지스트리)는 전부 `contextsource-data`라는 Docker named volume 안의 SQLite 파일 하나(`/app/data/contextsource.sqlite`)에 있다. `api` 서비스가 이 파일의 유일한 쓰기 주체이므로(ROADMAP.md), 백업은 파일 하나만 복사하면 된다.

```bash
# 백업 — api 컨테이너를 멈추지 않고, 파일을 통째로 복사한다(SQLite는 파일 잠금으로 안전함).
docker compose exec api node -e "require('node:fs').copyFileSync('/app/data/contextsource.sqlite', '/app/data/backup-$(date +%Y%m%d).sqlite')"
docker cp $(docker compose ps -q api):/app/data/backup-$(date +%Y%m%d).sqlite ./backup-$(date +%Y%m%d).sqlite

# 복구 — api를 멈춘 뒤 파일을 되돌리고 다시 올린다.
docker compose stop api
docker cp ./backup-YYYYMMDD.sqlite $(docker compose ps -q api):/app/data/contextsource.sqlite
docker compose start api
```

재분석은 언제든 다시 실행할 수 있으므로(Entity/Relationship은 분석의 산출물), 반드시 지켜야 하는 것은 **프로젝트 레지스트리(등록된 프로젝트 목록·기술 스택 태그)**다 — 이 부분은 재분석으로 복원되지 않는다.

### Docker 없이 실행

Node.js **22.5.0 이상**이 필요하다 (내장 `node:sqlite` 모듈, [ADR-0001](./docs/adr/0001-tech-stack.md)).

```bash
make setup      # npm install
make test       # core/api/mcp 단위·통합 테스트
make run-api    # 다중 프로젝트 API 서버 (workspace-root=samples/, 별도 터미널)
make run-web    # Web UI dev server (별도 터미널, http://localhost:5173)
make register-demo   # (run-api가 뜬 상태에서) samples/demo-project를 프로젝트로 등록
make run-mcp    # MCP 서버 (stdio) — AI 클라이언트가 이 명령을 직접 기동하도록 설정
```

Web UI(http://localhost:5173)에서 프로젝트를 열어 "전체 분석"을 실행하면 된다. `make register-demo` 대신 UI의
"+ 새 프로젝트 등록" 폼으로 직접 등록해도 된다.

프로젝트 레지스트리(ADR-0004)를 거치지 않고 CLI로 단일 프로젝트만 바로 분석·저장할 수도 있다:

```bash
make analyze              # samples/demo-project 전체 분석 → data/contextsource.sqlite
make analyze-incremental  # 같은 프로젝트 증분 분석 (Git 저장소일 때)

node packages/cli/dist/index.js analyze --tsconfig <path> --project-id <id> --db data/contextsource.sqlite --mode full
node packages/cli/dist/index.js analyze --tsconfig <path> --project-id <id> --db data/contextsource.sqlite --mode incremental
```

핵심 분석·저장·Query는 SQLite 파일과 로컬 `git` 바이너리만 사용하며 네트워크 연결 없이 동작한다 (NFR-6).

## MVP (Phase 1)

- 단일 TypeScript 프로젝트 분석
- Entity 추출
- Relationship 생성
- Evidence 연결
- Graph 저장
- Query API
- 관계 시각화
- AI Subgraph 제공

---

## 향후 로드맵

### Phase 1
Code Relationship Analyzer

### Phase 2
Project Knowledge Base

- Project Entity (MVP의 projectId 속성을 독립 Entity로 승격) — **구현됨**, [ADR-0004](./docs/adr/0004-project-entity.md)
- 프로젝트 검색 — **구현됨** (Web UI 프로젝트 목록 + 이름/기술 스택 검색)
- 기술 스택 관리(Language/Runtime/Framework/ORM/Database/Build Tool, package.json 기반 자동 감지) — **구현됨**, [ADR-0005](./docs/adr/0005-tech-stack-management.md)
- 유사 프로젝트 탐색 / 프로젝트 간 관계 분석 — **구현됨**, [ADR-0006](./docs/adr/0006-similar-project-discovery.md) (기술 스택 태그 교집합 기반. Vector Search나 Project 간 영속적인 그래프 관계는 쓰지 않는다 — Phase 3/4 범위와 명확히 구분)

Phase 2는 위 항목으로 완결되었다. 다음 단계는 벤치마크를 통한 완성도 개선이며, Phase 3/4 착수는 별도 승인 전까지 보류한다.

### Phase 3 (미착수)
Semantic Code Knowledge Base

- 코드 임베딩
- 유사 코드 검색
- Cross Project Recommendation

### Phase 4 (미착수)
AI Context Engine

- Graph + Vector Hybrid Search
- Context Builder
- MCP Context 확장 (기본 MCP Subgraph 조회는 Phase 1에서 제공)
- AI Context API

---

## 구현 전략

- Docker Compose 기반 로컬 실행 (api + ui 2개 서비스)
- SQLite 기반 Graph Schema (api에 임베디드, 별도 서비스 아님)
- Pinpoint와 유사한 Graph UI
- Web UI 우선
- Query-first Architecture
- Evidence-first Architecture
- Incremental Analysis

---

## 문서 구성
- README.md : 프로젝트 소개, 핵심 개념, 로컬 실행 방법
- PRD.md : MVP 요구사항
- ROADMAP.md : 장기 비전 및 확장 계획
- DATA-MODEL.md : SQLite Graph Schema (DDL) — 구현된 스키마와 100% 일치
- API.md : Query API 스펙 (HTTP + MCP)
- openapi.yaml : API.md의 HTTP API를 옮긴 OpenAPI 3.0 스펙 (기계 판독 가능, BENCHMARK.md 5.18)
- BENCHMARK.md : 유사 제품 벤치마킹 및 ContextSource 개선 과제
- BENCHMARK-PROMPT.md : 다른 프로젝트에 적용할 경쟁 벤치마킹 재사용 프롬프트
- docs/adr/ : 기술 스택·설계 결정 기록 (ADR)
- IMPLEMENTATION_REPORT.md : 구현 요약, 아키텍처, FR별 구현 상태, 테스트 결과, 알려진 제한사항

---

## 라이선스

[MIT License](./LICENSE) (2026-08-12부터 적용, BENCHMARK.md 5.19).
