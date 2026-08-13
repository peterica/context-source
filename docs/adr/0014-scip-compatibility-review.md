# ADR-0014: SCIP 호환성 검토 (BENCHMARK.md 5.8)

- **상태**: 채택 — 순수 검토 문서, 코드 변경 없음
- **날짜**: 2026-08-13
- **근거 문서**: BENCHMARK.md 5.8, ADR-0007(확장성 범위 — TypeScript 전용 유지), DATA-MODEL.md, docs/research/similar-projects.md

## 배경

BENCHMARK.md 5.8은 "모든 언어의 인덱서를 직접 개발하지 않도록" SCIP(Sourcegraph의 언어 중립 코드 인텔리전스 교환 형식)를 어댑터로 흡수하는 구조를 제안했다:

```text
TypeScript Analyzer ─┐
SCIP Importer ───────┼→ Normalized Relationship Model
향후 언어 Analyzer ─┘
```

ADR-0007이 이미 "실제 두 번째 언어 수요가 확인되기 전까지는 플러그인 인터페이스를 설계하지 않는다"고 결정하면서, 그 "재검토 조건"에서 "그때는 SCIP 어댑터 경로를 먼저 검토한다"고 명시했다. 이 항목은 그 검토를 지금 미리 해두는 것이다 — **코드를 만드는 항목이 아니라, "SCIP를 실제로 가져다 썼을 때 우리 모델의 어디가 채워지고 어디가 안 채워지는가"를 확인하는 항목**이다. 다중 언어 지원은 ROADMAP.md 어디에도 배정돼 있지 않으므로(ADR-0007 재검토 조건 미충족) 지금 구현하지 않는다 — 이 ADR의 산출물은 결정과 문서뿐이다.

## 검토 방법

SCIP 프로토버프 스키마(`scip.proto` — `Index`/`Document`/`SymbolInformation`/`Occurrence`/`Relationship`)를 직접 확인하고, 각 메시지가 ContextSource의 Entity/Relationship/Evidence 모델(DATA-MODEL.md)의 어느 부분에 대응하는지 하나씩 대조했다.

## 검토 결과 — 매핑표

| ContextSource 개념 | SCIP으로 채울 수 있는가 | 근거 |
|---|---|---|
| Entity(file) | **된다** | `Document.relative_path` |
| Entity(class/interface/function/method) | **된다** | `SymbolInformation.kind`(세분화된 심볼 종류 — Method/Function/Class 등) + `Document.symbols` |
| Relationship: DECLARES | **된다(간접)** | SCIP은 "이 Document가 이 심볼들을 담고 있다"까지는 주지만, 컨테이너-멤버 계층(File→Class→Method) 자체는 우리처럼 명시적 edge가 아니라 심볼 이름의 계층적 인코딩(descriptor path)에서 파싱해야 한다 |
| Relationship: IMPLEMENTS | **된다** | `Relationship.is_implementation` |
| Relationship: EXTENDS | **부분적** | SCIP 스키마 자체에 상속 전용 필드가 없다 — `is_implementation`/`is_type_definition`을 인덱서가 상속에도 재사용하는지는 인덱서 구현마다 다르다. 인덱서별 실제 출력을 확인하지 않고는 신뢰할 수 없다 |
| Relationship: IMPORTS | **된다(간접)** | `Occurrence.symbol_roles`의 import 비트 — 어느 Document의 어느 위치에서 어떤 심볼을 import했는지는 나온다 |
| **Relationship: CALLS** | **안 된다** | SCIP 스키마에는 호출 관계 전용 필드가 없다(검색으로 직접 확인). `Relationship`은 reference/implementation/type_definition/definition 네 종류뿐이다. 함수 본문 범위(`enclosing_range`) 안에서 다른 함수 심볼의 occurrence를 훑어 "이건 호출일 것"이라고 재구성해야 하는데, 이건 SCIP이 주는 게 아니라 **우리가 SCIP 위에 새로 만들어야 하는 별도의 호출 추론 로직**이다 |
| Evidence(스니펫+위치+이유) | **부분적** | `Occurrence.range`로 위치는 나오지만 소스 스니펫과 "왜 이 관계로 판단했는가"는 SCIP에 없다 — 원본 파일을 다시 읽어 range로 슬라이스하고, 관계 종류별 이유 문장은 우리가 새로 작성해야 한다(REASON_TEMPLATES 방식 그대로 재사용 가능) |
| `resolution: static/inferred` | **안 된다(그리고 위험하다)** | SCIP 자체에는 이 개념이 없다. 더 중요한 문제: **SCIP 인덱서의 정밀도는 구현마다 다르다** — 공식 TypeScript/Go 인덱서는 컴파일러 기반이라 정밀하지만, 커뮤니티 인덱서 중에는 tree-sitter 기반(구문 중심, 타입 추론 없음)도 있다. "SCIP에서 온 관계니까 static"이라고 일괄 태깅하면, 실제로는 우리의 `inferred`보다도 부정확한 관계를 `static`으로 과대 주장하게 될 위험이 있다 |
| `unresolved_reference`(확정 실패 진단) | **안 된다(유사 개념은 있음)** | `Occurrence.diagnostics`는 컴파일 오류/경고를 담을 수 있지만 이건 "컴파일이 실패했다"는 의미지, 우리의 "참조는 찾았지만 대상 Entity를 확정 못 했다"는 의미가 아니다 — 별개의 개념이라 그대로 재사용할 수 없다 |

## 결론

**SCIP은 "구조적 뼈대"(파일·심볼·DECLARES/IMPORTS/IMPLEMENTS 골격)를 공짜로 준다. ContextSource를 실제로 ContextSource답게 만드는 부분(CALLS, Evidence, resolution/confidence의 정직한 구분, unresolved_reference)은 SCIP이 주지 않고, 언어마다 우리가 새로 만들어야 한다.**

이건 5.8이 원래 그린 다이어그램("SCIP Importer 하나로 향후 언어를 흡수한다")이 암시하는 것보다 훨씬 적은 이득이다 — "인덱서를 안 만들어도 된다"가 아니라 "심볼 골격 인덱서는 안 만들어도 되지만, 이 프로젝트의 핵심 가치(호출 그래프+근거+정직한 신뢰도)를 위한 언어별 확장 계층은 여전히 각 언어마다 새로 만들어야 한다"가 정확한 요약이다. `docs/research/similar-projects.md`가 확인한 SCIP의 성격("주로 occurrence→symbol 연결과 navigation을 위한 교환 형식이지 범용 relationship/evidence 그래프 제품이 아니다")과도 일치한다.

**그래도 SCIP 경로가 자체 플러그인 인터페이스보다 나은 이유는 여전히 유효하다** — ADR-0007의 판단(자체 인터페이스를 지금 설계하는 것보다, 실제로 두 번째 언어가 필요해졌을 때 이미 있는 언어 중립 표준을 어댑터로 흡수하는 게 낫다)은 이 검토로 바뀌지 않는다. 다만 "SCIP을 붙이면 다국어 지원이 거의 끝난다"는 과도한 기대는 갖지 않아야 한다 — SCIP 어댑터는 전체 작업의 절반(구조)만 대신해주고, 나머지 절반(호출 관계 추론, Evidence 재구성, 신뢰도 재평가)은 언어별로 여전히 남는다.

## 결정

1. **지금 아무것도 구현하지 않는다** — ADR-0007의 결정(실제 두 번째 언어 수요 전까지 플러그인/어댑터 코드를 만들지 않는다)은 그대로 유지한다. 이 ADR은 그 결정을 뒤집지 않는다.
2. **재검토 조건이 실제로 충족되는 시점(두 번째 언어 확정)을 위해 이 매핑표를 미리 남겨둔다** — 그때 가서 "SCIP으로 얼마나 되는가"를 처음부터 다시 조사하지 않도록.
3. **SCIP을 채택하더라도 `resolution`을 일괄 `'static'`으로 태깅하지 않는다** — 인덱서 구현별 정밀도가 다르므로, 실제로 이 경로를 구현하는 시점에는 인덱서별로 신뢰도를 따로 평가해야 한다(예: 컴파일러 기반 공식 인덱서만 `static`으로, tree-sitter 기반 커뮤니티 인덱서는 `inferred`로 태깅하는 등 인덱서 단위의 신뢰도 정책이 별도로 필요하다). 이 정책 자체를 지금 확정하지는 않는다 — 실제 구현 시점에 다시 검토한다.
4. **CALLS와 Evidence는 SCIP 위에 별도로 구현해야 하는 확장 계층으로 남긴다** — 5.8의 다이어그램에 있던 "ContextSource Evidence는 별도 확장 계층으로 유지한다"는 문구를 CALLS까지 포함하도록 이 ADR로 확정한다.

## 하지 않는 것

- SCIP importer 코드를 작성하지 않는다.
- 언어 플러그인 인터페이스나 언어 레지스트리를 만들지 않는다(ADR-0007과 동일).
- 인덱서별 신뢰도 정책을 지금 확정하지 않는다(위 결정 3 — 실제 구현 시점으로 미룸).
- ROADMAP.md에 다중 언어 지원 일정을 추가하지 않는다(ADR-0007 재검토 조건 미충족 — 여전히 실제 수요 없음).
