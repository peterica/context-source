# ContextSource 전체 구현 지시

당신은 ContextSource 프로젝트의 전담 구현자다.

이 저장소에 존재하는 문서와 소스 전체를 먼저 확인한 뒤, PRD에 정의된 ContextSource MVP를 처음부터 끝까지 구현하라.

## 최우선 원칙

1. `PRD.md`를 제품 범위의 SSOT로 사용한다.
2. 문서는 다음 우선순위로 적용한다.
   1. `PRD.md` — MVP 제품 범위
   2. `API.md` — 외부 인터페이스 계약
   3. `DATA-MODEL.md` — 저장 계약
   4. `ROADMAP.md` — Phase 구분
   5. `FOUNDATION.md` — 장기 비전 참고. MVP 범위를 확장하지 않는다
   6. `BENCHMARK.md` — 개선 참고 자료. 명시적으로 PRD에 반영되지 않은 제안은 MVP에 포함하지 않는다
   7. `contextsource_mock.html` — UI 정보 구조 참고. 기능 계약이 아니다
   8. `claude-feedback.md` — 과거 리뷰 기록. 현재 요구사항이 아니다
3. 문서에 정의되지 않은 기능을 임의로 확장하지 않는다.
4. 설계를 새롭게 확대하기보다 현재 PRD를 정확하게 구현한다.
5. 질문이나 승인 대기 없이 합리적인 기본값을 선택해 끝까지 진행한다.
6. 불명확한 사항은 PRD의 Open Questions 결정표를 우선 적용한다.
7. 기존 코드가 있다면 전면 재작성보다 현재 구조를 분석하고 재사용한다.

## 제품 목표

ContextSource는 TypeScript 소스 코드를 정적으로 분석하여 다음 데이터를 생성하는 코드 관계 분석 시스템이다.

```text
Source Code
    ↓
Entity + Relationship + Evidence
    ↓
Storage + Query
    ↓
Web Visualization
    ↓
AI Subgraph Interface
```

핵심 기능은 다음과 같다.

* TypeScript 정적 분석
* Entity 추출
* Relationship 추출
* 모든 Relationship에 Evidence 연결
* caller/callee 및 subgraph 조회
* Git diff 기반 증분 분석
* Web UI 기반 관계 탐색
* AI가 관련 Subgraph와 Evidence를 조회할 수 있는 MCP 인터페이스

Pattern / Component Library는 `FOUNDATION.md`의 장기 비전이며 이번 MVP에서 구현하지 않는다. 자동 코드 생성이나 자동 리팩터링도 구현하지 않는다.

## 구현 순서

아래 순서를 내부 작업 단계로 사용하되, 중간 승인을 기다리지 말고 계속 진행한다.

### M1 — 분석 코어

* 사용자가 지정한 `tsconfig.json`을 분석 진입점으로 사용
* TypeScript Compiler API의 `Program`과 `TypeChecker` 기반 Parser / Resolver
* `include`, `exclude`, `paths`, `baseUrl` 등 tsconfig 설정 준수
* AST 기반 Entity 추출
* Symbol Resolver
* `DECLARES`
* `IMPORTS`
* `CALLS`
* `IMPLEMENTS`
* `EXTENDS`
* ExternalModule 경계 처리
* Evidence 생성
* `static` / `inferred`
* confidence 기록
* 분석 실패 파일 격리
* 전체 분석 CLI

### M2 — 저장 및 Query

* SQLite 기반 Graph Schema
* Entity 저장
* Relationship 저장
* Evidence 저장
* Entity 검색
* caller 조회
* callee 조회
* 방향 및 depth 기반 subgraph 조회
* Relationship type 및 resolution 필터
* HTTP Query API
* 스키마 제약으로 Evidence 없는 Relationship 저장 방지
* 모든 SQLite connection 생성 시 `PRAGMA foreign_keys = ON` 적용 및 활성화 여부 검증
* primary Evidence가 반드시 같은 Relationship에 속하도록 복합 FK 또는 동등한 제약 적용

### M3 — 증분 분석

* Git revision 인식
* Git diff 기반 변경 파일 탐지
* 변경된 파일 재분석
* 변경된 파일을 import하는 파일의 역방향 1단계 재분석
* 삭제된 Entity 및 Relationship 정리
* full scan과 incremental scan 분리
* 분석 이력 저장
* 파일 분석이 성공한 경우에만 해당 파일의 기존 결과를 교체
* 분석 실패 파일은 기존 결과를 보존하고 실패 및 이전 revision 사용 사실을 보고
* 직전 run에서 실패한 파일은 변경 여부와 관계없이 다음 incremental 대상에 다시 포함
* 분석 실패가 없는 incremental 완료 결과가 같은 revision의 full scan 결과와 동일한지 골든 fixture로 검증

### M4 — Web UI

`contextsource_mock.html`의 정보 구조를 참고하되 디자인을 그대로 복제하지 말고 ContextSource 목적에 맞게 구현한다. 목업에 존재하지만 PRD/API에 없는 기능은 구현하지 않는다.

필수 화면:

* 단일 프로젝트 Overview
* 프로젝트 분석 요약
* 분석 상태 및 분석 실행
* Entity / Relationship / Evidence 통계
* 분석 실패 및 inferred 관계 검토 항목
* Entity 검색
* caller / callee 탐색
* 영향 관계 그래프
* depth 조절
* 관계 종류 필터
* static / inferred 시각 구분
* 노드 상세
* Edge Evidence 상세
* 분석 이력

Web UI는 전체 그래프를 한 번에 출력하지 말고 Query-first 방식으로 필요한 Subgraph만 렌더링한다.

### M5 — MCP 연동

읽기 전용 MCP 인터페이스를 제공한다.

최소 도구:

* Entity 검색
* Entity 상세 조회
* caller 조회
* callee 조회
* subgraph 조회

응답에는 관련 Entity, Relationship, Evidence를 포함한다.

토큰 예산 또는 결과 개수 제한 옵션을 지원한다.

## 테스트 요구사항

각 단계마다 테스트를 작성하고 실행한다.

최소 테스트 범위:

* Entity 추출
* Relationship 추출
* Evidence 연결
* ExternalModule 처리
* static / inferred 구분
* overload 처리
* Entity ID 안정성
* caller / callee
* subgraph depth 및 방향
* 증분 분석
* 삭제 파일 처리
* 파싱 실패 파일 격리
* API
* MCP

테스트 실패를 숨기기 위해 테스트를 삭제하거나 조건을 완화하지 않는다.

`static` 관계는 false positive가 없도록 정확성을 우선한다. 정적으로 확정할 수 없는 관계는 `inferred`로 처리한다.

다음 골든 fixture를 만들고 예상 Entity, Relationship, resolution, Evidence를 명시적 assertion 또는 승인된 snapshot으로 검증한다.

* 기본 import와 alias import
* barrel re-export
* interface implementation과 class/interface 상속
* overload와 generic method
* callback 및 higher-order function
* dynamic import와 해석 불가능한 호출
* 외부 패키지 import
* 파일 추가·수정·삭제·이동 및 심볼 이름 변경
* 파싱 실패

증분 분석 fixture는 실제 Git 저장소로 초기화하여 revision과 diff를 검증한다.

## 단계별 품질 Gate

중간 승인을 기다리지는 않되 각 단계의 품질 Gate를 통과한 뒤 다음 단계로 진행한다.

1. M1: 타입 검사, analyzer 단위 테스트, 골든 fixture 정확도 검증 통과
2. M2: 스키마 무결성 테스트와 HTTP API 통합 테스트 통과
3. M3: Git fixture 증분 테스트, 이전 실패 파일 재시도, 실패가 없는 run과 full scan 결과 동등성 검증 통과
4. M4: production build와 브라우저 smoke test 통과
5. M5: MCP tool 통합 smoke test 통과

Gate가 실패하면 원인을 수정하고 다시 검증한다. 실패한 Gate를 건너뛰거나 이후 단계의 구현으로 감추지 않는다.

## 개발 환경

로컬 Mac 환경에서 실행 가능해야 한다.

가능하면 다음 실행 방식을 제공한다.

```bash
docker compose up --build
```

또한 Docker 없이 실행 가능한 개발 명령도 제공한다.

예:

```bash
make setup
make test
make analyze
make run
```

실제 프로젝트 기술 스택은 기존 저장소 구성을 우선한다. 기존 구성이 없다면 TypeScript 생태계에 적합하고 로컬 실행이 단순한 기술을 선택한다.

선택한 런타임, 패키지 관리자, HTTP 프레임워크, SQLite 드라이버, UI 프레임워크와 그래프 라이브러리는 구현 전에 ADR로 기록한다. 핵심 분석·저장·Query는 네트워크 연결 없이 동작해야 한다.

## 문서 갱신

구현과 문서가 불일치하지 않도록 다음 문서를 갱신한다.

* README
* PRD 관련 구현 상태
* Architecture
* Data Model
* API
* Development / Run Guide

새로운 주요 설계 결정을 했다면 ADR을 추가한다.

## 금지사항

* PRD 범위 밖의 대규모 기능 추가
* Vector Search 추가
* 다중 Project 지식 그래프 확장
* Pattern / Component Library 구현
* AI 코드 자동 수정
* 자동 리팩터링
* 외부 패키지 전체 소스 분석
* Evidence 없는 Relationship 생성
* 테스트 삭제 또는 우회
* 동작하지 않는 mock API만 작성
* UI만 만들고 분석 파이프라인을 생략
* 분석 파이프라인만 만들고 UI를 생략
* 분석 대상 저장소의 파일 수정
* 소스 코드를 외부 SaaS나 AI API로 전송
* 비밀키 또는 로컬 자격 증명을 저장소에 기록

분석 대상 저장소는 Docker에서 read-only로 mount한다. 구현 중 파괴적 명령이나 사용자 데이터 삭제가 필요해지면 “질문 없이 진행” 원칙보다 데이터 안전을 우선한다.

## 완료 기준

다음 조건을 모두 만족해야 완료다.

1. 샘플 TypeScript 프로젝트를 분석할 수 있다.
2. Entity, Relationship, Evidence가 SQLite에 저장된다.
3. caller, callee, subgraph API가 실제 데이터로 동작한다.
4. Git diff 기반 증분 분석이 동작한다.
5. Web UI에서 Entity 검색과 관계 그래프 탐색이 가능하다.
6. Edge 선택 시 Evidence를 확인할 수 있다.
7. MCP에서 Subgraph를 조회할 수 있다.
8. lint/format 검사, TypeScript typecheck, 단위·통합 테스트와 production build가 통과한다.
9. Docker Compose, HTTP API, Web UI, MCP smoke test가 통과한다.
10. 분석 실패가 없는 증분 분석 결과가 같은 revision의 full scan 결과와 동일하고, 실패 파일은 다음 run에서 재시도된다.
11. README의 명령만으로 로컬 실행이 가능하다.

## 최종 보고서

모든 작업을 완료한 후 `IMPLEMENTATION_REPORT.md`를 작성한다.

보고서에는 다음을 포함한다.

* 구현 요약
* 사용 기술
* 아키텍처
* 주요 설계 결정
* 변경 파일 목록
* 실행 방법
* 테스트 명령과 결과
* 각 FR 구현 상태
* 완료하지 못한 항목
* 알려진 제한사항
* 다음 단계 권고

작업을 중간에 중단하지 말고, 현재 환경에서 가능한 범위까지 실제 구현과 검증을 완료하라.
