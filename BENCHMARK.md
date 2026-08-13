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

### 5.1 P0 — [해결됨] 변경 영향 분석의 의미 정의

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

**2026-08-12 해결**: [ADR-0008](./docs/adr/0008-impact-analysis.md)이 이 항목의 정의를 그대로 채택해 `computeImpact()`(`packages/core/src/query/impact.ts`)로 구현했다. 위 예시 응답 형태(`candidate`/`reason`/`path`/`confidence`/`evidence`)와 거의 동일하며, `evidence`는 `path` 배열의 각 hop 안에 담아 재구성한다(새 DTO를 만들지 않고 기존 Relationship/Evidence 필드를 재사용). 새 Relationship Type 6종(`REFERENCES` 등)은 ADR-0008이 명시적으로 범위 밖으로 미뤘다 — 기존 5개 타입만으로 "후보 랭킹+이유+경로+신뢰도"라는 구조 자체는 완전하고, 부족한 건 recall이지 아키텍처가 아니라는 판단(재검토 조건: 실사용 후 놓치는 영향이 많이 확인되면 `REFERENCES`부터 개별 ADR로 추가). IMPLEMENTATION_REPORT.md §16 참고.

### 5.2 P0 — [해결됨] Edge 조회에서 Path 조회로 확장

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

**2026-08-12 해결**: 셋 중 `GET /paths?from=&to=`(범용 경로 질의)는 채택하지 않았다 — PRD.md OQ-3의 기존 결정("고정 오퍼레이션으로 못 푸는 질문이 실제로 반복되기 전까지 범용 Query 언어를 추가하지 않는다")과 정면으로 배치되기 때문(ADR-0008 결정 4). 나머지 둘은 이름을 다듬어 구현했다: `GET /projects/{id}/entities/{encodedId}/impact`(후보 순위·대표 경로·관계별 Evidence·`hasInferredHop`로 static/inferred 혼합 여부·`truncated`/`stats`로 잘린 범위를 모두 포함), `changed-subgraph`는 "raw graph가 아니라 랭킹된 impact"라는 방향에 맞춰 `GET /projects/{id}/analysis/runs/{id}/changed-impact`로 이름을 바꿔 구현했다. API.md 2.10, openapi.yaml 참고.

### 5.3 P0 — [해결됨] Git diff를 핵심 사용자 진입점으로 활용

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

**2026-08-12 해결**: Web UI에 이 흐름 그대로 "변경 영향" 탭(`/projects/:id/impact`)을 추가했다(ADR-0008 결정 5). 분석 run을 고르면(기본값: 최신 완료 run) `changed-impact`를 조회해 `isDirectImpact` 그룹(직접 영향) → 나머지(간접 영향) → `isLikelyTestFile`(관련 테스트로 보이는 파일, `TESTS` 관계 타입 없이 파일 경로 패턴 휴리스틱만 사용) 순서로 묶어 보여주고, 각 후보를 펼치면 경로별 Evidence까지 인라인으로 확인할 수 있다. Playwright로 실제 브라우저에서 전체 흐름을 검증했다. IMPLEMENTATION_REPORT.md §16 참고.

### 5.4 P0 — [해결됨] 분석 품질 측정 체계 구축

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

**2026-08-12 해결**: "각 fixture에 예상 Entity, Relationship, resolution, Evidence를 선언하고 CI에서 비교한다"를 그대로 구현했다 — 기존에는 9종 fixture가 있어도 개별 `it()`이 "이 관계가 존재한다"만 확인할 뿐 "이게 전부다(초과·누락 없음)"는 검증하지 않았다(예: 실수로 관계를 하나 더 만들어도 어떤 테스트도 실패하지 않았다). 이제 각 fixture 디렉터리에 `golden.json`(정규화된 Entity/Relationship/Evidence 전체 스냅샷, id 포함)을 두고 `packages/core/test/golden.test.ts`가 `analyzeProject()` 실제 출력과 정확히 일치하는지 비교한다 — 하나라도 다르면 실패, CI(`npm run test`)에서 자동 실행된다(별도 워크플로 변경 불필요, 5.13에서 이미 CI가 전체 vitest 스위트를 돈다). "golden.json이 없는 fixture 디렉터리가 있으면 안 된다"는 커버리지 가드 테스트도 추가해, 새 fixture를 추가하고 golden 생성을 깜빡하는 것 자체를 막는다. 목록에 있던 "파일 삭제·이동·심볼 이름 변경"은 새 fixture가 아니라 이미 실제 git repo로 검증하는 `incremental.test.ts`가 담당한다(정적 golden 스냅샷과는 성격이 다름 — revision 간 diff가 핵심이므로).

원래 목록의 9개 시나리오 중 **"dependency injection"만 빠져 있었다** — 새 fixture(`dependency-injection`)로 추가하며 의도적으로 IMPLEMENTATION_REPORT.md §10이 이미 산문으로만 적어뒀던 알려진 한계(생성자로 주입된 인터페이스 타입 필드를 통한 호출은 CALLS 관계가 생성되지 않음, `this.logger.log(...)` 같은 패턴)를 golden.json에 "CALLS 관계 0건"으로 명시적으로 박아 CI가 강제하는 회귀 테스트로 승격했다 — 이 한계가 우연히 사라지거나(예: false positive를 만드는 방식으로 잘못 고쳐지거나) 조용히 더 나빠지는 것을 방지한다.

**의도적으로 하지 않은 것**: PRD 95% recall 수치 자체의 대규모 정량 검증(전수/샘플링 골든셋)은 여전히 이 항목의 범위가 아니다 — 그건 5.11이 실제 오픈소스 프로젝트(typeorm)로 별도 수행했다(소규모 수작업 표본, 대규모 정량 recall은 여전히 근사치임을 5.11도 명시). 이 항목은 "이미 있는 골든 fixture들이 실제로 완전성을 강제하는가"라는 좁은 갭만 닫는다.

### 5.5 P1 — [해결됨] 정밀 분석 실패 시 폴백 모델 추가

결과 품질을 다음처럼 구분하는 방안을 검토한다.

| Resolution | 의미 |
|------------|------|
| `static` | TypeChecker로 target을 확정 |
| `inferred` | 제한된 규칙으로 target을 추론 |
| `unresolved` | 호출 또는 참조는 발견했지만 target을 확정하지 못함 |

`unresolved`를 버리지 않으면 분석 사각지대를 측정할 수 있고 사용자가 그래프가 완전하다고 오해하는 것을 방지할 수 있다.

**2026-08-12 해결(원안과 다른 형태로)**: `relationship.resolution`에 `'unresolved'`를 그대로 추가하지는 않았다 — `relationship.target_id`가 `NOT NULL` FK라 "대상을 모른다"를 넣을 자리가 없고, nullable로 바꾸면 subgraph/impact/MCP/Web UI 전체가 깨진다. 대신 [ADR-0011](./docs/adr/0011-unresolved-references.md)로 **완전히 별도의 `unresolved_reference` 테이블**(Relationship이 아님, 어떤 그래프 순회에도 참여하지 않는 순수 진단 기록)을 설계·구현했다 — "사각지대 측정"이라는 원안의 목적은 그대로 달성하면서 "Relationship은 항상 두 Entity를 잇는다"는 기존 불변식은 건드리지 않는다. 우리 프로젝트 소스 안에서 실패한 경우만 기록하고 외부 패키지·ambient 선언(`console.log` 등)은 기록하지 않는다(PRD OQ-11과 같은 경계 — 안 그러면 실제 코드베이스에서 신호가 소음에 묻힌다). `GET /projects/{id}/stats`에 집계 추가, `GET /projects/{id}/unresolved-references` 신규, Web UI "검토" 탭에 두 번째 섹션으로 추가(새 탭 없음). IMPLEMENTATION_REPORT.md §19 참고.

### 5.6 P1 — [해결됨] Graph-only Context Builder 도입

MCP의 원시 조회 tool 위에 다음 기능을 수행하는 Context Builder를 둔다.

- 질문에서 seed Entity 추출
- 관계 유형별 우선순위 적용
- 경로 기반 확장
- Evidence 중복 제거
- 토큰 예산 기반 pruning
- 선택한 Context의 이유 반환

Phase 1에서는 Graph-only로 구현하고 Phase 4에서 Vector Search와 결합한다.

> **2026-08-11 주석**: 여기서 말하는 "Context Builder"는 아직 착수하지 않았다 — Phase 2의 "유사 프로젝트 탐색"(ADR-0006, 기술 스택 태그 교집합)과는 완전히 다른 기능이니 혼동하지 말 것. Phase 4의 Vector Search 결합은 claude-do.md의 금지사항과 직결되므로 별도 승인 없이는 착수하지 않는다.

**2026-08-12 해결**: [ADR-0012](./docs/adr/0012-context-builder.md)로 설계·구현했다. 실제로 점검해보니 "seed 추출"(`search_entities`)과 "경로 기반 확장"(`get_subgraph`)은 이미 있었고, 진짜 빠진 건 관계 유형별 우선순위·이유·토큰 예산 pruning이었다. 초안은 `get_subgraph` 위에 얇은 랭킹 계층만 얹으려 했으나 `codex exec` 독립 검토에서 "대표 관계가 실제 발견 경로와 무관할 수 있다"(이유가 거짓일 위험)는 결함을 지적받아, 여러 seed가 동시에 시작하는 전용 양방향 BFS(predecessor 추적)로 다시 설계했다 — `computeImpact`/`getSubgraph` 자체는 건드리지 않았다. 토큰 예산은 실제 토크나이저 없이 문자 수 근사치(`문자수/4`)로, Evidence 중복 제거는 "후보당 발견시킨 관계 하나의 Evidence만 남긴다"로 구체화했다. `GET /projects/{id}/context`(API.md 2.11)와 MCP tool `build_context`(6번째 tool) 양쪽에 공유 core 함수 하나를 노출했고, Web UI 화면은 만들지 않았다(태생적으로 AI 클라이언트용). Phase 4의 Vector Search 결합은 여전히 다루지 않는다. IMPLEMENTATION_REPORT.md §20 참고.

### 5.7 P1 — [해결됨] 작업 중심·계층형 시각화

전체 그래프 화면 하나 대신 최소 세 가지 뷰를 제공한다.

| View | 중심 Entity | 주요 목적 |
|------|-------------|-----------|
| 구조 보기 | File, Class, Interface | 온보딩과 전체 구조 이해 |
| 호출 보기 | Function, Method | 호출자·피호출자 탐색 |
| 변경 보기 | Git diff에 포함된 Entity | 영향 후보와 검토 경로 확인 |

File → Class → Method로 점진적으로 펼치는 계층형 탐색을 적용한다.

**2026-08-13 해결**: 구현에 앞서 사용자 요청으로 유사 오픈소스를 리서치했다(`codex exec --search`, [docs/research/similar-projects.md](./docs/research/similar-projects.md)) — 이 항목 자체보다는 프로젝트의 전반적 포지셔닝(그래프+confidence+evidence+unresolved 격리) 독자성을 점검하는 목적이었고, 결론은 "정확히 같은 조합은 못 찾았다"였다. [ADR-0013](./docs/adr/0013-task-oriented-views.md)으로 설계·구현했다. 실제로 점검해보니 세 뷰 중 둘은 이미 있었다 — "변경 보기"는 기존 `impact` 탭(ADR-0008)이 그대로 충족했고, "호출 보기"는 새 화면이 아니라 기존 `ImpactGraph`의 초기 방향/타입을 Entity 종류에 따라 프리셋(function/method→CALLS+양방향, class/interface/file→DECLARES/EXTENDS/IMPLEMENTS+out)하는 것으로 충분했다. 진짜 새로 만든 건 "구조 보기" 하나뿐이다 — File 목록을 루트로 `GET /entities/{id}/relationships?direction=out&types=DECLARES`를 지연 호출하며 펼치는 범용 재귀 트리(`StructureTree.tsx`, 새 탭). 3단으로 깊이를 강제하지 않았다 — 분석기가 중첩 함수도 DECLARES로 기록하므로 실제 깊이가 3단을 넘을 수 있기 때문이다. core/API/MCP 변경은 전혀 없다 — 기존 endpoint만 재사용했다. IMPLEMENTATION_REPORT.md §21 참고.

### 5.8 P2 — SCIP 호환성 검토

모든 언어의 인덱서를 직접 개발하지 않도록 장기적으로 다음 어댑터 구조를 검토한다.

```text
TypeScript Analyzer ─┐
SCIP Importer ───────┼→ Normalized Relationship Model
향후 언어 Analyzer ─┘
```

SCIP가 직접 제공하지 않는 호출 관계와 ContextSource Evidence는 별도 확장 계층으로 유지한다.

### 5.9 P0 — [해결됨] 신규 경쟁 카테고리 대응: 프로젝트 카탈로그 포지셔닝 명확화 (2026-08-11 추가)

3.6절에서 다뤘듯 Phase 2의 프로젝트 등록/기술 스택/유사 프로젝트 탐색은 Backstage류 "내부 개발자 포털" 카테고리와 겹친다. 이 문서(그리고 README.md의 포지셔닝 문구)가 여전히 "코드 관계 분석기"만을 전제로 서술되어 있어, 실제 제품 범위와 대외 포지셔닝이 어긋나 있다.

- README.md·PRD.md의 제품 소개 문구에 "프로젝트 카탈로그" 성격을 간단히라도 반영할지 검토한다.
- Backstage와 달리 자동 감지 기반이라는 차별점(4절 참고)을 마케팅/문서 포지셔닝에 명시한다.
- 카탈로그 기능을 더 키울지(Backstage와 정면 경쟁), 코드 관계 그래프의 보조 기능으로 의도적으로 얕게 유지할지 방향을 결정한다 — 결정 자체가 로드맵에 없다.

**2026-08-12 해결**: [ADR-0009](./docs/adr/0009-catalog-positioning.md)로 "코드 관계 그래프의 보조 기능으로 의도적으로 얕게 유지, Backstage와 정면 경쟁하지 않는다"를 공식 결정으로 명문화했다 — claude-do.md의 "다중 Project 지식 그래프 확장 금지"와 직결되고, ADR-0006이 유사도를 순수 태그 교집합으로 설계한 것과 같은 방향이라 새 제약이 아니라 이미 내려진 개별 결정들의 공통 방향을 정리한 것이다. README.md 프로젝트 목적과 PRD.md 상태 문구에 Backstage 대비 실제 차별점(수동 YAML 대신 `package.json` 자동 감지, 카탈로그가 관계 그래프와 같은 조회 계층 공유)을 명시했다 — 다만 PRD.md "1.1 제품 정의" 자체는 바꾸지 않았다(Phase 2 확장은 이미 ADR-0004가 별도로 다루는 패턴을 그대로 따름).

### 5.10 P0 — [해결됨] 유사 프로젝트 스코어링 결함

경쟁 벤치마킹 서브에이전트가 소스 코드 확인만으로 재현한 실제 결함이었다: `detectTechStack()`(ADR-0005)이 모든 프로젝트에 예외 없이 `language: TypeScript`/`runtime: Node.js`를 부여하는데(현재 시스템이 TS/Node 전용이라 사실상 상수), ADR-0006의 유사도가 순수 태그 교집합 크기였던 탓에 프레임워크·ORM·데이터베이스가 전혀 겹치지 않는 두 프로젝트도 이 상수 태그 2개만으로 항상 최소 2점의 "유사도"를 갖고 있었다.

**2026-08-11 수정 완료**: `findSimilarProjects`의 교집합 계산에서 `language`/`runtime` 카테고리를 제외하도록 수정했다(ADR-0006 수정 이력 참고, 회귀 테스트 포함). 이 항목은 벤치마크 문서의 개선 과제가 아니라 실제 코드 수정으로 이미 닫혔다 — 기록으로만 남긴다.

### 5.11 P0 — [실측 완료, 실측 중 발견한 결함 2건 모두 수정 완료] 성능·정확도 실측 (NFR-2/3/4, recall 95%)

PRD 9장의 성공 지표(`static` false positive 0%, recall 95%, 증분 처리 5% 이하, 10만 LOC 수 분 이내, p95 조회 1초 이내)는 IMPLEMENTATION_REPORT.md §9에서 스스로 "측정하지 않았다"고 인정했다. 현재까지의 검증은 골든 fixture 9종 + 7파일짜리 데모 프로젝트가 전부였다.

**2026-08-12 실측 수행**: [typeorm](https://github.com/typeorm/typeorm)(`df07bf1`, tsconfig의 `include` 기준 src+test 3,245 파일·약 285,676 LOC — PRD 목표 10만 LOC의 약 2.85배 규모)를 실제로 등록·분석했다.

| 지표 | 목표 (PRD) | 실측 | 판정 |
|------|-----------|------|------|
| NFR-3 초기 인덱싱 | 약 10만 LOC, 수 분 이내 | **약 285,676 LOC(2.85배 규모)를 3.7~4.1초** | ✅ 여유 큼 (목표 규모라면 수십~수백 배 여유) |
| NFR-4 Query 응답성 | 서브그래프 Query 1초 이내 | entity 상세 25ms · callers/callees 6~7ms · 검색 10ms · subgraph(depth2,200노드) 28ms · **subgraph(depth3,both,1000노드, 최악 케이스) 71ms** · stats 91ms | ✅ 최악 케이스도 1초의 ~14배 여유 |
| NFR-5 recall/정확도 | static false positive 0%, recall 95%+ | 전체 25,761개 관계 중 **100% `static`, 0% `inferred`**(interface 경유 호출은 관계 자체를 생성하지 않는 기존 보수적 설계와 일치). 실제 소스에서 수작업으로 뽑은 호출 4건(`Repository→EntityManager` 3건, `EntityManager→DataSource` 1건) 전부 정확히 캡처 확인 | 소규모 수작업 표본에서는 recall 100%, false positive 0 — 대규모 정량 recall(95% 기준의 전수/샘플링 검증)은 별도 골든셋 없이는 여전히 근사치 |
| NFR-2 증분 성능 | 전체 대비 유의미하게 빠름, 초 단위 | 파일 15개(3,244개 중 0.5%) 변경 → 수정 전 **서버 측 2.4초**(단, 관계 17.7% 유실 — 아래 결함 2번), 관계 유실을 고친 뒤 재측정하면 **서버 측 3.5초**(전체 스캔 3.7~4.1초 대비 약 10~15% 단축, 관계 유실 0건) | ⚠️ "초 단위"는 달성하지만 "유의미하게 빠름"은 약함 — 역방향 전이적 폐포로 재분석 대상이 넓어지면 절감폭이 줄어드는 것은 정확성과의 트레이드오프이며 구조적으로 불가피함(§15 참고) |

**실측 중 발견한 실제 결함 2건** (7파일짜리 데모 프로젝트로는 전혀 드러나지 않았던, 실제 규모에서만 나타나는 버그):

1. **[P0, 수정 완료]** 전체 분석이 `UNIQUE constraint failed: entity.id`로 크래시 — `containerNames+name`만으로 symbolPath를 만들어 (a) 같은 이름의 instance/static 메서드(`BaseEntity.hasId` 등), (b) 같은 파일의 동명 interface+class, (c) 형제 블록의 동명 지역 함수가 서로 다른 선언인데도 같은 entity id로 충돌했다. 파일 단위 occurrence counter로 두 번째부터 `$2`, `$3`... suffix를 붙여 해결(재분석 시에도 결정적으로 동일 id 유지, FR-A4 보존). 회귀 테스트 fixture(`duplicate-symbol-names`) 추가. 커밋 `6f32246`.
2. **[P0, 수정 완료 — 2026-08-12]** **증분 분석이 실제로 관계를 조용히 잃어버렸다.** 15개 파일만 바꿨는데 전체 관계 25,761건 중 **4,552건(17.7%)이 사라졌다** — 삭제 대상 파일이 아니었는데도. 원인을 정확히 특정: 변경분의 역방향 importer(예: `DataSource.ts`)는 재분석 대상에 포함되어 entity가 delete+reinsert되는데, 그 entity를 **호출은 하지만 자신은 재분석 대상이 아닌** 파일(예: `EntityManager.ts`가 `DataSource.createQueryRunner()`를 호출)의 관계는 (1) target entity가 지워지며 cascade로 함께 삭제되고 (2) `analyzeProject({ onlyFiles })`가 재분석 대상 파일을 **source**로 하는 관계만 재생성하므로 영원히 복구되지 않았다. 사라진 4,552건을 전수 분석한 결과 **100%가 이 패턴**(직접 변경한 15개 파일이 target인 경우는 0건, 전부 역방향 importer가 target인 경우)과 일치해 결정적 재현임을 확인했다. ADR-0003이 고친 것은 "역방향 참조 **해석**"(Phase A 전체 파일 심볼맵)이었지, "역방향 참조 **보존**"(대상 entity가 지워질 때 그걸 가리키던 관계를 누가 다시 만드는가)이 아니었다 — 이번 실측에서 드러난 것은 후자다.

   **근본 원인**: `findReverseImporters`가 변경 파일의 역방향 importer를 **1단계만** 구했다(`W가 Z를 호출하고 Z가 변경 파일을 IMPORTS` 형태의 2단계 연쇄에서, `W`가 `Z`를 import하지 않고 그냥 호출만 하면 W는 끝내 발견되지 않음 — `EntityManager.ts`가 `DataSource.ts`를 직접 `import type`으로 참조하는데도 1단계 조회로는 놓쳤다). **수정**: `findReverseImporters`가 고정점(fixpoint)에 도달할 때까지 반복해 전이적 폐포(transitive closure)를 구하도록 변경 — 새 결과가 없을 때까지 "방금 찾은 파일들을 다시 IMPORTS 하는 파일"을 계속 찾는다. 소규모 fixture(a→b→c 2단계 체인)로 회귀 테스트를 추가해 수정 전엔 실패, 수정 후엔 통과하는 것을 직접 확인했고, **typeorm 전체로 재검증해 관계 손실이 0건(25,761→25,761, 완전 일치)임을 확인**했다. 증분 소요시간은 2.4초 → 3.5초로 늘었다(정확성을 위해 재분석 대상이 넓어진 것이 원인, 여전히 전체 스캔 3.7~4.1초보다는 빠르고 "초 단위" 목표는 유지).

재현 방법: typeorm을 등록해 전체 분석 → 임의의 파일 15개에 한 줄씩 추가하고 git commit → 증분 분석 실행 → 관계 총량이 25,761 → 21,209로 감소하는 것을 확인.

### 5.12 P0 — [해결됨] 보안/인증 로드맵 명문화

HTTP API·MCP 모두 인증이 전혀 없다(IMPLEMENTATION_REPORT §10). PRD NFR-6("로컬 또는 사용자 통제 환경")이 이를 정당화했지만, Phase 2에서 이미 "여러 프로젝트를 하나의 서버가 관리"하는 형태로 진화했고 Docker Compose는 포트를 호스트에 바인딩해 네트워크로 노출한다. 프로젝트 삭제(`DELETE /projects/{id}`)는 CASCADE로 관련 데이터를 전부 지우는데 이를 막을 권한 체계가 없다.

- "언제까지 로컬 단일 사용자 전제가 유효한지"를 로드맵에 명시적으로 결정한다.
- 최소한 파괴적 오퍼레이션(삭제, 등록)에 대한 API key 같은 최소 보호장치를 P1로 검토한다(IMPLEMENTATION_REPORT §11-5 기존 권고와 연결).

**2026-08-12 해결**: [ADR-0010](./docs/adr/0010-security-roadmap.md)로 두 가지를 결정했다 — (1) 로컬 단일 사용자 전제는 원격 다중 사용자 배포가 실제로 요청되기 전까지 유효하다, (2) 그 동안에도 옵트인 API key 보호장치를 추가한다. `--api-key`/`CONTEXTSOURCE_API_KEY`를 설정하면 `GET`이 아닌 모든 `/api/v1` 요청에 `x-api-key` 헤더 일치를 요구하고(미설정 시 기존 동작과 100% 동일, 하위 호환), 조회는 항상 열려 있다. Web UI는 이 키를 알지 못하도록 의도적으로 설계했다 — 브라우저 번들에 심는 값은 진짜 비밀이 아니므로, 켜면 Web UI의 쓰기 동작도 함께 막히는 것이 올바른 동작이다. API.md 1.4, openapi.yaml(`ApiKeyAuth` 스킴 — 부수적으로 기존에 전체 endpoint에 걸쳐 있던 `security-defined` 경고 23건도 함께 해소됨), docker-compose.yml에 반영. IMPLEMENTATION_REPORT.md §18 참고.

### 5.13 P1 — [해결됨] CI 자동화

140개 이상의 테스트, 골든 fixture, 스키마 무결성 테스트, 증분==full scan 동등성 테스트 등 품질 자산은 CodeQL의 "Query와 테스트로 반복 검증" 철학과 견줄 만하다. 그런데 이 엄격함이 로컬에서 사람이 수동으로 `make test`를 돌릴 때만 보장되고, PR/커밋마다 자동으로 강제되지 않았다.

**2026-08-11 수정 완료**: `.github/workflows/ci.yml`을 추가해 push/PR마다 `build → typecheck → lint → test`를 자동 실행한다(IMPLEMENTATION_REPORT §11-4 기존 권고 재확인 및 반영).

### 5.14 P1 — [해결됨] 확장성(NFR-7) 결정

PRD NFR-7은 "Parser/Resolver 플러그인화"를 요구하지만 실제 플러그인 인터페이스는 없었다(TypeScript 전용, IMPLEMENTATION_REPORT §8). Joern(언어별 frontend 분리), Sourcegraph(SCIP로 인덱서·소비 계층 분리)와 비교하면 이 축은 목표만 있고 구현된 확장점이 없어 애매한 상태였다.

**2026-08-11 결정 완료**: [ADR-0007](./docs/adr/0007-extensibility-scope-decision.md)에서 "지금은 TypeScript 전용으로 남기고 실제 플러그인 인터페이스는 설계하지 않는다"를 명시적으로 결정했다. 다중 언어 지원이 실제로 필요해지는 시점에는 자체 인터페이스보다 5.8이 제안한 SCIP 어댑터 경로를 먼저 검토한다.

### 5.15 P1 — [해결됨] 다중 언어 로드맵 명시

ROADMAP.md Phase 3/4는 Vector/임베딩 확장만 다루고 다중 언어 지원 자체는 어느 Phase에도 배정되어 있지 않았다. 반면 ROADMAP.md 본문은 "Java 21 프로젝트", "Spring Boot 3 프로젝트" 같은 예시를 들어 다중 언어를 암시했다 — 자동 감지가 TypeScript/Node.js 전용(ADR-0005 §4)이라 실제 구현 범위보다 과장된 인상을 줬다.

**2026-08-11 수정 완료**: ROADMAP.md Phase 2 예시 문구에 "이는 개념 예시일 뿐 다중 언어 지원이 로드맵에 있다는 뜻이 아니다"라는 명확화 주석을 추가하고, ADR-0007(5.14)의 결정을 함께 인용했다.

### 5.16 P1 — [부분 해결] 배포/운영 성숙도 보강

`docker-compose.yml`에 healthcheck, 로그 수집, 메트릭 endpoint가 없었다. SQLite 파일 백업/복구 절차도 문서화되어 있지 않았다. ROADMAP.md는 "SQLite 파일의 쓰기 주체는 api 하나로 제한"이라는 설계를 명시하는데, 이는 의도적이지만 동시에 팀 규모가 커지면 명백한 처리량 상한이 된다.

**2026-08-11 수정 완료 (healthcheck, 백업)**:
- `api`에 `GET /health`(SQLite 접근 가능 여부까지 확인), `ui`에 `GET /healthz`(프로세스 생존 확인)를 추가하고 `docker-compose.yml`에 두 서비스 모두 healthcheck를 붙였다 — `ui`는 `api`가 `healthy`가 될 때까지 기동을 미룬다(`depends_on: condition: service_healthy`). 실제 `docker compose up`으로 두 컨테이너가 `healthy` 상태가 되는 것을 확인했다.
- README.md에 SQLite 백업/복구 절차(`docker compose exec`+`docker cp` 기반)를 추가하고 실제로 백업 파일이 유효한 SQLite 데이터베이스로 생성되는지 확인했다.

**미해결 (범위 밖으로 남김)**: 로그 수집·메트릭 endpoint는 이번에 다루지 않았다 — MVP 단일 사용자 로컬 실행 범위에서는 시급성이 낮다고 판단했다. 실제 팀 규모 배포가 확정되면 재검토한다.

### 5.17 P1 — [해결됨] Query 표현력 갭 공식 채택

MCP tool은 5개 고정 read 오퍼레이션(search/get/callers/callees/subgraph)뿐이고, PRD OQ-3에서 "자체 Query API 우선, 향후 Cypher 변환 어댑터 검토"로 결론지었지만 실제 자유 질의 언어는 없었다. Joern의 traversal DSL, CodeQL의 Query 언어와 비교하면 임의의 복잡한 그래프 질문을 표현할 수단이 없다 — 의도된 트레이드오프(단순함 우선)이지만 지금까지는 벤치마크 기준으로 공식 채택되지 않았다.

**2026-08-11 결정 완료**: PRD.md OQ-3에 "실제 사용자가 고정 오퍼레이션으로 풀 수 없는 질문을 반복 제기하기 전까지는 확장하지 않는다"는 후속 결정을 추가했다 — "언젠가 다룰 것"이 아니라 "지금은 의도적으로 안 함"으로 명시했다.

### 5.18 P2 — [해결됨] 문서 발견성 (OpenAPI)

내부 문서(PRD/ROADMAP/ADR/API.md/DATA-MODEL.md/IMPLEMENTATION_REPORT.md)의 완성도는 이례적으로 높지만, 외부 개발자가 API를 발견하는 경로(OpenAPI/Swagger 스펙, 검색 가능한 문서 사이트)는 없었다 — API.md는 손으로 쓴 마크다운뿐이었다.

**2026-08-12 수정 완료**: [openapi.yaml](./openapi.yaml)을 작성해 API.md §2의 HTTP API 17개 endpoint와 16개 스키마를 OpenAPI 3.0으로 옮겼다. `@redocly/cli lint`(구조 검증)와 `bundle`(전체 `$ref` 해석)로 실제 유효성을 확인했다 — 인증이 없는(BENCHMARK.md 5.12) 로컬 전용 API라는 사실을 그대로 반영해 `security` 스키마는 정의하지 않았다.

### 5.19 P2 — [해결됨] 라이선스·배포 모델과 커뮤니티 0일차 명시

저장소에 LICENSE 파일이 없었다 — OSS 공개 여부, 사내 도구 여부에 대한 결정이 어디에도 없었다. 또한 이 벤치마크가 비교하는 Sourcegraph/CodeQL/Joern은 모두 수년간의 커뮤니티·프로덕션 검증을 등에 업고 있는 반면 ContextSource는 단일 작성자의 0일차 프로젝트라는 사실을 이 문서가 명시해야 균형 잡힌 비교가 된다.

**2026-08-12 수정 완료**: 레포 소유자 확인 후 [MIT License](./LICENSE)를 채택했다 — 루트와 5개 워크스페이스 패키지의 `package.json`에 `license` 필드를 추가했다. "우리는 0일차 프로젝트다"라는 전제는 §7에 이미 명시되어 있다(2026-08-11 개정).

### 5.20 P2 — [부분 해결] 접근성 검증

Web UI(React+Cytoscape.js)에서 키보드 내비게이션, 스크린리더, 색맹 대응을 공식적으로 검증한 적이 없었다. static/inferred 구분은 색상(녹색/황색)과 선 스타일(실선/점선)을 병용해 색각 이상자에 대한 위험은 낮지만, 정식 검증은 아니었다.

**2026-08-12 실제 감사 수행 (axe-core + 수동 키보드 테스트)**: 주요 화면 6개 상태(프로젝트 목록, Overview, 탐색 탭 Entity 선택 전/후, 검토, 분석 이력)에 `axe-core`(WCAG 2 A/AA 규칙)를 실행하고, 실제 Tab 키 순회로 키보드 조작성을 확인했다. 발견 즉시 수정:

- **[critical] select-name**: `<select>` 3개(프로젝트 목록의 기술 스택 필터, 기술 스택 편집기의 카테고리, 탐색 탭의 Entity 종류 필터)에 접근 가능한 이름이 전혀 없어 스크린리더가 용도를 알 수 없었다. `aria-label` 추가로 수정.
- **[serious] color-contrast**: 주 버튼(`.btn`, 흰 글씨/파란 배경)이 대비 3.23:1, Entity 종류 배지(`.badge.kind`)가 3.97~4.38:1로 WCAG AA 기준(4.5:1) 미달이었다. 버튼/배지 전용 색상 변수(`--accent-btn`, `--accent-badge`)를 도입해 다른 용도의 `--accent`(테두리 등, 대비 규정 대상 아님)는 건드리지 않고 두 케이스만 5:1 이상으로 수정.
- **키보드 접근성 (axe 자동 검사로는 못 잡음, 수동 Tab 테스트로 발견)**: 프로젝트 행, 유사 프로젝트 행, 검토 탭의 Entity 링크, Caller/Callee 행, Entity 검색 결과 행 등 클릭 가능한 `tr`/`div`/`a`(href 없음) 6곳이 `onClick`만 있고 `tabIndex`/`role`/키보드 핸들러가 없어 **Tab으로 절대 도달할 수 없었다** — 마우스 없이는 프로젝트 하나도 열 수 없는 상태였다. 공통 헬퍼 `clickableRowProps()`(`role="button"`, `tabIndex={0}`, Enter/Space 핸들러)를 만들어 6곳 모두에 적용하고, 실제로 Tab → Enter로 프로젝트를 여는 것까지 확인했다.

수정 후 axe-core 위반 6개 화면 상태 전부 0건.

**미해결 (범위 밖으로 남김)**: 서브그래프 시각화(Cytoscape.js 캔버스)의 그래프 노드는 canvas 렌더링이라 키보드로 순회할 수 있는 표준 방법이 없다 — 별도의 "목록 보기" 대안 UI가 필요한 더 큰 설계 과제이므로 이번에는 다루지 않았다. 스크린리더 전체 시나리오 테스트(VoiceOver/NVDA 실기)도 아직 하지 않았다.

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

> **2026-08-11 주석 — 권장 순서와 실제 실행의 괴리**: 실제로는 MVP(1~5에 해당하는 Phase 1) 완료 직후 6·7이 아니라 ROADMAP.md Phase 2 "Project Knowledge Base"(Project Entity·기술 스택 관리·유사 프로젝트 탐색)에 먼저 착수했다 — 이 문서의 P0 항목인 5.1(영향 분석 의미 정의)~5.4(품질 측정 체계)는 그 시점엔 여전히 미착수 상태였다(IMPLEMENTATION_REPORT.md §12~14 참고). 이는 사용자가 명시적으로 Phase 2를 지시했기 때문이며 그 자체로 잘못된 선택은 아니지만, 이 벤치마크 문서가 제안한 우선순위가 실제 의사결정에 그대로 반영되지는 않았다는 사실은 솔직하게 기록해야 한다 — 벤치마크 문서의 실효성을 스스로 점검하는 차원에서 남긴다. **2026-08-12 갱신**: Phase 2 완결과 실제 규모 검증(5.11) 이후 5.1~5.4가 모두 [해결됨]으로 닫혔다(ADR-0008 + 골든 fixture 회귀 하네스, IMPLEMENTATION_REPORT.md §16~17). 이어서 2026-08-11 재검토가 새로 추가한 P0 항목 중 남아있던 5.9(카탈로그 포지셔닝)·5.12(보안 로드맵)도 [해결됨]으로 닫았다(ADR-0009, ADR-0010, IMPLEMENTATION_REPORT.md §18) — 이 문서가 지금까지 제안한 P0 항목(5.1~5.4, 5.9~5.12) 전부가 닫힌 상태다. 남은 미해결 항목은 P1/P2뿐이다(5.5~5.8, 5.16, 5.20). **2026-08-13 갱신**: 5.5(ADR-0011)·5.6(ADR-0012)·5.7(ADR-0013)이 순차로 닫혔다 — 남은 건 5.8(SCIP 호환성 검토)·5.16(배포/운영 성숙도, 부분 해결)·5.20뿐이다.

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
| 2026-08-12 | 0.3 | 실제 규모 검증(typeorm, 5.11)과 그 과정에서 발견한 크래시·관계 유실 결함 2건 수정을 기록. 이어서 ADR-0008(변경 영향 분석)을 설계·구현해 5.1~5.3을 [해결됨]으로 표시(§6 주석 갱신 포함) — `GET /entities/{id}/impact`, `GET /analysis/runs/{id}/changed-impact` 두 endpoint와 Web UI "변경 영향" 탭. IMPLEMENTATION_REPORT.md §15~16, API.md 2.10, openapi.yaml 참고 |
| 2026-08-12 | 0.4 | 5.4(분석 품질 측정 체계)를 [해결됨]으로 표시 — 기존 골든 fixture 9종 + 신규 `dependency-injection` 1종에 `golden.json`(정규화된 Entity/Relationship/Evidence 전체 스냅샷)을 붙이고 `packages/core/test/golden.test.ts`로 CI에서 완전 일치를 강제하는 회귀 하네스를 추가했다. 새 fixture는 §10 알려진 제한사항의 "인터페이스 타입 필드를 통한 DI 호출은 CALLS가 생성되지 않는다"를 golden.json에 명시적으로 박아 회귀 테스트로 승격시켰다. IMPLEMENTATION_REPORT.md §17 참고. §6 주석도 갱신(5.1~5.4 전부 해결) |
| 2026-08-12 | 0.5 | 5.9(카탈로그 포지셔닝)·5.12(보안 로드맵)를 [해결됨]으로 표시 — ADR-0009(카탈로그는 코드 관계 그래프의 보조 기능으로 의도적으로 얕게 유지, Backstage와 정면 경쟁하지 않음)와 ADR-0010(로컬 단일 사용자 전제의 유효기간 + 옵트인 API key 보호장치)을 확정하고 구현했다. README.md/PRD.md 포지셔닝 문구, API.md 1.4, openapi.yaml `ApiKeyAuth` 스킴(부수적으로 기존 `security-defined` 경고 23건도 함께 해소), docker-compose.yml에 반영. 이로써 이 문서가 지금까지 제안한 P0 항목(5.1~5.4, 5.9~5.12) 전부가 닫혔다 — §6 주석 갱신. IMPLEMENTATION_REPORT.md §18 참고 |
| 2026-08-12 | 0.6 | 5.5(정밀 분석 실패 시 폴백 모델)를 [해결됨]으로 표시 — 원안(`resolution: 'unresolved'`)은 `relationship.target_id NOT NULL` 제약과 충돌해 그대로 채택하지 않고, [ADR-0011](./docs/adr/0011-unresolved-references.md)로 Relationship이 아닌 별도의 `unresolved_reference` 진단 테이블을 설계·구현했다. `GET /projects/{id}/stats` 집계 확장, `GET /projects/{id}/unresolved-references` 신규, Web UI "검토" 탭 확장(새 탭 없음). P1/P2 항목을 하나씩 순차 진행하기로 한 것 중 첫 항목. IMPLEMENTATION_REPORT.md §19 참고 |
| 2026-08-12 | 0.7 | 5.6(Graph-only Context Builder)을 [해결됨]으로 표시 — [ADR-0012](./docs/adr/0012-context-builder.md). 초안(`getSubgraph` 재사용)이 `codex exec` 독립 검토에서 "이유가 실제 발견 경로와 다를 수 있다"는 결함을 지적받아, 다중 seed 동시 시작 양방향 BFS(predecessor 추적)로 재설계했다 — `computeImpact`/`getSubgraph`는 건드리지 않았다. `GET /projects/{id}/context`(API.md 2.11) + MCP tool `build_context`(6번째) 양쪽에 공유 core 함수 하나를 노출, Web UI는 만들지 않음. IMPLEMENTATION_REPORT.md §20 참고 |
| 2026-08-13 | 0.8 | 구현 착수 전 사용자 요청으로 유사 오픈소스 리서치를 진행([docs/research/similar-projects.md](./docs/research/similar-projects.md), `codex exec --search` + 교차검증) — "정확히 같은 조합(그래프+resolution 명시+evidence+unresolved 격리+MCP+git diff 증분)을 갖춘 프로젝트는 못 찾았다"는 결론. 이어서 5.7(작업 중심·계층형 시각화)을 [해결됨]으로 표시 — [ADR-0013](./docs/adr/0013-task-oriented-views.md). 세 뷰 중 "변경 보기"는 기존 `impact` 탭이, "호출 보기"는 기존 `ImpactGraph`의 Entity 종류별 초기 프리셋이 충족했고, 새로 만든 건 File→DECLARES 지연 확장 트리("구조 보기", `StructureTree.tsx`) 하나뿐이다. core/API/MCP 변경 없음(기존 endpoint 재사용). IMPLEMENTATION_REPORT.md §21 참고 |
