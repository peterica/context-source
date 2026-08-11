# ADR-0006: 유사 프로젝트 탐색 / 프로젝트 간 관계 분석

- **상태**: 확정 (구현 진행)
- **날짜**: 2026-08-11
- **근거 문서**: `ROADMAP.md` Phase 2 기대 효과("프로젝트 검색", "유사 프로젝트 탐색", "기술 스택 기반 검색", "프로젝트 간 관계 분석"), [ADR-0005](./0005-tech-stack-management.md), `claude-do.md` 금지사항

## 배경

Phase 2의 나머지 두 항목 — "유사 프로젝트 탐색"과 "프로젝트 간 관계 분석" — 을 구현한다. 이 시점에서 사용자가 명시적으로 확인한 범위는 **Phase 2까지**이며, Phase 3(Semantic Code Knowledge Base)·Phase 4(AI Context Engine)는 착수하지 않는다.

claude-do.md는 이번 프로젝트의 최초 구현 지시서로서 다음을 금지사항으로 명시했다.

> - Vector Search 추가
> - 다중 Project 지식 그래프 확장
> - 소스 코드를 외부 SaaS나 AI API로 전송

"유사 프로젝트 탐색"과 "프로젝트 간 관계 분석"이라는 표현만 보면 이 두 금지사항과 충돌하는 것처럼 보인다(유사도 = 보통 임베딩/Vector, 관계 분석 = 보통 그래프). 이 ADR은 **두 금지사항을 어기지 않으면서** 두 기능을 구현하는 방법을 정한다.

## 결정

### 1. 유사도 = 기술 스택 겹침(교집합), Vector 아님

두 프로젝트의 유사도를 ADR-0005의 `project_tech_stack` 태그 집합의 **교집합 크기**로 정의한다.

```
score(A, B) = |tech_stack(A) ∩ tech_stack(B)|
```

- 임베딩 모델, 벡터 인덱스, 외부 API 호출이 전혀 없다 — 순수 SQL 집합 연산이다. claude-do.md의 "Vector Search 추가" 금지와 "소스 코드를 외부 SaaS나 AI API로 전송" 금지 둘 다 위반하지 않는다.
- 소스 코드 자체가 아니라 이미 사용자가 등록/승인한 기술 스택 메타데이터만 사용한다.
- 교집합이 0인(공유 태그 없는) 프로젝트는 "유사"로 취급하지 않고 결과에서 제외한다.

### 2. "관계 분석" = 유사도 결과의 설명, 그래프 아님

"프로젝트 간 관계 분석"은 Project를 Entity/Relationship 그래프에 편입시키거나 Project 사이에 영속적인 관계(엣지)를 저장하는 것으로 구현하지 **않는다** — 그것이 claude-do.md가 금지한 "다중 Project 지식 그래프 확장"이다.

대신 "프로젝트 A와 B가 관련 있다"는 판단의 **근거를 그 자리에서 계산**해 보여준다: 유사 프로젝트 목록의 각 항목에 "공유하는 기술 스택 태그" 목록을 함께 반환한다. 이는

- **조회 시점에 계산되는 파생 데이터**이지, 저장되는 그래프 구조가 아니다.
- Project는 여전히 Entity Kind가 아니고(PRD 4.1, ADR-0004 유지), `relationship` 테이블에 Project 간 새로운 row가 생기지 않는다.
- ContextSource의 핵심 원칙인 Evidence-first와 같은 정신으로, "왜 유사한가"에 대한 근거(공유 태그)를 항상 함께 제공한다.

### 3. "기술 스택 기반 검색" — 새 API 불필요

프로젝트 목록(`GET /projects`)이 이미 각 프로젝트의 `techStack`을 포함해 응답한다(ADR-0005, N+1 방지를 위해 배치 조회). 따라서 "기술 스택으로 필터링"은 Web UI가 이미 받은 목록을 클라이언트에서 필터링하는 것으로 충분하다 — 이름 검색이 이미 같은 방식(클라이언트 필터링)으로 구현되어 있어 일관적이다. 새 endpoint를 추가하지 않는다.

### 4. API

```
GET /projects/{id}/similar?limit=10
```

응답: `{ "items": [ { "project": Project, "sharedTechStack": [TechStackEntry], "score": N } ] }`. `score` 내림차순, 동점이면 이름 오름차순.

### 5. 성능 — N+1 재발 방지

직전 커밋에서 Codex가 지적한 N+1 패턴(프로젝트 목록에서 프로젝트마다 개별 요청)을 반복하지 않는다. `findSimilarProjects`는 `project_tech_stack` 전체를 **한 번의 쿼리**로 읽어 프로젝트별로 메모리에서 묶은 뒤 교집합을 계산한다(대상 프로젝트마다 반복 쿼리하지 않음).

## 하지 않는 것

- 코드 유사도, 임베딩, 벡터 인덱스(Phase 3 범위, 이번에 착수하지 않음)
- Project를 그래프 순회 가능한 노드로 만드는 것
- 기술 스택 외의 요인(코드 규모, 아키텍처 패턴 등)을 유사도에 반영하는 것 — 범위를 명확하고 설명 가능하게 유지한다

## 수정 이력 — 2026-08-11: language/runtime 제외 (스코어링 결함 수정)

경쟁 벤치마킹 검토(서브에이전트 독립 검증)에서 실제 설계 결함을 발견했다: `detectTechStack()`(ADR-0005)은 모든 프로젝트에 예외 없이 `language: TypeScript`/`runtime: Node.js`를 부여한다 — 현재 시스템이 TypeScript/Node.js 전용이라 이 두 값은 사실상 상수다. 원래의 §1 정의(`score = |tech_stack(A) ∩ tech_stack(B)|`)를 그대로 적용하면, 프레임워크·ORM·데이터베이스가 전혀 겹치지 않는 두 프로젝트도 이 상수 태그 2개 때문에 항상 최소 2점의 "유사도"를 갖는 결함이 있었다 — 사실상 무관한 프로젝트를 "유사"로 잘못 판정.

**수정**: `findSimilarProjects`의 교집합 계산에서 `language`/`runtime` 카테고리를 제외한다(`SIMILARITY_IGNORED_CATEGORIES`, `packages/core/src/query/project-queries.ts`). Framework/ORM/Database/Build Tool만 유사도에 반영된다 — 이 4개 카테고리는 프로젝트마다 실제로 다르게 나타나는(opt-in) 신호이기 때문이다. `language`/`runtime` 태그 자체는 여전히 기술 스택 목록에는 표시되지만(정보로서는 유효), 유사도 점수·공유 태그 근거에는 포함되지 않는다. 두 프로젝트가 `language`/`runtime`만 공유하고 나머지가 전부 다르면 이제 유사 프로젝트 목록에서 완전히 제외된다(회귀 테스트: `packages/core/test/project-repo.test.ts`, `packages/api/test/similar-projects.test.ts`).

다국어 지원이 추가되어 `language`/`runtime`이 실제로 프로젝트마다 달라지는 시점이 오면, 이 제외 목록은 재검토가 필요하다.
