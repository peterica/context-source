# ADR-0011: 사각지대 측정 — `unresolved_reference` (BENCHMARK.md 5.5)

- **상태**: 채택, 구현 완료 (2026-08-12 — core/storage/api/web UI 전 단계, IMPLEMENTATION_REPORT.md §19)
- **날짜**: 2026-08-12
- **근거 문서**: BENCHMARK.md 5.5, PRD.md 4.2·OQ-11, DATA-MODEL.md §3, IMPLEMENTATION_REPORT.md §10

## 배경

지금 analyzer는 호출/import/상속 관계를 발견했지만 대상을 확정하지 못하면 그 사실 자체를 조용히 버린다. `packages/core/src/analyzer/resolve-relationships.ts`의 4개 pending-task 분기(`call`/`import`/`dynamic-import`/`heritage`) 모두 대상 해석에 실패하면 `push(...)` 없이 그냥 `continue`한다 — 사용자는 그래프에 없는 관계가 "존재하지 않아서 없는지" "분석기가 놓쳐서 없는지" 구분할 방법이 없다.

BENCHMARK.md 5.5는 이걸 `resolution: 'unresolved'`라는 3번째 값으로 표시하자고 제안한다. 이 ADR은 그 제안을 그대로 구현하지 않는다 — 왜 안 되는지, 대신 무엇을 하는지를 설계한다.

## 결정 1 — `relationship.resolution`에 `'unresolved'`를 추가하지 않는다

`relationship` 테이블은 `target_id TEXT NOT NULL REFERENCES entity(id)` 제약을 갖는다(DATA-MODEL.md §3.1) — Relationship은 **반드시 두 Entity를 잇는 그래프 간선**이어야 한다는 게 이 스키마의 근본 불변식이다. 그런데 "대상을 확정하지 못했다"는 정의상 **가리킬 target Entity가 없다**는 뜻이다 — `target_id`에 넣을 값 자체가 없다.

`target_id`를 nullable로 바꾸는 것은 겉보기보다 훨씬 큰 변경이다: `subgraph.ts`의 recursive CTE, `impact.ts`의 BFS(`target_id`로 조인), `relationship-queries.ts`의 caller/callee 조회, `reverse-imports.ts`의 역방향 import 추적, MCP tool 5개, Web UI의 모든 관계 렌더링(`EvidencePanel`이 `targetLabel`을 항상 요구) — Relationship이 항상 유효한 두 Entity를 잇는다는 가정을 코드베이스 전체가 하고 있다. 이 가정을 깨면서 얻는 이득이 "사각지대를 보여준다"는 것뿐이라면, 위험 대비 이득이 맞지 않는다.

**그러므로**: `relationship` 테이블과 `Resolution` 타입(`static`/`inferred`)은 전혀 건드리지 않는다. 기존 모든 Query/그래프 순회 코드는 이 ADR로 인해 단 한 줄도 바뀌지 않는다.

## 결정 2 — 별도 테이블 `unresolved_reference`로 기록한다 (Relationship이 아니다)

"발견했지만 확정 못함"을 **Relationship이 아니라 진단 기록**으로 취급한다 — Evidence는 있지만 target Entity는 없는, 그래프 순회에는 전혀 참여하지 않는 별도 테이블이다.

```sql
CREATE TABLE unresolved_reference (
  id          TEXT PRIMARY KEY,                 -- 결정적 해시(evidence id와 같은 방식) — FR-A4와 동일한 안정성
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('CALLS','IMPORTS','IMPLEMENTS','EXTENDS')),
  reason      TEXT NOT NULL CHECK (reason IN (
                'entity-not-extracted',        -- 선언은 우리 프로젝트 소스에 있지만 Entity로 추출되지 않음 (interface 멤버 등, ADR-0002 §2)
                'ambiguous-callable-type',      -- 호출 가능 타입의 시그니처가 0개 또는 2개 이상이라 대상을 하나로 못 좁힘
                'internal-path-not-in-project', -- 모듈 경로는 해석됐지만 tsconfig include 밖이라 분석 대상이 아님
                'unresolvable-specifier'        -- import specifier 자체를 해석하지 못함 (경로 별칭 오류 등)
              )),
  file_path   TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  start_col   INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  end_col     INTEGER NOT NULL,
  snippet     TEXT NOT NULL,
  analyzer    TEXT NOT NULL,
  revision    TEXT NOT NULL
);
CREATE INDEX idx_unresolved_project ON unresolved_reference(project_id);
CREATE INDEX idx_unresolved_source ON unresolved_reference(source_id);
```

`source_id`가 `entity(id) ON DELETE CASCADE`를 참조하므로 기존 증분 재분석의 삭제 경로(`deleteEntitiesByFilePaths`, `replaceProjectGraph`의 `DELETE FROM entity`)가 손대지 않아도 이 테이블 행이 자동으로 함께 정리된다 — relationship/evidence가 이미 이 패턴으로 cascade 삭제되는 것과 완전히 같은 방식이라 incremental-runner의 삭제 로직을 새로 만들 필요가 없다.

## 결정 3 — 무엇을 "사각지대"로 기록할지: 프로젝트 내부 대상만, 외부/ambient는 제외

모든 실패한 해석을 다 기록하면 신호가 소음에 묻힌다 — 실제 코드베이스에서 `console.log`, `Array.prototype.map` 같은 ambient/외부 API 호출이 압도적으로 많고, 이런 건 애초에 PRD OQ-11이 "외부 심볼에 대한 CALLS는 저장하지 않는다"고 이미 결정한 영역이다(비목표: 외부 코드 분석). Relationship을 안 만드는 것과 대칭적으로, 이런 경우는 `unresolved_reference`에도 기록하지 않는다.

**기록 조건**(모두 "우리 프로젝트 자신의 소스 범위 안에서" 실패한 경우로 한정):

| kind | 기록하는 경우 | 기록하지 않는 경우 |
|------|--------------|-------------------|
| `CALLS` | 선언이 `rootFileSet`(우리 프로젝트 소스) 안에 있는데 Entity로 추출 안 됨(`entity-not-extracted` — interface 멤버, computed 이름, 익명 클래스 등 §10 기존 한계) / 호출 가능 타입의 시그니처가 0개·2개 이상(`ambiguous-callable-type` — 제네릭 콜백 등) | 선언이 `rootFileSet` 밖(외부 패키지, ambient lib) — OQ-11과 동일한 경계 |
| `IMPORTS` | 모듈 경로가 내부로 해석됐지만 tsconfig `include` 밖(`internal-path-not-in-project`) / specifier 자체 해석 실패(`unresolvable-specifier`) | 외부 패키지로 해석됨(이미 ExternalModule Entity로 성공 처리됨) |
| `IMPLEMENTS`/`EXTENDS` | 선언이 `rootFileSet` 안인데 Entity로 추출 안 됨(`entity-not-extracted` — 보통은 클래스/인터페이스라 거의 항상 추출되지만, mixin 함수나 타입 별칭을 base로 쓰는 등 예외적인 경우 CALLS와 같은 `classifyUnregisteredDecl` 판정을 그대로 재사용해 `ambiguous-callable-type`도 나올 수 있다) | 외부 base class/interface(`class X extends Error`, 외부 라이브러리 인터페이스 구현 등) — 매우 흔해서 기록하면 소음만 늘어남, OQ-11과 같은 경계를 적용 |

`dynamic-import`의 computed specifier(`import(someVariable)`처럼 문자열 리터럴이 아닌 경우)는 애초에 어떤 이름도 알 수 없어 `unresolvable-specifier`로 기록한다.

## 결정 4 — 조회: Review 탭 확장 + stats 카운트, 새 탭 만들지 않는다

이미 M4가 만든 "검토" 탭이 `inferred` 관계(확신도 낮은 관계, 낮은 confidence 우선)를 검토하는 화면이다 — `unresolved_reference`도 "사용자가 확인해야 할 분석 한계"라는 같은 성격이므로 같은 탭에 두 번째 섹션으로 추가한다. 새 탭/라우팅을 만들지 않는다.

- `GET /projects/{id}/stats` 응답에 `unresolvedReferences: { total, byKind, byReason }`를 추가한다 — Overview 화면에서 "이 그래프는 완전하지 않을 수 있다"를 한눈에 보여주는 신호로 쓴다(BENCHMARK 5.5의 핵심 목적).
- `GET /projects/{id}/unresolved-references?limit=&offset=`(기존 `inferred-relationships` endpoint와 같은 페이지네이션 관례) — Review 탭이 이 목록을 가져와 `entity-not-extracted`/`ambiguous-callable-type`/`internal-path-not-in-project`/`unresolvable-specifier`별로 묶어 보여주고, 각 항목의 Evidence 스니펫을 그대로 노출한다(기존 `EvidencePanel` 패턴 재사용).

## 하지 않는 것

- `relationship.resolution`에 `'unresolved'`를 추가하지 않는다(결정 1) — 기존 그래프 순회/Query/MCP/Web UI 코드는 전혀 바뀌지 않는다.
- `unresolved_reference`는 subgraph/impact 등 어떤 그래프 순회에도 참여하지 않는다 — 순수 진단/측정 데이터다.
- 외부 패키지·ambient 선언에 대한 실패는 기록하지 않는다(결정 3) — OQ-11의 기존 경계를 그대로 따른다.
- MCP tool로 노출하지 않는다 — ADR-0008과 같은 이유로, Web UI 검토 탭에서 먼저 실제로 쓸모가 검증된 뒤 별도로 판단한다.
- "이 unresolved를 자동으로 해소해보려는" 휴리스틱(예: 이름이 같으면 추측 연결)을 추가하지 않는다 — false positive를 만들지 않는다는 기존 원칙과 정면으로 배치된다.

## 재검토 조건

Review 탭에서 실제로 쓰다가 특정 `reason`(예: `entity-not-extracted`의 interface 멤버 비중)이 압도적으로 많다는 게 확인되면, "그 reason을 아예 없애는" 근본 수정(예: interface 멤버를 Entity로 승격)을 별도 ADR로 검토한다 — `unresolved_reference`는 그런 후속 결정을 위한 실측 데이터를 만드는 것이 목적이지, 영구히 남기려는 상태가 아니다.

## 구현 순서 (제안)

1. `id.ts`에 `unresolvedReferenceId()` 추가, DATA-MODEL.md에 테이블 정의 + schema.sql 반영, `schema-integrity.test.ts`에 제약 테스트 추가.
2. `resolve-relationships.ts`의 4개 분기에 결정 3의 규칙대로 "기록" 경로 추가, `AnalysisResult`에 `unresolvedReferences` 필드 추가. 골든 fixture(`callback-hof`, `dependency-injection`, `dynamic-import` 등 이미 실패 케이스를 담고 있는 fixture들)의 `golden.json`을 재생성해 새 필드를 검증.
3. `storage/ingest.ts`에 `insertUnresolvedReferences()`, `replaceProjectGraph`/`incremental-runner.ts`에 배선.
4. `query/stats.ts`에 `unresolvedReferences` 집계 + `listUnresolvedReferences()`, API 라우트 2개(`GET .../stats` 확장, `GET .../unresolved-references` 신규) + 통합 테스트.
5. Web UI: Review 탭에 섹션 추가, Overview에 카운트 배지. Playwright로 실제 브라우저 검증.
6. API.md/openapi.yaml/DATA-MODEL.md/IMPLEMENTATION_REPORT.md 갱신, BENCHMARK.md 5.5를 [해결됨]으로 표시.
