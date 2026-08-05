# ContextSource 경쟁 서비스 벤치마킹

- **문서 버전**: 0.1 (Draft)
- **작성일**: 2026-08-04
- **조사 기준일**: 2026-08-04
- **관련 문서**: [PRD.md](./PRD.md), [ROADMAP.md](./ROADMAP.md), [API.md](./API.md)

---

## 1. 목적

이 문서는 ContextSource와 유사한 목표를 가진 제품과 기술을 비교하여 제품의 차별화 방향과 MVP 개선 과제를 도출한다.

ContextSource는 다음 네 영역의 교차점에 있다.

```text
정적 코드 분석
    ×
코드 관계 그래프
    ×
변경 영향 탐색
    ×
AI용 구조화 Context
```

단일 제품과 일대일로 비교하기보다 각 영역에서 성숙한 제품을 조합하여 벤치마킹한다.

---

## 2. 벤치마크 선정

| 제품/기술 | 핵심 강점 | ContextSource와 겹치는 영역 | 직접 경쟁도 |
|-----------|-----------|------------------------------|-------------|
| Sourcegraph | 정확한 코드 탐색과 대규모 검색 | 심볼 관계, 참조 탐색, AI Context | 매우 높음 |
| CodeSee | 코드 및 PR 관계 시각화 | 영향 그래프, 온보딩, 변경 리뷰 | 높음 |
| GitHub Copilot | 자연어 기반 코드베이스 탐색 | AI Context 소비 경험 | 중간 |
| CodeQL | 컴파일 기반 의미 분석과 경로 설명 | 정확한 관계 분석, Evidence | 중간 |
| Joern | 확장 가능한 Code Property Graph | 그래프 모델과 자유로운 관계 Query | 중간 |

---

## 3. 제품별 분석

### 3.1 Sourcegraph

Sourcegraph는 ContextSource와 가장 가까운 성숙 제품이다. 검색 기반 탐색과 컴파일 정보를 사용하는 Precise Code Navigation을 구분하고, 정확한 인덱스가 없을 때는 검색 기반 탐색을 폴백으로 사용한다. SCIP라는 언어 중립 코드 인텔리전스 프로토콜을 제공하며, Cody는 검색과 코드 그래프를 AI Context 선정에 활용한다.

**장점**

- 대규모·다중 저장소 탐색에 성숙하다.
- 정의, 참조, 구현체 탐색이 개발 흐름에 자연스럽게 통합된다.
- 정확한 분석과 검색 기반 결과를 구분한다.
- Web UI, API, 코드 호스트, IDE 등 다양한 접점을 제공한다.
- SCIP를 통해 언어별 인덱서와 소비 계층을 분리한다.

**단점**

- Precise Code Navigation은 별도 인덱스 생성과 업로드가 필요하다.
- 제품 범위와 운영 구조가 크고 복잡하다.
- 모든 관계를 독립적인 Evidence 객체로 설명하는 것이 핵심 UX는 아니다.
- 단일 로컬 프로젝트를 빠르게 분석하려는 사용자에게는 상대적으로 무겁다.

**ContextSource 적용점**

- 결과의 생성 방식을 `static`, `inferred`, `unresolved` 등으로 명시한다.
- 정밀 분석 실패 시 완전히 건너뛰는 대신 저정밀 폴백을 검토한다.
- 장기적으로 SCIP import/export 호환성을 검토한다.
- 그래프 자체보다 정의·참조·영향 확인 같은 작업 중심 UX를 제공한다.

**공식 자료**

- [Sourcegraph Code Navigation](https://sourcegraph.com/docs/code-navigation)
- [Sourcegraph Precise Code Navigation](https://sourcegraph.com/docs/code-navigation/precise-code-navigation)
- [Sourcegraph Cody Context](https://sourcegraph.com/docs/cody/core-concepts/context)

### 3.2 CodeSee

CodeSee는 코드베이스를 대화형 지도 형태로 표현하고 PR마다 Review Map을 생성한다. 변경된 파일뿐 아니라 변경 파일에 의존하는 미변경 파일도 영향 후보로 표시하며, 새 커밋이 추가되면 지도를 갱신한다.

**장점**

- 온보딩과 구조 이해가 직관적이다.
- PR이라는 명확한 사용 시점에 제품이 개입한다.
- 변경 파일과 영향 가능 파일을 시각적으로 구분한다.
- 리뷰 순서, Tour, 주석 등 협업 기능이 있다.
- 여러 프로그래밍 언어를 지원한다.

**단점**

- 파일 수준 의존성 표현이 중심이어서 심볼 수준 정밀도가 제한될 수 있다.
- 큰 그래프는 시각적 복잡성이 빠르게 증가한다.
- 영향 관계를 컴파일 의미론 수준으로 보증하는 제품은 아니다.
- AI가 소비할 Evidence 중심 API보다 사람 중심 시각화가 강하다.

**ContextSource 적용점**

- Entity 중심 그래프 외에 revision 간 변경 그래프를 제공한다.
- 변경, 삭제, 영향 후보, 불확실한 관계를 시각적으로 구분한다.
- 단순 탐색뿐 아니라 권장 검토 순서를 제시한다.
- PR 또는 Git diff를 핵심 진입점으로 사용한다.

**공식 자료**

- [CodeSee Overview](https://docs.codesee.io/docs/getting-started)
- [CodeSee Review Maps](https://docs.codesee.io/docs/user-guide)

### 3.3 GitHub Copilot

GitHub Copilot은 사용자가 그래프나 Query 언어를 직접 다루기보다 자연어로 코드베이스를 탐색하도록 한다. 저장소의 semantic code search index와 편집기의 텍스트 검색, 워크스페이스 도구 등을 조합하여 Context를 수집한다.

**장점**

- 별도의 Query 언어 없이 자연어로 진입할 수 있다.
- 편집기와 GitHub 안에서 바로 사용할 수 있다.
- 질문에서 탐색과 후속 작업까지 연결한다.
- 그래프보다 답변과 작업 결과를 사용자에게 제공한다.

**단점**

- 어떤 Context가 선택됐는지 완전히 투명하지 않을 수 있다.
- 답변 근거가 ContextSource의 Evidence 모델처럼 일관된 구조로 보장되지는 않는다.
- 텍스트·의미 검색만으로는 호출 관계나 영향 경로를 정확히 증명하기 어렵다.
- GitHub 및 지원 편집기 생태계에 대한 의존성이 크다.

**ContextSource 적용점**

- 원시 MCP tool에 더해 질문을 관계 Query로 변환하는 Context Builder를 제공한다.
- AI 응답이 사용한 Entity, Relationship, Evidence를 구조적으로 인용하도록 한다.
- 질문별 Context를 순위화하고 토큰 예산 안에서 구성한다.
- 그래프를 몰라도 사용할 수 있는 자연어 진입점을 제공한다.

**공식 자료**

- [Using GitHub Copilot to explore a codebase](https://docs.github.com/en/enterprise-cloud@latest/copilot/tutorials/explore-a-codebase)
- [How Copilot understands your workspace](https://code.visualstudio.com/docs/agents/reference/workspace-context)

### 3.4 CodeQL

CodeQL은 코드를 Query 가능한 데이터베이스로 만들고 데이터 흐름 경로의 각 단계를 소스 코드에서 확인할 수 있게 한다. Source에서 sink까지의 경로를 펼쳐 보고 각 단계로 이동하는 방식은 ContextSource의 Evidence UX에 유용한 기준이다.

**장점**

- 언어 의미론에 기반한 정밀 분석을 제공한다.
- 단일 edge가 아니라 전체 경로를 설명한다.
- Query와 테스트로 분석 규칙을 반복 검증할 수 있다.
- 동일한 Query를 여러 저장소에 적용할 수 있다.

**단점**

- 일반 개발자가 Query를 작성하기 어렵다.
- 분석 데이터베이스 생성 비용이 있다.
- 일반적인 코드 구조 탐색보다 보안 분석에 최적화되어 있다.
- 대화형 코드 지도나 온보딩 경험은 상대적으로 약하다.

**ContextSource 적용점**

- Evidence를 edge별 snippet에서 끝내지 않고 영향 경로 전체로 표현한다.
- Analyzer 규칙마다 골든 테스트와 예상 관계를 작성한다.
- 영향 결과에 중간 경로와 관계별 Evidence를 표시한다.
- 후속 단계에서 `READS`, `WRITES`, `TYPE_USES`, 데이터 흐름 관계를 overlay로 확장한다.

**공식 자료**

- [Exploring data flow with CodeQL path queries](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-vs-code/explore-data-flow)
- [CodeQL for Visual Studio Code](https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-vs-code)

### 3.5 Joern

Joern은 AST, 제어 흐름, 데이터 흐름을 하나의 Code Property Graph로 결합하고 traversal DSL로 분석한다. 여러 언어에서 공통 중간 표현을 사용하며 overlay로 새로운 의미 계층을 추가할 수 있다.

**장점**

- 풍부하고 확장 가능한 그래프 모델을 제공한다.
- AST, 제어 흐름, 데이터 흐름을 하나의 그래프에서 탐색할 수 있다.
- 언어별 frontend와 공통 Query 모델이 분리되어 있다.
- 보안과 복잡한 프로그램 패턴 분석에 강하다.

**단점**

- 모델과 Query DSL의 학습 비용이 크다.
- 일반 코드 이해에는 지나치게 저수준일 수 있다.
- 저장과 분석 구조가 ContextSource MVP보다 무겁다.
- 원본 그래프를 그대로 AI에 전달하기에는 크기가 지나치게 커질 수 있다.

**ContextSource 적용점**

- MVP의 작은 그래프 모델은 유지하되 확장 관계를 overlay처럼 분리한다.
- 저장 스키마와 Analyzer가 특정 언어에 강하게 결합되지 않도록 계약을 정의한다.
- 내부 그래프와 외부 응답 그래프를 분리하여 AI에는 축약된 subgraph만 제공한다.

**공식 자료**

- [Joern Code Property Graph](https://docs.joern.io/code-property-graph/)
- [Joern Traversal Basics](https://docs.joern.io/traversal-basics/)

---

## 4. ContextSource의 차별화 가능성

현재 설계에서 가장 강한 차별점은 다음 조합이다.

- 모든 Relationship에 Evidence를 강제한다.
- `static`과 `inferred`를 명시한다.
- SQLite 기반의 경량 로컬 실행을 제공한다.
- 사람의 UI와 AI의 MCP가 같은 관계 모델을 사용한다.
- 초기에는 TypeScript에 집중하여 높은 정확도를 추구한다.
- Git diff 기반으로 관계 데이터를 증분 갱신한다.

개별 기능은 경쟁 제품에도 존재하지만 **로컬·경량·Evidence-first·사람과 AI의 공통 그래프**라는 조합은 차별화 가능성이 있다.

권장 포지셔닝:

> ContextSource는 코드를 예쁘게 시각화하는 도구가 아니라, 개발자와 AI가 동일하게 조회할 수 있는 증거 기반 코드 관계 인덱스다.

---

## 5. 개선 과제

### 5.1 P0 — 변경 영향 분석의 의미 정의

현재 MVP의 5개 관계만으로는 실제로 무엇이 깨지는지 판정하기 어렵다. 예를 들어 인터페이스 필드 변경의 영향은 `CALLS`, `IMPORTS`, `IMPLEMENTS`, `EXTENDS`만으로 충분히 발견되지 않는다.

MVP에서는 기능을 **구조적 영향 후보 탐색**으로 정의하고, 단정적인 파손 예측과 구분한다.

영향 응답은 후보, 이유, 경로, 신뢰도, Evidence를 함께 제공해야 한다.

```jsonc
{
  "candidate": "p1/sym:src/api.ts#createOrder",
  "reason": "createOrder가 PaymentService.charge를 호출한다",
  "path": ["createOrder", "CALLS", "PaymentService.charge"],
  "confidence": 1.0,
  "evidence": []
}
```

후속 Relationship 후보의 우선순위는 다음과 같다.

1. `REFERENCES`
2. `TYPE_USES`
3. `INSTANTIATES`
4. `OVERRIDES`
5. `EXPORTS` / `REEXPORTS`
6. `TESTS`

### 5.2 P0 — Edge 조회에서 Path 조회로 확장

사용자가 궁금한 것은 그래프 전체보다 영향의 이유와 경로다. 다음 Query를 검토한다.

```text
GET /paths?from={id}&to={id}
GET /entities/{id}/impact
GET /analysis/runs/{id}/changed-subgraph
```

`impact` 응답에는 다음이 포함되어야 한다.

- 영향 후보 순위
- 최단 또는 대표 경로
- 관계별 Evidence
- `static`/`inferred` 혼합 여부
- 결과가 잘린 이유와 미탐색 범위

### 5.3 P0 — Git diff를 핵심 사용자 진입점으로 활용

Git diff를 단순 증분 분석 입력뿐 아니라 사용자 경험의 첫 화면으로 활용한다.

```text
변경된 Entity
    ↓
직접 영향 후보
    ↓
간접 영향 후보
    ↓
관련 테스트
    ↓
Evidence 기반 검토 순서
```

핵심 질문은 “그래프가 최신인가?”가 아니라 “이번 변경에서 무엇을 검토해야 하는가?”가 되어야 한다.

### 5.4 P0 — 분석 품질 측정 체계 구축

PRD의 `static false positive 0%, recall 95%` 목표를 측정할 골든 fixture를 저장소에 포함한다.

- 기본 import와 alias import
- barrel re-export
- interface implementation
- overload
- generic method
- callback과 higher-order function
- dependency injection
- dynamic import
- 외부 패키지
- 파일 삭제·이동·심볼 이름 변경

각 fixture에 예상 Entity, Relationship, resolution, Evidence를 선언하고 CI에서 비교한다.

### 5.5 P1 — 정밀 분석 실패 시 폴백 모델 추가

결과 품질을 다음처럼 구분하는 방안을 검토한다.

| Resolution | 의미 |
|------------|------|
| `static` | TypeChecker로 target을 확정 |
| `inferred` | 제한된 규칙으로 target을 추론 |
| `unresolved` | 호출 또는 참조는 발견했지만 target을 확정하지 못함 |

`unresolved`를 버리지 않으면 분석 사각지대를 측정할 수 있고 사용자가 그래프가 완전하다고 오해하는 것을 방지할 수 있다.

### 5.6 P1 — Graph-only Context Builder 도입

MCP의 원시 조회 tool 위에 다음 기능을 수행하는 Context Builder를 둔다.

- 질문에서 seed Entity 추출
- 관계 유형별 우선순위 적용
- 경로 기반 확장
- Evidence 중복 제거
- 토큰 예산 기반 pruning
- 선택한 Context의 이유 반환

Phase 1에서는 Graph-only로 구현하고 Phase 4에서 Vector Search와 결합한다.

### 5.7 P1 — 작업 중심·계층형 시각화

전체 그래프 화면 하나 대신 최소 세 가지 뷰를 제공한다.

| View | 중심 Entity | 주요 목적 |
|------|-------------|-----------|
| 구조 보기 | File, Class, Interface | 온보딩과 전체 구조 이해 |
| 호출 보기 | Function, Method | 호출자·피호출자 탐색 |
| 변경 보기 | Git diff에 포함된 Entity | 영향 후보와 검토 경로 확인 |

File → Class → Method로 점진적으로 펼치는 계층형 탐색을 적용한다.

### 5.8 P2 — SCIP 호환성 검토

모든 언어의 인덱서를 직접 개발하지 않도록 장기적으로 다음 어댑터 구조를 검토한다.

```text
TypeScript Analyzer ─┐
SCIP Importer ───────┼→ Normalized Relationship Model
향후 언어 Analyzer ─┘
```

SCIP가 직접 제공하지 않는 호출 관계와 ContextSource Evidence는 별도 확장 계층으로 유지한다.

---

## 6. 권장 MVP 가치 제안

> TypeScript 개발자가 함수나 PR을 선택하면 ContextSource가 구조적 영향 후보를 관계 경로와 코드 근거로 보여주고, 동일한 결과를 AI 에이전트에도 MCP로 제공한다.

이 가치 제안을 기준으로 한 권장 구현 순서는 다음과 같다.

1. 정확한 TypeScript 관계 추출
2. 관계별 Evidence와 분석 품질 표시
3. Entity 및 diff 기반 영향 경로
4. 작업 중심 Web UI
5. 동일한 응답을 제공하는 MCP
6. Graph-only Context Builder
7. 다중 언어와 Vector Search

Sourcegraph의 검색 규모, Copilot의 AI 범용성, Joern의 분석 깊이를 그대로 따라가기보다는 **로컬 TypeScript 프로젝트의 변경 영향을 근거와 함께 설명하는 공통 Context 계층**에 집중하는 것이 가장 선명한 차별화 전략이다.

---

## 7. 결론

ContextSource의 핵심 경쟁력은 그래프 자체가 아니라 다음 세 가지를 함께 제공하는 데 있다.

1. 관계가 존재하는 이유를 코드 Evidence로 설명한다.
2. 변경으로 인한 구조적 영향 경로를 사람에게 보여준다.
3. 동일한 결과를 AI가 제한된 Context로 조회할 수 있게 한다.

MVP는 범용 코드 인텔리전스 플랫폼보다 **Evidence 기반 TypeScript 변경 영향 탐색기**로 시작하고, 검증된 관계 모델 위에 Project Knowledge Base와 Vector Context를 확장하는 것이 적절하다.
