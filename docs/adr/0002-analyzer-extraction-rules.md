# ADR-0002: Entity/Relationship 추출 규칙 (M1 구현 세부 규칙)

- **상태**: 확정
- **날짜**: 2026-08-05
- **근거 문서**: PRD.md 4장, FR-A1~A5, DATA-MODEL.md, claude-do.md M1

PRD/DATA-MODEL은 Entity Kind와 Relationship Type을 정의하지만, AST 수준에서 "무엇을 Function으로 볼 것인가", "호출을 어떻게 static/inferred로 나눌 것인가"는 구현 세부사항으로 남아 있다. claude-do.md 5항("질문 대기 없이 합리적 기본값 선택")에 따라 아래 규칙을 기본값으로 정하고 구현한다. 새로운 Entity/Relationship 종류를 추가하지 않으며, 기존 Kind/Type의 해석만 구체화한다.

## 1. Function Entity 범위

`FunctionDeclaration` 외에, 이름 있는 변수에 대입된 함수 표현식/화살표 함수(`const foo = () => {}`, `export const bar = function () {}`)도 `function` Entity로 인식한다. 실제 TypeScript 코드베이스에서 이 패턴이 지배적이며, 제외하면 recall 목표(95%)를 크게 훼손하기 때문이다. 클래스 필드에 대입된 함수는 `method`가 아니라 해당 클래스 안에서 `Class.fieldName` 심볼 경로를 갖는 `function`으로 취급하지 않고, 클래스 소속이므로 `method`로 취급한다(클래스 멤버는 선언 방식과 무관하게 `method`).

중첩 함수는 `outer.inner`처럼 `.`으로 연결된 symbolPath를 가지며(DATA-MODEL §1), 컨테이너는 가장 가까운 Function/Method/Class이다.

## 2. 오버로드 및 시그니처 전용 선언

구현(`body`)이 없는 선언(오버로드 시그니처, `interface` 메서드 시그니처, `abstract` 메서드, ambient `declare` 선언)은 Entity를 생성하지 않는다. 오버로드는 구현 시그니처 노드 하나만 Entity가 되며(PRD 4.1), TypeScript 심볼의 `valueDeclaration`(구현부)을 통해 호출 지점을 항상 구현 Entity로 귀결시킨다.

Interface는 Entity로 생성되지만 Interface의 메서드 시그니처는 별도 Entity(Method)를 만들지 않는다 — PRD Entity Kind 표에 "Interface 메서드"가 별도로 없고, 구현이 없는 시그니처에 Evidence(코드 근거)를 부여할 실질적 대상(호출 가능한 구현체)이 없기 때문이다.

## 3. DECLARES 범위

`DECLARES`는 File→최상위 Class/Interface/Function, Class→Method 에서만 생성한다. 중첩 함수(Function 안의 Function)는 컨테이너가 Function이므로 이 경우도 컨테이너→중첩 Function으로 `DECLARES`를 생성한다(PRD "컨테이너 → 멤버" 원칙을 함수 중첩에도 동일 적용).

## 4. CALLS 해석 3단계

1. **static**: 호출식의 callee에 대해 `TypeChecker.getSymbolAtLocation`이 반환하는 심볼의 `valueDeclaration`이 프로젝트 내부에서 추출한 Function/Method Entity와 직접 일치하면 `static`, confidence `1.0`.
2. **inferred**: 직접 심볼 해석이 안 되지만(예: 매개변수로 전달된 콜백을 지역 변수에 재대입 후 호출), 호출식 타입의 호출 시그니처(`Type.getCallSignatures()`)가 정확히 1개이고 그 시그니처의 선언 노드가 알려진 Function/Method Entity와 일치하면 `inferred`, confidence `0.8` (DATA-MODEL 3.3의 "근거 유형별 고정값" 원칙 — 타입 시그니처 기반 추정은 항상 0.8).
3. **생성 안 함**: 위 두 경우 모두 실패하면(대상을 특정할 수 없음) 관계를 생성하지 않는다. Evidence 없는 Relationship은 저장할 수 없으므로(PRD 4.2) 대상 Entity를 특정할 수 없는 호출은 만들어낼 방법이 없다 — false positive를 만들지 않기 위한 의도적 누락이며 NFR-5(정확성 우선)를 recall보다 우선한 것이다.

외부 패키지 심볼(예: `lodash.map()`)에 대한 호출은 OQ-11에 따라 관계를 생성하지 않는다.

## 5. IMPORTS 해석

`ts.resolveModuleName`으로 tsconfig의 `paths`/`baseUrl`을 반영해 모듈 지정자를 해석한다. 해석된 파일이 프로젝트 루트 파일 집합에 속하면 내부 `File` Entity를 target으로, `node_modules` 경로로 해석되거나 해석에 실패하면(비상대 경로 기준) `ExternalModule` Entity(패키지 이름 단위로 축약, OQ-11)를 target으로 한다. 항상 `static`, confidence `1.0` — import 바인딩은 컴파일러가 결정하는 사실이므로 불확실성이 없다.

동적 `import('literal')`은 문자열 리터럴이면 위와 동일하게 해석하되 `inferred`(confidence `0.6`)로 기록한다 — 조건부/런타임 실행 여부가 있어 정적 import보다 확실성이 낮다는 설계 원칙(OQ-6)을 반영한다. 지정자가 리터럴이 아니면(계산된 경로) 대상을 특정할 수 없으므로 관계를 생성하지 않는다.

## 6. IMPLEMENTS / EXTENDS

heritage 절의 각 타입을 `checker.getSymbolAtLocation`으로 해석해 내부 Class/Interface Entity에 대응하면 `static`/`1.0`으로 관계를 생성한다. 외부 심볼(예: `extends Error`)로 해석되면 내부 심볼 간에만 관계를 만든다는 원칙(PRD 4.2 "Relationship은 프로젝트 내부 심볼 간에만")에 따라 관계를 생성하지 않는다 — Entity 자체(Class)는 정상적으로 생성된다.

## 7. 파싱 실패 격리

`program.getSyntacticDiagnostics(sourceFile)`에 하나 이상의 진단이 있으면 해당 파일은 분석 실패로 기록하고 그 파일에서 유래하는 Entity/Relationship을 생성하지 않는다. 다른 파일 분석은 계속 진행한다(FR-A8).

## 8. Relationship 중복 제거

동일한 `(type, source, target)` 쌍에 대한 여러 호출/참조 지점은 관계 1건 + Evidence N건으로 합친다(DATA-MODEL 2장 UNIQUE 제약). 관계의 `resolution`은 static evidence가 하나라도 있으면 `static`, 전부 inferred면 `inferred`로 결정한다. Relationship/Evidence id는 내용 기반 해시로 결정적으로 생성하여 재분석 시 동일 관계가 동일 id로 수렴하게 한다(증분 교체의 안정성).
