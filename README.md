ContextSource는 코드 관계를 중심으로 시스템을 이해하고, 장기적으로 AI를 위한 Context Platform을 구축하는 프로젝트이다.

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

- `api`: http://localhost:8080/api/v1 (기본적으로 `samples/demo-project`를 read-only로 분석 대상 마운트)
- `ui`: http://localhost:5173 — 접속 후 우측 상단 "전체 분석" 버튼으로 최초 분석을 실행한다.
- 다른 프로젝트를 분석하려면: `ANALYZE_TARGET=/absolute/path/to/project TSCONFIG_PATH=tsconfig.json docker compose up --build`

### Docker 없이 실행

Node.js **22.5.0 이상**이 필요하다 (내장 `node:sqlite` 모듈, [ADR-0001](./docs/adr/0001-tech-stack.md)).

```bash
make setup      # npm install
make test       # core/api/mcp 단위·통합 테스트
make analyze    # samples/demo-project 전체 분석 → data/contextsource.sqlite
make run-api    # HTTP API 서버 (별도 터미널)
make run-web    # Web UI dev server (별도 터미널, http://localhost:5173)
make run-mcp    # MCP 서버 (stdio) — AI 클라이언트가 이 명령을 직접 기동하도록 설정
```

CLI를 직접 사용할 수도 있다:

```bash
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

- Project Entity (MVP의 projectId 속성을 독립 Entity로 승격)
- 기술 스택 관리
- 프로젝트 검색
- 유사 프로젝트 탐색

### Phase 3
Semantic Code Knowledge Base

- 코드 임베딩
- 유사 코드 검색
- Cross Project Recommendation

### Phase 4
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
- BENCHMARK.md : 유사 제품 벤치마킹 및 ContextSource 개선 과제
- BENCHMARK-PROMPT.md : 다른 프로젝트에 적용할 경쟁 벤치마킹 재사용 프롬프트
- docs/adr/ : 기술 스택·설계 결정 기록 (ADR)
- IMPLEMENTATION_REPORT.md : 구현 요약, 아키텍처, FR별 구현 상태, 테스트 결과, 알려진 제한사항
