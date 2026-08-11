# ContextSource 경쟁 서비스 벤치마킹

- **문서 버전**: 0.2
- **작성일**: 2026-08-04
- **최종 개정일**: 2026-08-11 — 개정 배경과 세부 변경 내역은 [8. 개정 이력](#8-개정-이력) 참고
- **조사 기준일**: 2026-08-04 (§3 제품별 분석), 2026-08-11 (§2 CodeSee 상태, §5 신규 항목)
- **관련 문서**: [PRD.md](./PRD.md), [ROADMAP.md](./ROADMAP.md), [API.md](./API.md), [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md)

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
| CodeSee → GitKraken | 코드 및 PR 관계 시각화 | 영향 그래프, 온보딩, 변경 리뷰 | 낮음 — 독립 제품으로는 단종 (아래 3.2 참고) |
| GitHub Copilot | 자연어 기반 코드베이스 탐색 | AI Context 소비 경험 | 중간 |
| CodeQL | 컴파일 기반 의미 분석과 경로 설명 | 정확한 관계 분석, Evidence | 중간 |
| Joern | 확장 가능한 Code Property Graph | 그래프 모델과 자유로운 관계 Query | 중간 |
| Backstage | 서비스 카탈로그·소유권·기술 스택 메타데이터 중심 개발자 포털 | 프로젝트 등록/검색, 기술 스택 태깅, 유사 프로젝트 탐색 (Phase 2) | 높음 — 아래 3.6 참고 |

Phase 2에서 ContextSource가 실제로 갖게 된 기능(여러 프로젝트 등록·검색, 기술 스택 태깅, 유사 프로젝트 탐색)은 코드 관계 분석기가 아니라 Backstage류 "서비스 카탈로그/개발자 포털" 제품군과 정면으로 겹친다. 최초 작성(2026-08-04) 시점에는 이 카테고리가 누락되어 있었다 — 경쟁 벤치마킹 재검토(2026-08-11)에서 추가했다.

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

### 3.2 CodeSee (→ GitKraken에 흡수, 2024)

> **2026-08-11 갱신**: CodeSee는 2024-02-22 상용 서비스를 종료했고, 같은 해 5월 GitKraken에 인수되어 그 기능이 GitKraken의 코드 시각화 도구로 흡수됐다. 즉 **독립 제품으로서의 CodeSee는 더 이상 존재하지 않는다** — 최초 작성(2026-08-04) 시점의 "직접 경쟁도: 높음" 평가는 "현재 운영 중인 경쟁자"를 전제로 했으므로 오해의 소지가 있다. 다만 아래 Review Map 개념 자체와 그로부터 얻는 시사점은 여전히 유효하므로 분석은 그대로 남기고, §2 표의 경쟁도만 "낮음"으로 수정했다. ([CodeSee 종료 공지](https://www.linkedin.com/feed/update/urn:li:activity:7163970333912289281), [GitKraken 인수](https://pitchbook.com/profiles/company/458764-48))

CodeSee는 코드베이스를 대화형 지도 형태로 표현하고 PR마다 Review Map을 생성했다. 변경된 파일뿐 아니라 변경 파일에 의존하는 미변경 파일도 영향 후보로 표시하며, 새 커밋이 추가되면 지도를 갱신했다.

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

### 3.6 Backstage (2026-08-11 추가)

Backstage는 Spotify가 만들어 CNCF(Cloud Native Computing Foundation)에 기증한 오픈소스 개발자 포털 프레임워크다. 핵심은 **Software Catalog** — 서비스·라이브러리·웹사이트·데이터 파이프라인 등 조직의 모든 소프트웨어를 코드와 함께 저장되는 YAML 메타데이터(`catalog-info.yaml`)로 등록하고, 이를 수집해 검색·소유권 추적이 가능한 카탈로그로 시각화한다. 2026년 기준 Netflix, American Airlines, Expedia 등 3,000개 이상 기업이 사용하는, 이 카테고리의 사실상 표준이다.

**장점**

- 서비스/소유권/기술 스택 메타데이터를 표준화된 YAML 스키마로 관리한다.
- 카탈로그 외에 CI/CD, 문서, 비용, Tech Radar 등 수십 개 플러그인으로 확장 가능한 생태계가 있다.
- 대규모 조직(수천 개 서비스)에서 실제로 검증됐다.
- 오픈소스이며 CNCF 프로젝트로 거버넌스가 있다.

**단점**

- 코드 "관계"(호출·상속·참조) 자체는 다루지 않는다 — 카탈로그는 서비스 단위 메타데이터일 뿐, ContextSource의 Entity/Relationship/Evidence 같은 코드 내부 구조 분석이 없다.
- 카탈로그 정확성이 각 팀이 `catalog-info.yaml`을 얼마나 성실히 관리하느냐에 의존한다 — 자동 감지보다 수동 등록이 기본 모델이다.
- 프레임워크 자체(React 앱 + 백엔드)를 구축·운영해야 해서 초기 셋업 비용이 크다 — ContextSource가 지향하는 "가볍게 로컬에서 바로 실행"과는 반대 방향이다.

**ContextSource 적용점**

- 기술 스택 태깅을 수동 YAML 작성이 아니라 `package.json` 자동 감지로 시작한 것(ADR-0005)은 Backstage 대비 온보딩 마찰이 적다는 명확한 차별점이다 — 포지셔닝에 명시할 가치가 있다.
- Backstage에는 없는 "코드 관계 그래프 + Evidence"가 ContextSource의 핵심 차별화 축임을 재확인한다 — 즉 두 제품은 겹치는 영역(카탈로그)과 겹치지 않는 영역(관계 그래프)이 함께 있는 관계다.
- Backstage는 소유권(owner) 개념을 카탈로그의 1급 필드로 둔다 — ContextSource의 Project Entity(ADR-0004)에는 아직 소유권/팀 개념이 없다. 실제 필요가 확인되면 후속 검토 대상.
- 장기적으로 `catalog-info.yaml`과의 메타데이터 호환(예: 기술 스택 정보를 Backstage 카탈로그로 export)을 검토할 수 있다 — 이는 claude-do.md의 "다중 Project 지식 그래프 확장" 금지와는 무관한 순수 메타데이터 상호운용 이슈다.

**공식 자료**

- [What is Backstage?](https://backstage.io/docs/overview/what-is-backstage/)
- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [backstage/backstage (GitHub)](https://github.com/backstage/backstage)

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

**Phase 2 추가분(2026-08-11 갱신)**: Project Entity(ADR-0004)·기술 스택 관리(ADR-0005)·유사 프로젝트 탐색(ADR-0006)으로 "여러 프로젝트를 등록·검색·비교"하는 카탈로그 성격이 더해졌다. 이는 3.6절의 Backstage류 제품과 겹치는 영역이지만, ContextSource는 (1) 수동 YAML 대신 `package.json` 자동 감지로 시작하고 (2) 카탈로그 메타데이터가 Evidence 기반 코드 관계 그래프와 같은 저장소·같은 조회 계층을 공유한다는 점에서 다르다 — 즉 ContextSource는 "카탈로그 제품에 코드 그래프를 얹은 것"이 아니라 "코드 관계 그래프에 최소한의 카탈로그 레이어가 자연스럽게 얹힌 것"에 가깝다. 다만 유사 프로젝트 탐색은 기술 스택 태그 교집합이라는 단순 집합 연산이며(ADR-0006), Vector Search나 Project 간 영속적 그래프 관계가 아니다 — claude-do.md의 금지사항을 지키기 위한 의도적 설계다.

권장 포지셔닝:

> ContextSource는 코드를 예쁘게 시각화하는 도구가 아니라, 개발자와 AI가 동일하게 조회할 수 있는 증거 기반 코드 관계 인덱스다.

---

## 5. 개선 과제

> **2026-08-11 추가**: 이 프로젝트의 최초 구현 지시서(claude-do.md)는 (1) Vector Search 추가, (2) 다중 Project 지식 그래프 확장, (3) 소스 코드를 외부 SaaS/AI API로 전송을 명시적으로 금지한다. 이 제약은 여전히 유효하며, 아래 5.6·5.8과 신규 항목 어디에도 이를 무효화하는 결정은 없다. 5.6이 언급하는 "Phase 4의 Vector Search 결합"은 별도 승인 전까지 착수하지 않는 먼 미래 항목이며, Phase 2에서 실제로 구현된 "유사 프로젝트 탐색"(ADR-0006)은 이름이 비슷해 보여도 순수 태그 교집합 계산일 뿐 Vector Search가 아니다 — 두 개념을 혼동하지 않도록 주의.

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

> **상태 (2026-08-11)**: **미착수.** 골든 fixture 9종은 이미 저장소에 있고 CI 없이 로컬 `make test`로 통과하지만, PRD의 `static false positive 0%, recall 95%` 수치 자체를 실제 중형~대형 오픈소스 TypeScript 프로젝트로 측정한 적은 없다(IMPLEMENTATION_REPORT.md §9). 5.11(신규)이 이 갭을 성능 축까지 포함해 더 구체화한다.

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

> **2026-08-11 주석**: 여기서 말하는 "Context Builder"는 아직 착수하지 않았다 — Phase 2의 "유사 프로젝트 탐색"(ADR-0006, 기술 스택 태그 교집합)과는 완전히 다른 기능이니 혼동하지 말 것. Phase 4의 Vector Search 결합은 claude-do.md의 금지사항과 직결되므로 별도 승인 없이는 착수하지 않는다.

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

### 5.9 P0 — 신규 경쟁 카테고리 대응: 프로젝트 카탈로그 포지셔닝 명확화 (2026-08-11 추가)

3.6절에서 다뤘듯 Phase 2의 프로젝트 등록/기술 스택/유사 프로젝트 탐색은 Backstage류 "내부 개발자 포털" 카테고리와 겹친다. 이 문서(그리고 README.md의 포지셔닝 문구)가 여전히 "코드 관계 분석기"만을 전제로 서술되어 있어, 실제 제품 범위와 대외 포지셔닝이 어긋나 있다.

- README.md·PRD.md의 제품 소개 문구에 "프로젝트 카탈로그" 성격을 간단히라도 반영할지 검토한다.
- Backstage와 달리 자동 감지 기반이라는 차별점(4절 참고)을 마케팅/문서 포지셔닝에 명시한다.
- 카탈로그 기능을 더 키울지(Backstage와 정면 경쟁), 코드 관계 그래프의 보조 기능으로 의도적으로 얕게 유지할지 방향을 결정한다 — 결정 자체가 로드맵에 없다.

### 5.10 P0 — [해결됨] 유사 프로젝트 스코어링 결함

경쟁 벤치마킹 서브에이전트가 소스 코드 확인만으로 재현한 실제 결함이었다: `detectTechStack()`(ADR-0005)이 모든 프로젝트에 예외 없이 `language: TypeScript`/`runtime: Node.js`를 부여하는데(현재 시스템이 TS/Node 전용이라 사실상 상수), ADR-0006의 유사도가 순수 태그 교집합 크기였던 탓에 프레임워크·ORM·데이터베이스가 전혀 겹치지 않는 두 프로젝트도 이 상수 태그 2개만으로 항상 최소 2점의 "유사도"를 갖고 있었다.

**2026-08-11 수정 완료**: `findSimilarProjects`의 교집합 계산에서 `language`/`runtime` 카테고리를 제외하도록 수정했다(ADR-0006 수정 이력 참고, 회귀 테스트 포함). 이 항목은 벤치마크 문서의 개선 과제가 아니라 실제 코드 수정으로 이미 닫혔다 — 기록으로만 남긴다.

### 5.11 P0 — 성능·정확도 실측 (NFR-2/3/4, recall 95%)

PRD 9장의 성공 지표(`static` false positive 0%, recall 95%, 증분 처리 5% 이하, 10만 LOC 수 분 이내, p95 조회 1초 이내)는 IMPLEMENTATION_REPORT.md §9에서 스스로 "측정하지 않았다"고 인정한다. 현재까지의 검증은 골든 fixture 9종 + 7파일짜리 데모 프로젝트가 전부다. Sourcegraph/CodeQL처럼 실제 초대형 코드베이스에서 검증된 제품과 비교하면, ContextSource의 핵심 주장(NFR-5 정확성 우선)이 무검증 상태로 남아 있다는 점을 이 문서가 감추지 않고 명시해야 한다.

- 중형~대형 오픈소스 TypeScript 프로젝트(예: 10만 LOC 이상) 하나 이상으로 실측한다.
- 측정 결과를 이 문서 또는 별도 벤치마크 리포트에 수치로 남긴다 — "측정 예정"이 아니라 "측정함 → 수치"로 문서를 갱신한다.

### 5.12 P0 — 보안/인증 로드맵 명문화

HTTP API·MCP 모두 인증이 전혀 없다(IMPLEMENTATION_REPORT §10). PRD NFR-6("로컬 또는 사용자 통제 환경")이 이를 정당화했지만, Phase 2에서 이미 "여러 프로젝트를 하나의 서버가 관리"하는 형태로 진화했고 Docker Compose는 포트를 호스트에 바인딩해 네트워크로 노출한다. 프로젝트 삭제(`DELETE /projects/{id}`)는 CASCADE로 관련 데이터를 전부 지우는데 이를 막을 권한 체계가 없다.

- "언제까지 로컬 단일 사용자 전제가 유효한지"를 로드맵에 명시적으로 결정한다.
- 최소한 파괴적 오퍼레이션(삭제, 등록)에 대한 API key 같은 최소 보호장치를 P1로 검토한다(IMPLEMENTATION_REPORT §11-5 기존 권고와 연결).

### 5.13 P1 — [해결됨] CI 자동화

140개 이상의 테스트, 골든 fixture, 스키마 무결성 테스트, 증분==full scan 동등성 테스트 등 품질 자산은 CodeQL의 "Query와 테스트로 반복 검증" 철학과 견줄 만하다. 그런데 이 엄격함이 로컬에서 사람이 수동으로 `make test`를 돌릴 때만 보장되고, PR/커밋마다 자동으로 강제되지 않았다.

**2026-08-11 수정 완료**: `.github/workflows/ci.yml`을 추가해 push/PR마다 `build → typecheck → lint → test`를 자동 실행한다(IMPLEMENTATION_REPORT §11-4 기존 권고 재확인 및 반영).

### 5.14 P1 — [해결됨] 확장성(NFR-7) 결정

PRD NFR-7은 "Parser/Resolver 플러그인화"를 요구하지만 실제 플러그인 인터페이스는 없었다(TypeScript 전용, IMPLEMENTATION_REPORT §8). Joern(언어별 frontend 분리), Sourcegraph(SCIP로 인덱서·소비 계층 분리)와 비교하면 이 축은 목표만 있고 구현된 확장점이 없어 애매한 상태였다.

**2026-08-11 결정 완료**: [ADR-0007](./docs/adr/0007-extensibility-scope-decision.md)에서 "지금은 TypeScript 전용으로 남기고 실제 플러그인 인터페이스는 설계하지 않는다"를 명시적으로 결정했다. 다중 언어 지원이 실제로 필요해지는 시점에는 자체 인터페이스보다 5.8이 제안한 SCIP 어댑터 경로를 먼저 검토한다.

### 5.15 P1 — [해결됨] 다중 언어 로드맵 명시

ROADMAP.md Phase 3/4는 Vector/임베딩 확장만 다루고 다중 언어 지원 자체는 어느 Phase에도 배정되어 있지 않았다. 반면 ROADMAP.md 본문은 "Java 21 프로젝트", "Spring Boot 3 프로젝트" 같은 예시를 들어 다중 언어를 암시했다 — 자동 감지가 TypeScript/Node.js 전용(ADR-0005 §4)이라 실제 구현 범위보다 과장된 인상을 줬다.

**2026-08-11 수정 완료**: ROADMAP.md Phase 2 예시 문구에 "이는 개념 예시일 뿐 다중 언어 지원이 로드맵에 있다는 뜻이 아니다"라는 명확화 주석을 추가하고, ADR-0007(5.14)의 결정을 함께 인용했다.

### 5.16 P1 — 배포/운영 성숙도 보강

`docker-compose.yml`에 healthcheck, 로그 수집, 메트릭 endpoint가 없다. SQLite 파일 백업/복구 절차도 문서화되어 있지 않다. ROADMAP.md는 "SQLite 파일의 쓰기 주체는 api 하나로 제한"이라는 설계를 명시하는데, 이는 의도적이지만 동시에 팀 규모가 커지면 명백한 처리량 상한이 된다.

- Docker healthcheck, 최소 로깅/메트릭을 추가한다.
- SQLite 백업 절차를 README.md 또는 별도 운영 문서에 명시한다.

### 5.17 P1 — [해결됨] Query 표현력 갭 공식 채택

MCP tool은 5개 고정 read 오퍼레이션(search/get/callers/callees/subgraph)뿐이고, PRD OQ-3에서 "자체 Query API 우선, 향후 Cypher 변환 어댑터 검토"로 결론지었지만 실제 자유 질의 언어는 없었다. Joern의 traversal DSL, CodeQL의 Query 언어와 비교하면 임의의 복잡한 그래프 질문을 표현할 수단이 없다 — 의도된 트레이드오프(단순함 우선)이지만 지금까지는 벤치마크 기준으로 공식 채택되지 않았다.

**2026-08-11 결정 완료**: PRD.md OQ-3에 "실제 사용자가 고정 오퍼레이션으로 풀 수 없는 질문을 반복 제기하기 전까지는 확장하지 않는다"는 후속 결정을 추가했다 — "언젠가 다룰 것"이 아니라 "지금은 의도적으로 안 함"으로 명시했다.

### 5.18 P2 — 문서 발견성 (OpenAPI)

내부 문서(PRD/ROADMAP/ADR/API.md/DATA-MODEL.md/IMPLEMENTATION_REPORT.md)의 완성도는 이례적으로 높지만, 외부 개발자가 API를 발견하는 경로(OpenAPI/Swagger 스펙, 검색 가능한 문서 사이트)는 없다 — API.md는 손으로 쓴 마크다운뿐이다.

- API.md 기반 OpenAPI 스펙 자동 생성을 검토한다.

### 5.19 P2 — 라이선스·배포 모델과 커뮤니티 0일차 명시

저장소에 LICENSE 파일이 없다 — OSS 공개 여부, 사내 도구 여부에 대한 결정이 어디에도 없다. 또한 이 벤치마크가 비교하는 Sourcegraph/CodeQL/Joern은 모두 수년간의 커뮤니티·프로덕션 검증을 등에 업고 있는 반면 ContextSource는 단일 작성자의 0일차 프로젝트라는 사실을 이 문서가 명시해야 균형 잡힌 비교가 된다.

- 라이선스/배포 모델을 결정하고 LICENSE 파일을 추가한다.
- "우리는 0일차 프로젝트다"라는 전제를 결론(§7) 근처에 명시한다.

### 5.20 P2 — 접근성 검증

Web UI(React+Cytoscape.js)에서 키보드 내비게이션, 스크린리더, 색맹 대응을 공식적으로 검증한 적이 없다. static/inferred 구분은 색상(녹색/황색)과 선 스타일(실선/점선)을 병용해 색각 이상자에 대한 위험은 낮지만, 정식 검증은 아니다.

- 기본적인 키보드 접근성과 색 대비를 점검한다(UX 감사에서 본문 텍스트 색상 대비 자체는 WCAG AA 기준(4.5:1) 미달 사례가 발견되지 않았다 — 정식 접근성 감사는 아직 별도로 필요하다).

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

> **2026-08-11 주석 — 권장 순서와 실제 실행의 괴리**: 실제로는 MVP(1~5에 해당하는 Phase 1) 완료 직후 6·7이 아니라 ROADMAP.md Phase 2 "Project Knowledge Base"(Project Entity·기술 스택 관리·유사 프로젝트 탐색)에 먼저 착수했다 — 이 문서의 P0 항목인 5.1(영향 분석 의미 정의)~5.4(품질 측정 체계)는 여전히 미착수 상태다(IMPLEMENTATION_REPORT.md §12~14 참고). 이는 사용자가 명시적으로 Phase 2를 지시했기 때문이며 그 자체로 잘못된 선택은 아니지만, 이 벤치마크 문서가 제안한 우선순위가 실제 의사결정에 그대로 반영되지는 않았다는 사실은 솔직하게 기록해야 한다 — 벤치마크 문서의 실효성을 스스로 점검하는 차원에서 남긴다.

---

## 7. 결론

ContextSource의 핵심 경쟁력은 그래프 자체가 아니라 다음 세 가지를 함께 제공하는 데 있다.

1. 관계가 존재하는 이유를 코드 Evidence로 설명한다.
2. 변경으로 인한 구조적 영향 경로를 사람에게 보여준다.
3. 동일한 결과를 AI가 제한된 Context로 조회할 수 있게 한다.

MVP는 범용 코드 인텔리전스 플랫폼보다 **Evidence 기반 TypeScript 변경 영향 탐색기**로 시작하고, 검증된 관계 모델 위에 Project Knowledge Base와 Vector Context를 확장하는 것이 적절하다.

**0일차 프로젝트라는 전제 (2026-08-11 추가)**: 이 문서가 비교하는 Sourcegraph/CodeQL/Joern/Backstage는 모두 수년간의 커뮤니티·프로덕션 검증을 거친 제품이다. ContextSource는 단일 작성자가 만든, 아직 외부 사용자도 커뮤니티도 없는 0일차 프로젝트다. 이 문서의 목적은 "이미 이들과 동등하다"가 아니라 "이들에게서 무엇을 배워 차별화할 것인가"를 정하는 데 있으며, §5의 개선 과제 목록은 그 격차를 좁히기 위한 구체적인 다음 단계다.

---

## 8. 개정 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|-----------|
| 2026-08-04 | 0.1 (Draft) | 최초 작성 — Sourcegraph/CodeSee/Copilot/CodeQL/Joern 5개 제품 분석, 개선 과제 5.1~5.8 |
| 2026-08-11 | 0.2 | Phase 2(Project Entity·기술 스택 관리·유사 프로젝트 탐색) 완료 및 P0 결함 수정 이후, 경쟁 벤치마킹 서브에이전트의 독립 검토를 반영해 개정. 주요 변경: (1) Backstage(내부 개발자 포털) 카테고리 신설(3.6), (2) CodeSee의 단종·GitKraken 인수 사실 반영(3.2), (3) §4 차별화 서술에 Phase 2 반영, (4) 5.4/5.6에 현재 상태 주석 추가, (5) 신규 개선 과제 5.9~5.20 추가(성능 실측·보안·CI·확장성·다중 언어·운영 성숙도·문서 발견성·라이선스·접근성 등), (6) 유사 프로젝트 스코어링 결함을 5.10에 기록하고 해결 완료로 표시, (7) §6에 권장 순서와 실제 실행의 괴리를 주석으로 기록, (8) §7에 "0일차 프로젝트" 전제 명시 |
