# ADR-0005: 기술 스택 관리

- **상태**: 확정 (구현 진행)
- **날짜**: 2026-08-11
- **근거 문서**: `ROADMAP.md` Phase 2 "기술 스택 관리", `PRD.md` OQ-9(MVP에서는 수집하지 않음 — Phase 2 범위), [ADR-0004](./0004-project-entity.md)

## 배경

ADR-0004로 Project가 독립 Entity가 된 뒤, ROADMAP.md Phase 2의 다음 항목인 "기술 스택 관리"(Language/Runtime/Framework/ORM/Database/Build Tool)를 구현한다. OQ-9는 이를 명시적으로 Phase 2 범위로 미뤄뒀다.

## 결정

### 1. 스키마 — 정규화된 key-value 테이블

프로젝트당 여러 값을 가질 수 있는 카테고리(예: 여러 데이터베이스, 여러 빌드 도구)를 표현하기 위해 `project` 테이블에 고정 컬럼을 추가하는 대신 별도 테이블을 쓴다.

```sql
CREATE TABLE project_tech_stack (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN
               ('language','runtime','framework','orm','database','build_tool')),
  value      TEXT NOT NULL,
  PRIMARY KEY (project_id, category, value)
);
```

새 테이블이라 `CREATE TABLE IF NOT EXISTS`만으로 기존 DB에도 안전하게 적용된다 — ADR-0004처럼 컬럼을 추가하는 것이 아니므로 `ALTER TABLE` 마이그레이션이 필요 없다.

카테고리를 6종으로 고정한 이유: ROADMAP.md가 든 예시(Language/Runtime/Framework/ORM/Database/Build Tool)를 그대로 따른다. 더 세분화하거나 자유 텍스트 카테고리를 허용하지 않는다 — PRD에 없는 개념을 임의로 확장하지 않는다는 원칙(claude-do.md)을 이어간다.

### 2. 자동 감지 — package.json 휴리스틱

ContextSource는 TypeScript/Node.js 프로젝트만 분석하므로, 등록된 프로젝트마다 다음을 항상 감지한다.

- `language: TypeScript`, `runtime: Node.js` — 항상 고정으로 추가된다.
- `dependencies`/`devDependencies`에 알려진 패키지 이름이 있으면 매핑한다(예: `react`→`framework: React`, `@nestjs/core`→`framework: NestJS`, `typeorm`/`prisma`→`orm`, `pg`/`mysql2`/`mongodb`→`database`, `vite`/`webpack`→`build_tool`). 매핑 목록은 의도적으로 짧고 명시적이다 — 완전한 패키지 생태계 커버리지가 목표가 아니라, 등록 직후 유용한 기본값을 무료로 제공하는 것이 목표다.
- `package.json`은 `tsconfigPath`가 있는 디렉터리에서 찾고, 없으면 `rootPath`에서 찾는다(모노레포에서 tsconfig가 하위 패키지에 있는 경우를 고려).
- 자동 감지는 **병합(merge)** 이다 — 재실행해도 사용자가 수동으로 추가한 항목을 지우지 않는다(`INSERT OR IGNORE`, 기본 키가 (project_id, category, value)라 중복도 자연히 무시됨).

### 3. API — 개별 추가/삭제 + 일괄 감지

칩(chip) 기반 UI와 자연스럽게 맞도록 전체 목록을 통째로 교체하는 대신 개별 추가/삭제를 기본으로 한다.

```
GET    /projects/{id}/tech-stack                body 없음 → { items: [{category, value}] }
POST   /projects/{id}/tech-stack   { category, value }   → 추가 (idempotent)
DELETE /projects/{id}/tech-stack   { category, value }   → 삭제
POST   /projects/{id}/tech-stack/detect                  → package.json에서 감지해 병합, { items, added } 반환
```

### 4. 하지 않는 것

- 기술 스택 기반 프로젝트 검색/유사 프로젝트 탐색(ROADMAP Phase 2의 다음 항목)은 이번 범위가 아니다 — 검색 가능한 데이터를 만드는 것까지가 이번 목표다.
- npm 레지스트리 조회나 버전 파싱은 하지 않는다(패키지 이름 매핑만, 로컬 파일만 읽음 — 네트워크 호출 없음, NFR-6 유지).
- Java/Spring 등 비-TypeScript 스택 감지는 하지 않는다 — PRD 비목표(다중 언어 지원 제외)와 일치.
