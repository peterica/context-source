# ADR-0004: Project Entity — Phase 2 착수 설계

- **상태**: 확정 (구현 진행)
- **날짜**: 2026-08-11
- **근거 문서**: `ROADMAP.md` Phase 2 "Project Knowledge Base", `PRD.md` 비목표("Project Entity — Phase 2")

## 배경

Phase 1(MVP)은 PRD가 명시한 대로 **단일 프로젝트** 분석기다. `project` 테이블은 이미 존재하지만 사실상 행이 하나뿐이고, HTTP API 서버와 MCP 서버 모두 기동 시점에 프로젝트 하나에 고정된다. 사용자가 여러 프로젝트를 등록하고, 프로젝트별 분석 이력·최신 revision을 한곳에서 관리하고 싶다는 요구가 나왔고, 이는 ROADMAP.md Phase 2의 "Project Entity(MVP의 `projectId` 속성을 검색·비교 가능한 독립 Entity로 승격)"와 정확히 일치한다.

이 ADR은 Phase 2의 첫 조각인 **Project Entity 자체**만 다룬다. 기술 스택 관리, 유사 프로젝트 탐색, 프로젝트 간 관계 분석은 Project Entity가 자리잡은 뒤의 후속 과제로 남긴다.

## 결정

### 1. 소스 접근 방식 — 상위 workspace 디렉터리 마운트

Docker 배포는 여러 프로젝트를 개별 볼륨으로 마운트하는 대신, **상위 workspace 디렉터리 하나**를 read-only로 마운트한다.

```yaml
volumes:
  - ${WORKSPACE_ROOT:-./samples}:/workspaces:ro
```

`api` 서버는 `--workspace-root`(env: `CONTEXTSOURCE_WORKSPACE_ROOT`)를 안다. 프로젝트 등록 시 사용자는 workspace 루트 기준 **상대 경로**만 지정하면 되고, 서버가 이를 절대 경로로 해석해 `project.root_path`/`project.tsconfig_path`에 **절대 경로로 저장**한다(기존 MVP의 `root_path` 저장 방식과 동일한 형태를 유지해 하위 호환을 단순하게 함). workspace root 개념은 등록 시점의 편의를 위한 것이고, 저장 후에는 프로젝트마다 독립적인 절대 경로만 사용한다.

등록 시 `path.relative(workspaceRoot, resolvedPath)`가 `..`로 시작하면 거부한다(경로 탈출 방지).

### 2. HTTP API — `/projects/{id}/...`로 재구성 (breaking change)

서버가 더 이상 프로젝트 하나에 고정되지 않으므로, 기존 flat 경로(`/entities`, `/project`, `/analysis/runs`)를 전부 `/projects/{projectId}/...` 하위로 옮긴다. API.md v1을 이 구조로 개정한다(별도 버전 분기 없음 — 아직 외부 소비자가 없고 우리가 만든 web/mcp만 이 API를 쓴다).

```
GET    /projects
POST   /projects
GET    /projects/{id}
PATCH  /projects/{id}
DELETE /projects/{id}

GET    /projects/{id}/entities
GET    /projects/{id}/entities/{encodedId}
GET    /projects/{id}/entities/{encodedId}/relationships
GET    /projects/{id}/entities/{encodedId}/callers
GET    /projects/{id}/entities/{encodedId}/callees
GET    /projects/{id}/entities/{encodedId}/subgraph
GET    /projects/{id}/stats
GET    /projects/{id}/inferred-relationships
POST   /projects/{id}/analysis/runs
GET    /projects/{id}/analysis/runs
GET    /projects/{id}/analysis/runs/{runId}
```

존재하지 않는 `{id}`는 404 `PROJECT_NOT_FOUND`.

### 3. MCP — 프로세스당 프로젝트 1개 유지

MCP tool 스키마는 바꾸지 않는다. AI 클라이언트 설정에서 프로젝트별로 별도 MCP 서버 항목을 등록해 `--project-id`로 구분한다(지금과 동일). 여러 프로젝트를 한 MCP 세션에서 오가는 기능은 Phase 2의 이번 단계 범위 밖이다 — "어떤 프로젝트를 이야기하는 중인지" 맥락이 항상 명확해야 한다는 원칙을 우선했다.

### 4. 스키마 변경 및 마이그레이션

`project` 테이블에 컬럼을 추가한다:

```sql
ALTER TABLE project ADD COLUMN tsconfig_path TEXT NOT NULL DEFAULT 'tsconfig.json';
ALTER TABLE project ADD COLUMN description TEXT;
ALTER TABLE project ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
```

`schema.ts`는 지금까지 `CREATE TABLE IF NOT EXISTS`만으로 충분했지만, 기존 컬럼 추가는 진짜 마이그레이션이 필요한 첫 사례다. SQLite 내장 `PRAGMA user_version`을 스키마 버전으로 사용한다(별도 테이블 불필요). `openDatabase`는 매 연결마다 `user_version`을 읽어 그보다 높은 번호의 마이그레이션을 순서대로 적용한다. 이 메커니즘은 Phase 3/4에서도 재사용한다.

### 5. Entity 모델에는 변화 없음

`entity.kind` enum에 `'project'`를 추가하지 않는다. Project는 지금처럼 별도 테이블로 남고 `entity.project_id`가 이를 참조하는 기존 구조를 그대로 쓴다 — PRD가 "Project는 Entity Kind가 아니다"라고 명시한 원칙을 유지한다. `project` 삭제 시 `entity`가 `ON DELETE CASCADE`로 연쇄 삭제되는 기존 제약도 그대로 활용한다(별도 정리 로직 불필요).

## 이번 단계에서 하지 않는 것

- 기술 스택 메타데이터 수집(OQ-9는 여전히 "Phase 2의 이후 과제"로 유지)
- 유사 프로젝트 탐색, 프로젝트 간 관계 분석
- MCP의 다중 프로젝트 tool 파라미터화
- Web UI의 프로젝트 간 비교 화면(목록/검색까지만)
