ContextSource 설계 리뷰

1. 총평

CONDITIONAL PASS

제품 방향, 도메인 모델의 골격, 설계 원칙은 견고하고 MVP 범위 통제 의지도 문서 전반에서 확인됩니다. 그러나 세 문서 사이에 Phase 경계를 직접 위반하는 모순이 3건
있고, 증분 분석·Entity ID·외부 의존성 경계라는 구현 정확성을 좌우하는 3개 지점이 미정의 상태입니다. 이들은 코드를 키우는 문제가 아니라 문서를 고치는          
문제이므로, 해결 후 구현 착수가 가능합니다.
                                                                                                                                                                
---                                                                                                                                                           
2. 잘된 점

- 6개 설계 원칙(Relationship/Evidence/Query-first, Incremental, Uncertainty-aware, Shared Context)이 실제 요구사항에 일관되게 반영됨. 예: "Evidence 없는      
  Relationship은 저장 불가"(4.2)가 성공 지표(Evidence 완전성 0건, 스키마 강제)까지 관통한다.
- 비목표(Non-Goals)가 명확하다. 동적 분석, 코드 품질 평가, 자동 수정, 다중 언어를 명시적으로 제외하여 범위 방어선이 문서화되어 있다.
- OQ 결정 테이블(OQ-1~10)이 핵심 기술 선택을 이유와 함께 기록하고 있어 경량 ADR로 기능한다. 특히 SQLite 자체 스키마 선택(OQ-1)은 로컬 실행 제약과 정합적이고  
  올바른 판단이다.
- Uncertainty-aware(static/inferred 구분)를 도메인 모델 속성으로 격상한 것은 정적 분석 도구가 흔히 놓치는 지점을 초기에 잡은 것이다. NFR-5의 "static은 false  
  positive 0%"는 검증 가능한 기준이다.
- Relationship 5종으로 절제된 시작. READS/WRITES/THROWS를 명시적으로 후속으로 미룬 것은 MVP 통제의 좋은 예다.
- 성공 지표가 측정 방법과 함께 정의되어 있고, 측정 불가능한 지표(AI 답변 품질)는 섣불리 수치화하지 않고 보류했다.

  ---                                                                                                                                                           
3. 반드시 수정해야 하는 사항 (Critical)

C1. Phase 경계 모순 3건 — 문서 간 직접 충돌

MVP 범위가 "흔들리지 않는가"라는 질문에 대해, 현재 문서 상태로는 흔들리고 있다고 답할 수밖에 없습니다.

┌──────────────┬───────────────────────────────────────────┬────────────────────────────────────────────────────────┬────────────────────────────────────┐    
│     항목     │                    PRD                    │                    ROADMAP / README                    │                충돌                │    
├──────────────┼───────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤    
│ Project      │ 4.1에서 MVP Entity Kind로 포함, OQ-8      │ ROADMAP·README 모두 Phase 2 추가 기능으로 명시         │ 같은 기능이 Phase 1이면서 Phase 2  │    
│ Entity       │ 결정으로 확정                             │                                                        │                                    │    
├──────────────┼───────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤    
│ Project      │ 8장 제외 목록: "Project Metadata 제외"    │ OQ-9 결정: "Metadata Entity로 관리한다"                │ 같은 문서(PRD) 안에서 정면 모순.   │    
│ Metadata     │                                           │                                                        │ ROADMAP은 Phase 2로 배치           │    
├──────────────┼───────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤    
│ MCP Server   │ OQ-4 결정: "MCP 지원, AI는 MCP로 Subgraph │ ROADMAP Phase 4 추가 기능: "MCP Server". PRD 8장 포함  │ MVP의 P0 요구사항이 Phase 4        │    
│              │  조회" (FR-Q7/FR-AI1도 P0)                │ 목록에는 AI 인터페이스 항목 자체가 없음                │ 기능으로도 등재                    │    
└──────────────┴───────────────────────────────────────────┴────────────────────────────────────────────────────────┴────────────────────────────────────┘

수정 방향 (범위 확장 없이 해소 가능): Project는 "MVP는 단일 Project를 전제로 한 소속 필드(projectId)만 갖는다. Project를 검색·비교 대상으로 다루는 것은 Phase
2"로 구분해 기술하고, OQ-9 결정은 철회하거나 "스키마에 자리만 예약, 수집은 Phase 2"로 축소하고, ROADMAP Phase 4의 MCP Server는 "MVP MCP의 Hybrid Search       
확장"으로 고쳐 쓰십시오.

C2. Entity 필수 속성 스키마 누락

PRD 4.2(Relationship), 4.3(Evidence)은 필수 속성이 정의되어 있으나 4.1(Entity)은 Kind 목록만 있고 속성 정의가 없습니다. 그런데 FR-A4는 "안정적인 식별자와     
revision 부여"를 P0로 요구하고, FR-Q2는 이름/종류/파일 경로 검색을 요구합니다. 즉 id, kind, name, location, revision, projectId가 기능 요구사항에서 암묵적으로
전제되는데 도메인 모델에는 없습니다. 또한 "모든 Entity는 하나의 Project에 소속된다"가 속성인지 Relationship인지 미정의입니다 — Relationship 5종 중 Project와  
연결되는 타입이 없으므로 현재 관계 모델로는 표현 불가능한 문장입니다.

C3. Entity ID 전략의 내부 모순

OQ-2 결정: "Project + Symbol Path 기반 ID, 파일 이동은 유지." TypeScript에는 전역 네임스페이스가 없으므로 파일 경로 없는 Symbol Path는 유일하지 않습니다(서로
다른 파일의 동명 함수, 두 개의 default export, 오버로드 등이 즉시 충돌). 파일 경로를 ID에 포함하면 파일 이동 시 ID가 바뀌므로 "이동 시 유지"와 모순됩니다.    
MVP에서는 "ID = projectId + 파일 경로 + 심볼 경로, 파일 이동 = 새 ID(관계는 재분석으로 복원됨)"로 단순화하는 것이 정직하고 구현 가능한 선택입니다. 이동 추적은
명시적으로 후속 과제로 미루십시오.

C4. 증분 분석의 역방향 전파 규칙 누락

FR-A6은 "변경된 파일의 Entity와 Relationship만 재분석"이라고 정의하는데, 이는 미변경 파일에서 나가는 관계의 stale 문제를 다루지 않습니다. 예: b.ts의 함수     
이름이 바뀌면, 변경되지 않은 a.ts가 가진 CALLS → b.ts#fn 엣지가 깨진 채 남습니다. 최소한 "변경 파일 + 그 파일을 IMPORTS하는 파일(역방향 1단계 폐쇄)을 재분석  
대상에 포함한다"는 규칙이 FR-A6에 명시되어야 합니다. 이 규칙이 없으면 NFR-5(static false positive 0%)가 증분 분석 후 즉시 깨집니다.

C5. 외부 의존성 경계 미정의

import { z } from 'zod'나 lodash.map() 호출 시 target Entity가 무엇인지 어느 문서도 답하지 않습니다. node_modules 심볼을 Entity로 만들 것인지, 프로젝트 경계  
밖은 특수 노드(예: ExternalModule)로 접을 것인지, 아예 관계를 생성하지 않을 것인지 — 이 결정 없이는 FR-A2(IMPORTS/CALLS 생성)를 구현할 수 없습니다. 실제      
TypeScript 프로젝트의 import 절반 이상이 외부 패키지이므로 첫날부터 부딪히는 문제입니다. 권장: MVP는 프로젝트 내부 심볼 간 관계만 저장하고, 외부 import는     
패키지 단위 ExternalModule 노드로 접는다 수준의 한 줄 결정이면 충분합니다.

C6. File = Module 결정과 Entity 목록 불일치

OQ-7 결정은 "File을 Module로 간주"인데 PRD 4.1과 FR-A1은 여전히 File과 Module을 별개 Kind로 나란히 나열합니다. 그대로 구현하면 모든 파일마다 중복 노드 2개가  
생깁니다. Module을 MVP Entity 목록에서 제거하거나, "MVP에서 Module Kind는 생성하지 않는다"를 명시하십시오. (책임 중복의 전형적 사례입니다.)

C7. Docker Compose 구성의 기술적 오류

ROADMAP의 compose 구성(analyzer / api / ui / SQLite)에서 SQLite는 서버 프로세스가 아니라 임베디드 라이브러리이므로 서비스로 존재할 수 없습니다. 더 중요한 파생
문제 두 가지: (1) analyzer와 api가 별도 컨테이너에서 공유 볼륨의 SQLite 파일에 동시 쓰기/읽기를 하는 구성은 파일 잠금 문제로 위험하며, (2) analyzer           
컨테이너가 분석 대상인 호스트의 git 저장소에 어떻게 접근하는지(볼륨 마운트 규약)가 미정의입니다. 권장: api 서비스 하나가 SQLite를 소유하고 analyzer는 CLI 또는
api 내부 모듈로 통합, 분석 대상은 read-only 볼륨 마운트 — 서비스 수를 줄이는 방향이므로 범위 확장이 아닙니다.
                                                                                                                                                                
---                                                                                                                                                           
4. 권장 개선 사항 (Nice to Have)

- confidence 스케일 정의: 0~1 실수인지 enum(certain/probable/possible)인지 미정. resolution(static/inferred)과 역할이 겹치므로, MVP에서는 confidence를 빼고   
  resolution만 쓰는 단순화도 검토할 가치가 있습니다.
- Data Model / Query API 스펙 문서 부재: 검토 대상에 있었으나 저장소에 없습니다. 구현 첫 단계가 SQLite 스키마(DDL)와 Query API 엔드포인트 목록 확정이 되어야  
  하므로, 짧은 DATA-MODEL.md와 API.md 초안을 구현 직전에 작성하길 권합니다.
- OQ 결정 테이블의 ADR 승격: 결정 10건이 PRD의 열린 질문 섹션에 붙어 있어 "열린 질문"과 "확정 결정"이 한 표에 섞여 있습니다. adr/ 디렉터리로 분리하면 결정    
  이력 추적이 쉬워집니다.
- PRD 11장 마일스톤 복원: 현재 Phase 1~4 테이블은 ROADMAP의 중복입니다. PRD에는 MVP 내부의 구현 순서(분석 코어 → 저장/Query → 증분 → 시각화 → MCP)가 있어야   
  착수 순서를 안내할 수 있습니다.
- 분석 대상 지정 방법 명시: 분석 진입점이 tsconfig.json 기준인지, 디렉터리 glob인지 미정. tsconfig 기준을 권장합니다(TypeScript Compiler API와 자연스럽게     
  정합).
- 파서 선택 명시: FR-A2의 심볼 해석(호출 대상 확정)은 사실상 TypeScript Compiler API(TypeChecker)를 요구합니다. tree-sitter로는 NFR-5를 만족할 수 없으므로, 이
  결정을 ADR 한 줄로 박아두면 구현 방향이 고정됩니다.
- recall 95% 측정용 골든 데이터셋: 측정 방법이 "수작업 검증"인데 대상 샘플 코드베이스를 미리 지정해 두면(예: 소규모 오픈소스 TS 프로젝트 1개) 지표가 실행     
  가능해집니다.

  ---                                                                                                                                                           
5. MVP 구현 가능 여부

가능합니다. 단, 3장의 Critical 항목(특히 C2~C5) 해소가 선행 조건입니다.

가능하다고 판단하는 근거:

1. 기술적 미지수가 없다. 파이프라인의 모든 단계가 검증된 도구로 구성 가능합니다 — TypeScript Compiler API가 AST 생성과 심볼 해석(FR-A1, A2)을 모두 제공하고,  
   Evidence의 모든 필드(경로·range·snippet·revision)는 Compiler API + git rev-parse로 직접 획득 가능하며, depth 제한 서브그래프 탐색(FR-Q4)은 SQLite recursive   
   CTE로 표준적으로 구현됩니다.
2. 범위가 산술적으로 작다. Entity 6종(Module 중복 제거 시), Relationship 5종, Query 4종(검색/caller·callee/서브그래프/영향 그래프)이며, 각각이 독립적으로     
   테스트 가능한 단위입니다.
3. 성능 목표가 보수적이다. 10만 LOC 수 분 인덱싱, Query 1초는 SQLite + 인덱스 설계로 여유 있게 달성 가능한 수치입니다. M1 8GB 제약도 이 스택에서는 병목이     
   아닙니다.
4. 가장 어려운 문제(불확실한 관계 처리)에 이미 탈출구가 있다. 동적 호출·고차함수 등 정적으로 확정 불가한 케이스를 inferred로 격리하는 설계 덕분에, 구현이     
   "완벽한 해석"이 아니라 "확실한 것만 static으로"라는 달성 가능한 기준을 갖습니다.

반대로, Critical을 해소하지 않고 착수하면 막히는 지점도 명확합니다: 외부 import를 만나는 순간(C5), 첫 증분 분석에서 stale 엣지가 생기는 순간(C4), Entity      
테이블 DDL을 쓰는 순간(C2, C3)입니다. 셋 다 문서 수정으로 해결되는 문제이므로, PRD/ROADMAP 정합성 수정 → DDL·API 초안 → 구현 착수 순서를 권합니다.    