# ContextSource Data Model (SQLite DDL)

- **문서 버전**: 0.1 (Draft)
- **근거 문서**: [PRD.md](./PRD.md) 4장(도메인 모델), 10장(OQ 결정)
- **저장소**: SQLite 단일 파일, api 서비스가 단독 소유 (OQ-1, C7 결정)
- **구현 상태**: 아래 DDL은 `packages/core/src/storage/schema.ts`에 그대로 적용되어 있다(문자 그대로 동일). 드라이버는 `better-sqlite3`가 아니라 Node.js 내장 `node:sqlite`이며, deferred FK 동작을 포함해 이 문서의 설계를 그대로 만족함을 테스트로 검증했다 (ADR-0001, `packages/core/test/schema-integrity.test.ts`).
- **Phase 2 확장**: `project` 테이블은 [ADR-0004](./docs/adr/0004-project-entity.md)에서 `tsconfig_path`/`description`/`updated_at` 컬럼이 추가되어 여러 프로젝트를 검색·비교 가능한 독립 레코드로 관리한다(더 이상 단일 행 전제가 아님). 기존 DB는 `PRAGMA user_version` 기반 마이그레이션(`packages/core/src/storage/migrations.ts`)이 연결 시점에 자동으로 컬럼을 채운다. [ADR-0005](./docs/adr/0005-tech-stack-management.md)로 `project_tech_stack` 테이블이 추가되어 프로젝트별 Language/Runtime/Framework/ORM/Database/Build Tool을 관리한다(새 테이블이라 마이그레이션 불필요). [ADR-0006](./docs/adr/0006-similar-project-discovery.md)의 유사 프로젝트 탐색은 `project_tech_stack`을 조회 시점에 집합 연산(교집합)만 수행하며, 새 테이블이나 컬럼을 추가하지 않는다 — Project 간 관계를 스키마에 영속화하지 않는다.

이 문서는 PRD에 확정된 도메인 모델을 그대로 스키마로 옮긴 것이다. PRD에 없는 개념을 추가하지 않는다.

---

## 1. Entity ID 규칙 (OQ-2)

`id`는 사람이 읽을 수 있는 문자열로 하며, 다음 형식을 따른다.

| Kind | 형식 | 예시 |
|------|------|------|
| File | `{projectId}/file:{filePath}` | `p1/file:src/payment/service.ts` |
| Class, Interface, Function, Method | `{projectId}/sym:{filePath}#{symbolPath}` | `p1/sym:src/payment/service.ts#PaymentService.charge` |
| ExternalModule | `{projectId}/ext:{packageName}` | `p1/ext:lodash` |

규칙:

- `filePath`는 프로젝트 루트 기준 상대 경로, `/` 구분자로 정규화한다.
- `symbolPath`는 중첩 심볼을 `.`으로 연결한다 (예: `PaymentService.charge`, 중첩 함수 `outer.inner`).
- 같은 파일 내 라인 이동은 id에 영향 없다. 파일 이동·심볼 이름 변경은 새 id다 (FR-A4).
- 오버로드는 구현 시그니처 기준 단일 Entity이므로 symbolPath 하나로 유일하다.
- `packageName`은 package.json의 패키지 이름 그대로 사용한다 (스코프 포함, 예: `@nestjs/core`).

---

## 2. DDL

```sql
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────
-- project: Phase 1 MVP는 단일 행 전제였으나(OQ-8), Phase 2(ADR-0004)에서
-- 여러 프로젝트를 등록·검색·비교하는 독립 레코드로 확장했다.
-- Entity의 project_id 소속(Relationship 아님) 원칙은 그대로다.
-- ─────────────────────────────────────────────
CREATE TABLE project (
  id            TEXT PRIMARY KEY,           -- 예: 'demo' (kebab-case, 이름에서 자동 생성 가능)
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,              -- 절대 경로. 분석 대상 저장소 위치
  tsconfig_path TEXT NOT NULL DEFAULT 'tsconfig.json',  -- 절대 경로
  description   TEXT,                       -- nullable
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────
-- project_tech_stack: ADR-0005 (Phase 2 "기술 스택 관리")
-- ─────────────────────────────────────────────
CREATE TABLE project_tech_stack (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN
               ('language','runtime','framework','orm','database','build_tool')),
  value      TEXT NOT NULL,

  PRIMARY KEY (project_id, category, value)
);

-- ─────────────────────────────────────────────
-- entity: PRD 4.1
-- ─────────────────────────────────────────────
CREATE TABLE entity (
  id         TEXT PRIMARY KEY,              -- 1장 ID 규칙
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN
               ('file','class','interface','function','method','external_module')),
  name       TEXT NOT NULL,                 -- 심볼 이름 / 파일명 / 패키지 이름
  file_path  TEXT,                          -- external_module만 NULL (PRD 4.1)
  start_line INTEGER,                       -- file은 1, external_module은 NULL
  end_line   INTEGER,
  revision   TEXT,                          -- 분석 시점 git revision

  -- external_module만 위치·revision을 갖지 않는다 (PRD 4.1)
  CHECK ((kind = 'external_module') = (file_path IS NULL)),
  CHECK (
    (kind = 'external_module' AND start_line IS NULL AND end_line IS NULL AND revision IS NULL)
    OR
    (kind <> 'external_module' AND start_line IS NOT NULL AND end_line IS NOT NULL
      AND revision IS NOT NULL AND start_line > 0 AND end_line >= start_line)
  )
);

CREATE INDEX idx_entity_name ON entity(name);            -- FR-Q2 이름 검색
CREATE INDEX idx_entity_kind ON entity(kind);            -- FR-Q2 종류 검색
CREATE INDEX idx_entity_file ON entity(file_path);       -- FR-Q2 경로 검색, FR-A6 증분 삭제

-- ─────────────────────────────────────────────
-- relationship: PRD 4.2
-- ─────────────────────────────────────────────
CREATE TABLE relationship (
  id         TEXT PRIMARY KEY,              -- 예: UUID 또는 'type:source->target' 해시
  type       TEXT NOT NULL CHECK (type IN
               ('DECLARES','IMPORTS','CALLS','IMPLEMENTS','EXTENDS')),
  source_id  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  resolution TEXT NOT NULL CHECK (resolution IN ('static','inferred')),
  confidence REAL NOT NULL CHECK (confidence > 0.0 AND confidence <= 1.0),

  -- Evidence 없는 Relationship 저장 불가를 스키마로 강제 (PRD 4.2, 성공 지표)
  primary_evidence_id TEXT NOT NULL,

  -- 같은 (type, source, target) 쌍은 관계 1건 + Evidence N건으로 표현
  UNIQUE (type, source_id, target_id),

  -- NFR-5: static은 확정 관계이므로 confidence는 항상 1.0
  CHECK (resolution <> 'static' OR confidence = 1.0),

  -- primary Evidence는 존재할 뿐 아니라 반드시 이 Relationship 소유여야 한다.
  FOREIGN KEY (primary_evidence_id, id)
    REFERENCES evidence(id, relationship_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_rel_source ON relationship(source_id, type);  -- callee, 정방향 탐색
CREATE INDEX idx_rel_target ON relationship(target_id, type);  -- caller, 역방향 탐색

-- ─────────────────────────────────────────────
-- evidence: PRD 4.3
-- ─────────────────────────────────────────────
CREATE TABLE evidence (
  id              TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES relationship(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  start_line      INTEGER NOT NULL,
  start_col       INTEGER NOT NULL,
  end_line        INTEGER NOT NULL,
  end_col         INTEGER NOT NULL,
  snippet         TEXT NOT NULL,
  analyzer        TEXT NOT NULL,            -- 버전 포함, 예: 'ts-analyzer@0.1.0'
  revision        TEXT NOT NULL,

  -- relationship의 복합 FK가 Evidence 소유권까지 검증할 수 있게 한다.
  UNIQUE (id, relationship_id)
);

CREATE INDEX idx_evidence_rel ON evidence(relationship_id);

-- ─────────────────────────────────────────────
-- analysis_run: FR-A6/A7/A8 실행 이력 및 실패 보고
-- ─────────────────────────────────────────────
CREATE TABLE analysis_run (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('full','incremental')),
  revision      TEXT NOT NULL,              -- 분석한 revision
  base_revision TEXT,                       -- incremental일 때 diff 기준 revision
  status        TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  entity_count       INTEGER,
  relationship_count INTEGER,

  CHECK ((mode = 'incremental') = (base_revision IS NOT NULL))
);

-- FR-A8: 파일 단위 실패는 전체를 중단시키지 않고 여기에 기록
CREATE TABLE analysis_failure (
  run_id             TEXT NOT NULL REFERENCES analysis_run(id) ON DELETE CASCADE,
  file_path          TEXT NOT NULL,
  message            TEXT NOT NULL,
  preserved_revision TEXT,                  -- 기존 graph data가 없으면 NULL

  PRIMARY KEY (run_id, file_path)
);
```

`PRAGMA foreign_keys`는 SQLite 데이터베이스 파일의 영구 설정이 아니라 **connection별 설정**이다. 애플리케이션은 connection을 생성할 때마다 `PRAGMA foreign_keys = ON`을 실행하고 활성화 여부를 검증해야 한다. 마이그레이션에서 한 번 실행하는 것만으로는 충분하지 않다.

---

## 3. 무결성 설계 노트

### 3.1 "Evidence 없는 Relationship 0건"의 스키마 강제

성공 지표가 요구하는 스키마 수준 강제는 순환 FK + deferred 제약으로 구현한다.

- `relationship.(primary_evidence_id, id)`는 `evidence.(id, relationship_id)`를 참조한다. 따라서 primary Evidence가 존재하는 것뿐 아니라 해당 Relationship에 속한다는 사실도 강제한다.
- 복합 FK가 `DEFERRABLE INITIALLY DEFERRED`이므로 같은 트랜잭션 안에서 relationship → evidence 순서로 INSERT하고 COMMIT 시점에 검증된다.

```sql
BEGIN;
INSERT INTO relationship (id, type, source_id, target_id, resolution, confidence, primary_evidence_id)
VALUES ('r1', 'CALLS', 'p1/sym:src/a.ts#run', 'p1/sym:src/b.ts#helper', 'static', 1.0, 'e1');
INSERT INTO evidence (id, relationship_id, file_path, start_line, start_col, end_line, end_col, snippet, analyzer, revision)
VALUES ('e1', 'r1', 'src/a.ts', 12, 3, 12, 14, 'helper()', 'ts-analyzer@0.1.0', 'abc1234');
COMMIT;  -- 여기서 FK 검증. evidence가 없으면 COMMIT 실패
```

- 마지막(primary) Evidence를 직접 삭제하려는 시도는 `relationship.primary_evidence_id` FK 위반으로 거부된다. Relationship을 삭제하면 Evidence가 CASCADE로 함께 삭제되므로 정상 경로는 막히지 않는다.

### 3.2 증분 분석 시 삭제 경로 (FR-A6)

재분석 대상 파일 집합 `F` (변경 파일 + 역방향 IMPORTS 1단계)를 먼저 분석하고, 성공 집합 `F_success`와 실패 집합 `F_failure`로 나눈다. 결과는 메모리 또는 staging에 준비하며 기존 데이터를 먼저 삭제하지 않는다.

```sql
BEGIN;
-- 분석에 성공한 파일만 교체한다. F_failure의 기존 데이터는 보존한다.
-- relationship(양방향 CASCADE) → evidence(CASCADE)가 연쇄 삭제된다
DELETE FROM entity WHERE file_path IN (/* F_success */);
-- 준비한 F_success 결과를 INSERT
COMMIT;
```

Git에서 삭제된 파일은 분석 성공 여부와 무관한 명시적 삭제 대상으로 처리한다. 파싱 실패 등 `F_failure`는 `analysis_failure`에 `preserved_revision`과 함께 기록한다. 직전 run의 실패 파일은 Git diff에 다시 나타나지 않더라도 다음 incremental의 `F`에 반드시 포함하여 stale 데이터가 영구히 남지 않게 한다.

역방향 1단계 파일 집합은 다음으로 구한다:

```sql
SELECT DISTINCT src.file_path
FROM relationship r
JOIN entity src ON src.id = r.source_id
JOIN entity tgt ON tgt.id = r.target_id
WHERE r.type = 'IMPORTS'
  AND tgt.file_path IN (/* 변경된 파일 */);
```

### 3.3 confidence 스케일 (PRD 4.2의 구체화)

- 범위: `0.0 < confidence <= 1.0` (REAL)
- `static`은 CHECK 제약으로 항상 `1.0`
- `inferred`의 초기 규약: analyzer가 판단 근거 유형별로 고정값을 부여한다 (예: 인터페이스 타입 기반 호출 추정 0.8, 동적 접근 0.5). 값 자체보다 **같은 근거 유형 = 같은 값** 규약이 중요하다.

---

## 4. Query 구현 참조 — depth 제한 서브그래프 (FR-Q4)

NFR-4(1초 응답)의 실현 가능성을 보이기 위한 참조 구현. 정방향(`out`) 기준이며, 역방향(`in`)은 `source_id`/`target_id`를 바꾸고, `both`는 두 CTE의 UNION이다.

```sql
WITH RECURSIVE walk(entity_id, depth) AS (
  SELECT :root_id, 0
  UNION
  SELECT r.target_id, w.depth + 1
  FROM walk w
  JOIN relationship r ON r.source_id = w.entity_id
  WHERE w.depth < :max_depth
    AND (:types IS NULL OR r.type IN (SELECT value FROM json_each(:types)))
)
SELECT e.* FROM entity e JOIN (SELECT DISTINCT entity_id FROM walk) w
  ON e.id = w.entity_id;
```

방문 노드가 `maxNodes`를 초과하면 API 계층에서 잘라내고 `truncated: true`를 반환한다 (FR-AI3).

---

## 5. PRD 추적표

| 스키마 요소 | 근거 |
|-------------|------|
| entity.kind 6종 (Module 없음, ExternalModule 포함) | PRD 4.1, OQ-7, OQ-11 |
| entity.project_id 속성 (Relationship 아님) | PRD 4.1, OQ-8 |
| ExternalModule의 위치/revision NULL 허용 CHECK | PRD 4.1 |
| relationship 5종 + resolution + confidence | PRD 4.2 |
| primary_evidence_id NOT NULL (deferred) | PRD 4.2 "Evidence 없는 Relationship 저장 불가", 성공 지표 |
| static → confidence 1.0 CHECK | NFR-5 |
| analysis_run / analysis_failure | FR-A6, A7, A8 |
| idx_rel_source / idx_rel_target | FR-Q3 caller·callee, NFR-4 |
