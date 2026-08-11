# ContextSource PRD (Product Requirements Document)

- **문서 버전**: 0.1 (Draft)
- **작성일**: 2026-08-01
- **상태**: MVP(Phase 1, M1~M5) 구현 완료 — FR별 구현 상태와 알려진 제한사항은 [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md) 참고. Phase 2 착수: Project Entity는 [ADR-0004](./docs/adr/0004-project-entity.md)로 이 PRD의 범위(단일 프로젝트) 밖에서 별도 확장됨 — 이 문서의 MVP 범위 자체는 변경되지 않았다.
- **관련 문서**: [INIT.md](./INIT.md)

---

## 1. 개요 (Overview)

## 1.1 제품 정의

ContextSource는 소스 코드를 **Entity**, **Relationship**, **Evidence**로 변환하여 시스템 구조를 이해하는 **코드 관계 분석 시스템(Code Relationship Analyzer)** 이다.

MVP는 **단일 프로젝트의 코드 관계를 분석하고 탐색하는 것**을 목표로 한다.

장기적으로는 관계 데이터를 기반으로 **Project Knowledge Base**, **Semantic Code Knowledge Base**, **AI Context Engine**으로 확장한다.

```text
Phase 1
Source Code
    ↓
Entity + Relationship + Evidence
    ↓
Relationship Query
    ↓
Visualization

Phase 2
Project Knowledge Base

Phase 3
Semantic Code Knowledge Base

Phase 4
AI Context Engine
```

### 1.2 배경 및 문제 정의

| # | 문제 | 현재 상황 |
|---|------|-----------|
| P1 | 코드 이해가 파일 단위에 갇혀 있다 | 개발자는 파일 트리와 텍스트 검색으로 구조를 유추하며, 호출/의존 관계는 머릿속에서 재구성한다 |
| P2 | AI가 질문마다 전체 소스를 다시 읽는다 | 같은 코드베이스에 대한 질문이라도 매번 대량의 코드를 컨텍스트에 넣어 추론하며, 결과가 일관되지 않고 비용이 크다 |
| P3 | 변경 영향 범위를 사전에 파악하기 어렵다 | 함수/클래스 수정 시 영향을 받는 호출자를 수작업(grep, IDE 참조 찾기)으로 추적한다 |
| P4 | 분석 결과의 근거를 추적할 수 없다 | AI나 도구가 "A가 B를 호출한다"고 답해도, 그 판단의 근거가 되는 코드 위치를 확인할 수 없다 |
| P5 | 사람과 AI가 서로 다른 모델로 코드를 이해한다 | 사람은 IDE, AI는 텍스트 청크를 보므로 동일한 구조 인식을 공유하지 못한다 |

### 1.3 해결 방향

- 파일이 아니라 **관계를 중심으로** 코드를 이해한다.
- 소스를 미리 분석하여 Entity, Relationship, Evidence로 **축적**한다.
- "무엇이 무엇을 호출하는가?"를 **Query로 탐색**한다.
- 변경 영향 범위를 **관계 그래프로 시각화**한다.
- 사람과 AI가 **동일한 관계 모델**을 공유한다.

관계 데이터는 원본 코드를 대체하지 않는다. 시스템 구조를 빠르게 탐색하기 위한 **인덱스이자 공통 컨텍스트**이며, 모든 분석 결과는 Evidence를 통해 원본 코드로 추적 가능해야 한다.

---

## 2. 목표 및 비목표 (Goals / Non-Goals)

### 2.1 목표

1. TypeScript 코드베이스에서 Entity와 Relationship을 자동 추출한다.
2. 모든 Relationship에 원본 코드 위치(Evidence)를 연결하여 추적 가능성을 보장한다.
3. Entity 검색, 호출자(caller)/피호출자(callee) 탐색을 Query로 제공한다.
4. 선택한 Entity의 변경 영향 범위를 그래프로 시각화한다.
5. Git diff 기반 증분 분석으로 관계 데이터를 최신 상태로 유지한다.
6. AI에게 질문과 관련된 서브그래프와 Evidence만 컨텍스트로 전달할 수 있는 인터페이스를 제공한다.

### 2.2 비목표 (Non-Goals)

- **코드 실행/동적 분석**: 런타임 트레이싱, 프로파일링은 범위에 포함하지 않는다. 정적 분석이 기준이다.
- **코드 품질 평가**: 린트, 코드 스멜, 복잡도 측정은 다루지 않는다.
- **코드 자동 수정**: 리팩토링 실행이나 코드 생성은 ContextSource의 역할이 아니다. 이해와 탐색까지가 범위다.
- **원본 코드 저장소 대체**: 관계 데이터는 인덱스일 뿐, 코드의 원천(source of truth)은 항상 원본 저장소다.
- **MVP 단계의 다중 언어 지원**: 첫 지원 언어는 TypeScript로 한정한다.

---

## 3. 사용자 및 사용 시나리오 (Users & Use Cases)

### 3.1 대상 사용자

| 사용자 | 설명 | 핵심 니즈 |
|--------|------|-----------|
| 개발자 | 코드베이스를 탐색·수정하는 엔지니어 | 구조 파악, 변경 영향 분석 |
| 신규 합류자 | 코드베이스에 처음 진입하는 팀원 | 빠른 온보딩, 전체 구조 이해 |
| AI 에이전트 | 코드 설명·분석·계획을 생성하는 LLM 기반 도구 | 질문과 관련된 정확한 서브그래프와 근거 |
| 테크 리드 / 아키텍트 | 시스템 구조를 관리하는 책임자 | 의존성 현황, 구조 변화 추적 |

### 3.2 핵심 사용 시나리오

**US-1. 호출 관계 탐색**
> 개발자로서, 특정 함수를 누가 호출하는지 알고 싶다. 그래야 수정 전에 영향 범위를 파악할 수 있다.

- Entity를 이름으로 검색하고, caller/callee 목록을 조회한다.
- 각 관계를 클릭하면 근거가 되는 코드 위치(Evidence)로 이동할 수 있다.

**US-2. 변경 영향 시각화**
> 개발자로서, 이 클래스를 수정하면 어디까지 영향이 퍼지는지 그래프로 보고 싶다.

- Entity를 선택하면 해당 Entity를 중심으로 한 영향 그래프(역방향 의존 포함)를 시각화한다.
- 탐색 깊이(depth)를 조절할 수 있다.

**US-3. AI 컨텍스트 제공**
> AI 에이전트로서, "PaymentService를 변경하면 무엇이 깨지는가?"라는 질문에 답하기 위해 관련 서브그래프와 Evidence만 받고 싶다.

- Query API로 질문과 관련된 Entity/Relationship/Evidence 서브그래프를 조회한다.
- 전체 소스를 읽지 않고도 근거 있는 답변을 생성한다.

**US-4. 코드 변경 후 최신화**
> 개발자로서, 커밋 이후에도 관계 데이터가 자동으로 최신 상태이길 원한다.

- Git diff를 기준으로 변경된 파일의 Entity와 Relationship만 증분 재분석한다.

**US-5. 신규 합류자 온보딩**
> 신규 합류자로서, 모듈 간 의존 구조를 그래프로 훑어보며 시스템의 큰 그림을 이해하고 싶다.

- 모듈/파일 수준의 상위 그래프에서 시작해 클래스/함수 수준으로 내려가며 탐색한다.

---

## 4. 도메인 모델 (Relation Model)

```text
Entity ── Relationship ──> Entity
                 │
                 └── Evidence
```

### 4.1 Entity

MVP에서는 다음 Entity를 지원한다.

| Kind | 설명 |
|------|------|
| File | 소스 파일. MVP에서는 File이 Module 역할을 겸한다 (OQ-7) |
| Class | 클래스 |
| Interface | 인터페이스 |
| Function | 함수 |
| Method | 메서드 |
| ExternalModule | 프로젝트 외부 패키지(node_modules)를 패키지 단위로 접은 노드. 위치 정보 없이 패키지 이름만 가진다 (OQ-11) |

- **Module은 MVP에서 별도 Kind로 생성하지 않는다.** File = Module이며(OQ-7), 논리 Module(디렉터리, 배럴)은 후속 확장이다.
- **Project는 Entity Kind가 아니다.** MVP는 단일 프로젝트를 전제로 하며, Entity의 Project 소속은 아래 `projectId` 속성으로 표현한다. Relationship으로 표현하지 않는다. Project를 독립적인 검색·비교 대상으로 다루는 것은 Phase 2다 (OQ-8).

**Entity 필수 속성**

- `id`: 안정적인 식별자. `projectId + 파일 경로 + 심볼 경로`로 결정된다 (OQ-2)
- `projectId`: 소속 프로젝트 식별자. MVP에서는 단일 값이다
- `kind`: Entity 종류
- `name`: 심볼 이름 (File은 파일명, ExternalModule은 패키지 이름)
- `filePath` / `range`: 파일 경로와 시작/끝 라인. ExternalModule은 위치 정보를 갖지 않는다
- `revision`: 분석 시점의 Git revision

오버로드된 함수/메서드는 구현 시그니처 기준 **단일 Entity**로 취급한다.

### 4.2 Relationship

Entity 간의 방향성 있는 연결. MVP에서 지원하는 종류:

| Type | 방향 | 예시 |
|------|------|------|
| `DECLARES` | 컨테이너 → 멤버 | File이 Class를 선언, Class가 Method를 선언 |
| `IMPORTS` | 사용측 → 제공측 | File A가 File B의 심볼을 import |
| `CALLS` | 호출자 → 피호출자 | Function A가 Function B를 호출 |
| `IMPLEMENTS` | 구현체 → 인터페이스 | Class가 Interface를 구현 |
| `EXTENDS` | 하위 → 상위 | Class/Interface 상속 |

**외부 의존성 경계 (OQ-11)**: Relationship은 프로젝트 내부 심볼 간에만 생성하는 것을 원칙으로 한다. 예외로 `IMPORTS`의 target은 ExternalModule일 수 있다(패키지 단위로 축약). 외부 패키지 심볼에 대한 `CALLS`는 저장하지 않는다 — 외부 코드 분석은 비목표(2.2)이기 때문이다.

**Relationship 필수 속성**

- `type`: 관계 종류
- `source` / `target`: Entity id
- `resolution`: 분석 방식 — `static`(정적으로 확정) / `inferred`(추론)
- `confidence`: 신뢰도. 정적으로 확인된 관계와 추론된 관계를 명확히 구분한다 (예: 동적 호출, 인덱스 접근 등은 `inferred`로 기록)
- `evidence`: 1개 이상의 Evidence 참조. **Evidence 없는 Relationship은 저장할 수 없다.**

### 4.3 Evidence

관계 판단의 근거. 모든 분석 결과를 원본 코드로 추적하기 위한 단위다.

**Evidence 필수 속성**

- `filePath`: 파일 경로
- `range`: 시작/끝 라인·컬럼
- `snippet`: 해당 코드 조각
- `analyzer`: 관계를 판단한 분석기 식별자 (버전 포함)
- `revision`: 분석 대상 Git revision

---

## 5. 기능 요구사항 (Functional Requirements)

### 5.1 Analysis — 분석 파이프라인

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-A1 | 사용자가 지정한 `tsconfig.json`을 진입점으로 TypeScript Compiler API의 `Program`과 `TypeChecker`를 구성하고, tsconfig의 `include`/`exclude`/`paths`/`baseUrl`을 준수하여 AST와 Entity(File, Class, Interface, Function, Method)를 추출한다 | P0 |
| FR-A2 | Symbol Resolver가 import, 호출, 상속, 구현 관계를 해석하여 Relationship(`DECLARES`, `IMPORTS`, `CALLS`, `IMPLEMENTS`, `EXTENDS`)을 생성한다. 외부 패키지 import는 ExternalModule을 target으로 연결하고, 외부 심볼에 대한 호출 관계는 생성하지 않는다 (OQ-11) | P0 |
| FR-A3 | 모든 Relationship에 원본 코드 위치를 Evidence로 연결한다. Evidence 없는 관계는 생성되지 않는다 | P0 |
| FR-A4 | 각 Entity에 안정적인 식별자와 revision을 부여한다. 같은 파일 안에서 위치(라인)가 바뀌어도 동일 심볼이면 id가 유지되며, 파일 이동·심볼 이름 변경은 새 id를 부여한다 (OQ-2) | P0 |
| FR-A5 | 관계마다 분석 방식(`static`/`inferred`)과 신뢰도를 기록한다 | P0 |
| FR-A6 | Git diff를 기준으로 증분 재분석한다. 재분석 범위는 **변경된 파일 + 변경된 파일을 `IMPORTS` 하는 파일(역방향 1단계) + 직전 run에서 실패한 파일**이다 — 미변경 파일에서 변경된 파일로 나가는 관계(예: 이름이 바뀐 함수에 대한 `CALLS`)가 stale로 남는 것을 막고 실패 파일을 다음 run에서 재시도하기 위함이다. 삭제된 Entity와 그에 연결된 관계는 제거한다. 파일 분석이 성공한 경우에만 기존 결과를 원자적으로 교체하며, 실패한 파일은 기존 결과를 보존하고 이전 revision임을 실패 목록에 보고한다 | P0 |
| FR-A7 | 전체 재분석(full scan)을 명시적으로 실행할 수 있다 (최초 인덱싱, 복구용) | P0 |
| FR-A8 | 분석 실패(파싱 오류 등)가 발생한 파일은 건너뛰고 결과에 실패 목록을 보고한다. 일부 파일의 실패가 전체 분석을 중단시키지 않는다 | P1 |

### 5.2 Storage & Query — 저장 및 조회

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-Q1 | 분석 결과를 그래프 형태(Entity 노드, Relationship 엣지)로 저장한다 | P0 |
| FR-Q2 | Entity를 이름/종류/파일 경로로 검색할 수 있다 | P0 |
| FR-Q3 | 특정 Entity의 caller(들어오는 `CALLS`)와 callee(나가는 `CALLS`)를 조회할 수 있다 | P0 |
| FR-Q4 | 특정 Entity를 기준으로 지정한 depth까지의 서브그래프(정방향/역방향/양방향)를 조회할 수 있다 | P0 |
| FR-Q5 | 관계 종류, 분석 방식(`static`/`inferred`)으로 Query 결과를 필터링할 수 있다 | P1 |
| FR-Q6 | Query 결과에 각 Relationship의 Evidence가 포함되며, Evidence로 원본 코드 위치를 확인할 수 있다 | P0 |
| FR-Q7 | Query API를 프로그래밍 방식(CLI 및/또는 HTTP/MCP 인터페이스)으로 제공하여 AI 에이전트가 서브그래프를 조회할 수 있다 | P0 |

### 5.3 Visualization & Exploration — 시각화 및 탐색

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-V1 | 선택한 Entity를 중심으로 변경 영향 그래프(역방향 의존 포함)를 시각화한다 | P0 |
| FR-V2 | 그래프에서 노드(Entity)를 선택하면 상세 정보와 연결된 관계 목록을 보여준다 | P0 |
| FR-V3 | 그래프에서 엣지(Relationship)를 선택하면 Evidence(코드 snippet, 위치)를 보여준다 | P0 |
| FR-V4 | 탐색 depth와 관계 종류 필터를 조절할 수 있다 | P1 |
| FR-V5 | `static` 관계와 `inferred` 관계를 시각적으로 구분하여 표시한다 | P1 |
| FR-V6 | 전체 그래프가 아니라 질문/선택에 필요한 서브그래프만 렌더링한다 (Query-first) | P0 |

### 5.4 AI Integration — AI 연동

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-AI1 | AI에는 질문과 관련된 서브그래프와 Evidence만 컨텍스트로 전달한다. 전체 그래프 덤프는 기본 동작이 아니다 | P0 |
| FR-AI2 | AI가 반환하는 분석(시스템 설명, 영향 분석, 변경 계획)은 사용한 관계의 Evidence를 인용할 수 있는 형태로 서브그래프를 제공받는다 | P1 |
| FR-AI3 | 서브그래프 응답은 토큰 예산을 고려한 크기 제한 옵션을 제공한다 | P1 |

---

## 6. 비기능 요구사항 (Non-Functional Requirements)

| ID | 항목 | 요구사항 |
|----|------|----------|
| NFR-1 | 추적 가능성 | 모든 관계와 분석 결과는 Evidence를 통해 원본 코드 위치까지 추적 가능해야 한다 (Evidence-first) |
| NFR-2 | 증분 성능 | 일반적인 커밋(수십 개 파일 변경) 기준, 증분 분석은 전체 재분석 대비 유의미하게 빨라야 하며 초 단위 내에 완료되는 것을 목표로 한다 |
| NFR-3 | 초기 인덱싱 | 중형 코드베이스(약 10만 LOC TypeScript) 전체 분석이 수 분 이내에 완료되는 것을 목표로 한다 |
| NFR-4 | Query 응답성 | 대화형 탐색을 위해 일반적인 서브그래프 Query는 1초 이내 응답을 목표로 한다 |
| NFR-5 | 정확성 우선 | `static`으로 기록된 관계는 거짓 양성(false positive)이 없어야 한다. 불확실한 관계는 반드시 `inferred`로 구분한다 (Uncertainty-aware) |
| NFR-6 | 로컬 실행 | 소스 코드가 외부로 전송되지 않고 로컬(또는 사용자 통제 환경)에서 분석·저장이 가능해야 한다 |
| NFR-7 | 확장성 | Entity/Relationship 종류와 지원 언어를 추가할 수 있는 구조여야 한다 (Parser/Resolver 플러그인화) |

---

## 7. 설계 원칙 (Design Principles)

모든 기능 결정은 아래 원칙을 따른다. 원칙 간 충돌 시 판단 기준으로 사용한다.

1. **Relationship-first**: 파일 목록보다 코드 간 연결을 중심으로 이해한다.
2. **Evidence-first**: 모든 관계와 답변은 원본 코드까지 추적 가능해야 한다.
3. **Query-first**: 전체 그래프를 보여주기보다 질문에 필요한 관계를 탐색한다.
4. **Incremental**: 전체 재분석보다 변경된 영역을 중심으로 갱신한다.
5. **Uncertainty-aware**: 확정된 정적 관계와 추론된 관계를 명확히 구분한다.
6. **Shared Context**: 사람과 AI가 동일한 관계 데이터와 Query 결과를 사용한다.

---

## 8. MVP 범위

### 포함

- 단일 Project 분석
- TypeScript 지원
- Entity / Relationship / Evidence
- Graph Query
- 영향도 분석
- 관계 시각화
- Git Diff 기반 증분 분석
- AI Subgraph 제공 (MCP 기반 서브그래프 조회, FR-Q7/FR-AI1)

### 제외

- 다중 Project 분석
- Project Entity (검색·비교 대상으로서의 독립 Entity — Phase 2)
- 프로젝트 유사도 분석
- Project Metadata (기술 스택 등 — Phase 2)
- Vector Search
- AI Context Engine (Graph + Vector Hybrid — Phase 4. MVP의 MCP는 Subgraph 조회까지만 제공한다)
---

## 9. 성공 지표 (Success Metrics)

| 지표 | 측정 방법 | 목표 |
|------|-----------|------|
| 관계 추출 정확도 | 샘플 코드베이스에서 `static` 관계의 수작업 검증 | `static` 관계 false positive 0%, recall 95% 이상 |
| Evidence 완전성 | Evidence 없는 Relationship 수 | 0건 (스키마 수준에서 강제) |
| 증분 분석 효율 | 단일 파일 변경 시 재분석 시간 / 전체 분석 시간 | 전체 대비 5% 이하 |
| AI 컨텍스트 절감 | 동일 질문에 대해 전체 소스 제공 대비 서브그래프 제공 시 토큰 사용량 | 유의미한 감소 (기준선 측정 후 목표 확정) |
| 탐색 응답성 | 서브그래프 Query p95 응답 시간 | 1초 이내 |

> AI 답변 품질(정확도·일관성) 지표는 기준선 측정 방법 확정 후 추가한다.

---

## 10. 열린 질문 (Open Questions)

| # | 질문 | 논의 필요 사항 |
|---|------|----------------|
| OQ-1 | 그래프 저장소 선택 | 임베디드 그래프 DB vs SQLite 기반 자체 스키마 vs 전용 그래프 DB. 로컬 실행(NFR-6)과 Query 성능(NFR-4)을 함께 만족해야 함 |
| OQ-2 | Entity id 안정성 전략 | 파일 이동, 심볼 이름 변경, 오버로드 시 id 유지/재생성 규칙 |
| OQ-3 | Query 인터페이스 형태 | 자체 Query API vs Cypher류 그래프 질의 언어 vs 양쪽 제공 |
| OQ-4 | AI 연동 프로토콜 | MCP 서버 제공 여부, 서브그래프 직렬화 포맷 |
| OQ-5 | 시각화 제공 형태 | 웹 UI vs IDE 확장 vs CLI 기반 export(예: Mermaid/DOT). MVP에서 어디까지 |
| OQ-6 | 동적 패턴 처리 범위 | 동적 import, 콜백/고차함수, DI 컨테이너 등 정적으로 확정 불가한 호출의 `inferred` 처리 기준 |
| OQ-7 | 모듈(Module) Entity 정의 | 파일 = 모듈로 볼지, 배럴(index.ts)·디렉터리 기반 논리 모듈을 별도 취급할지 |
| OQ-8 | Project Entity | 다중 프로젝트 Namespace 전략 |
| OQ-9 | Project Metadata | Language, Runtime, Framework, Database 등을 재사용 가능한 Metadata로 관리할 것인가 |
| OQ-10 | Roadmap | Project Knowledge Base와 Semantic Code Knowledge Base를 ROADMAP.md에서 관리할 것인가 |
| OQ-11 | 외부 의존성 경계 | node_modules의 심볼을 Entity와 Relationship으로 다룰 것인가 |

| # | 결정 | 이유 |
|---|------|------|
| OQ-1 | **SQLite 기반 자체 Graph Schema (MVP)** | 로컬 실행, 배포 용이성, 의존성 최소화. 전용 Graph DB는 향후 선택 가능하도록 추상화한다. |
| OQ-2 | **ID = projectId + 파일 경로 + 심볼 경로** | TypeScript는 전역 네임스페이스가 없어 파일 경로 없는 심볼 경로는 유일하지 않다. 파일 이동·심볼 이름 변경 시 새 ID를 부여하며, 관계는 재분석으로 복원된다. 이동 추적(ID 유지)은 후속 과제다. 오버로드는 구현 시그니처 기준 단일 Entity로 취급한다. |
| OQ-3 | **자체 Query API 우선** | 내부 모델을 숨기고 향후 Cypher 변환 어댑터를 추가할 수 있도록 한다. |
| OQ-4 | **MCP 지원** | AI는 MCP를 통해 Subgraph(Entity, Relationship, Evidence)를 조회한다. HTTP API는 일반 클라이언트용으로 제공한다. |
| OQ-5 | **Web UI 우선** | Pinpoint와 유사한 관계 탐색 UI를 제공한다. IDE Plugin은 이후 단계에서 지원한다. |
| OQ-6 | **Uncertainty-aware 적용** | 정적으로 판단 가능한 관계만 `static`, 나머지는 `inferred`로 저장한다. |
| OQ-7 | **File = Module (MVP)** | MVP에서는 File을 Module로 간주하고 Module Kind는 생성하지 않는다. 논리 Module(Directory, Barrel)은 향후 확장한다. |
| OQ-8 | **MVP는 projectId 속성만** | MVP는 단일 프로젝트 전제이므로 Entity에 `projectId` 속성만 부여한다. Project를 독립 Entity(검색·비교 대상)로 승격하는 것은 Phase 2다. |
| OQ-9 | **MVP에서는 수집하지 않음** | 기술 메타데이터(Language, Runtime, Framework 등) 관리는 Phase 2 범위다. 8장 제외 목록과 일치시킨다. |
| OQ-10 | **로드맵 분리** | MVP는 코드 관계 분석기에 집중한다. 프로젝트 지식베이스와 벡터 검색은 ROADMAP.md에서 관리한다. |
| OQ-11 | **내부 심볼 관계만 저장, 외부 import는 ExternalModule로 축약** | 외부 코드 분석은 비목표(2.2)다. `IMPORTS`는 패키지 단위 ExternalModule 노드로 연결하고, 외부 심볼에 대한 `CALLS`는 저장하지 않는다. |

---

## 11. 마일스톤 (MVP 내부 구현 순서)

Phase 간 로드맵은 [ROADMAP.md](./ROADMAP.md)에서 관리한다. 이 장은 Phase 1(MVP) 내부의 구현 순서만 다룬다.

| 단계 | 내용 | 관련 FR | 산출물 (완료 기준) |
|------|------|---------|--------------------|
| M1 — 분석 코어 | TypeScript Parser + Symbol Resolver. Entity/Relationship/Evidence 추출, ExternalModule 경계 처리 | FR-A1~A5, A8 | CLI로 단일 프로젝트 전체 분석이 실행되고 결과가 JSON으로 출력된다 |
| M2 — 저장 & Query | [DATA-MODEL.md](./DATA-MODEL.md) 스키마로 저장. Entity 검색, caller/callee, 서브그래프 Query | FR-A7, FR-Q1~Q6 | [API.md](./API.md)의 HTTP 조회 API(2.1~2.5, 2.7)가 동작한다 |
| M3 — 증분 분석 | Git diff 기반 변경 감지, 역방향 IMPORTS 1단계 포함 부분 재분석 | FR-A6 | 분석 실행 API(API.md 2.6)로 incremental run이 동작하고, 단일 파일 변경 재분석이 전체 대비 5% 이하(성공 지표)를 달성한다 |
| M4 — 시각화 | Web UI: 영향 그래프 렌더링, Entity/관계 상세, Evidence 연결 탐색 | FR-V1~V6 | 브라우저에서 Entity를 검색해 영향 그래프를 탐색하고 Evidence로 코드 위치를 확인할 수 있다 |
| M5 — MCP 연동 | 읽기 전용 MCP tool 5종(API.md 3장) 제공 | FR-Q7, FR-AI1~AI3 | AI 에이전트가 MCP로 서브그래프를 조회해 Evidence를 인용한 답변을 생성하는 데모가 동작한다 |

각 단계는 이전 단계의 산출물 위에서만 진행하며, M1의 추출 정확도(성공 지표: static false positive 0%)를 검증한 뒤 M2로 넘어간다.
