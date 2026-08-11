# ADR-0007: 확장성(NFR-7) 범위 — 지금은 TypeScript 전용으로 유지

- **상태**: 확정
- **날짜**: 2026-08-11
- **근거 문서**: PRD.md NFR-7, BENCHMARK.md 5.14, IMPLEMENTATION_REPORT.md §8(FR별 구현 상태)

## 배경

PRD의 NFR-7은 "Parser/Resolver 플러그인화"를 요구한다. 실제로는 `loadProgram`/`resolveSymbol`/Analyzer 등 함수 경계는 분리되어 있지만, 다른 언어를 붙일 수 있는 실제 플러그인 인터페이스는 없다 — TypeScript Compiler API에 직접 결합되어 있다(IMPLEMENTATION_REPORT.md §8).

경쟁 벤치마킹 검토(BENCHMARK.md 5.14)에서 이 상태를 "목표(NFR-7)만 있고 결정도 구현도 없는 애매한 상태"로 지적했다 — Joern(언어별 frontend 분리), Sourcegraph(SCIP로 인덱서·소비 계층 분리)와 비교하면 확장점이 없다는 것이다. 이 ADR은 그 애매함을 명시적 결정으로 정리한다.

## 결정

**지금은 TypeScript 전용으로 남기고, 실제 플러그인 인터페이스를 설계·구현하지 않는다.**

이유:

1. **claude-do.md 범위 밖**: 최초 구현 지시서가 다중 언어 지원을 요구하지 않았다. 실제 수요 없이 플러그인 인터페이스를 먼저 설계하는 것은 추측성 확장(YAGNI 위반)이다.
2. **다중 언어 지원은 인터페이스 설계만으로 끝나지 않는다**: Entity id 스킴(`{projectId}/sym:{filePath}#{symbolPath}`), Evidence 스니펫 추출, resolution(`static`/`inferred`) 판정 규칙 모두 TypeScript Compiler API의 구체적 동작에 맞춰져 있다. 언어 중립적 계약으로 재설계하려면 실제 두 번째 언어 사례 없이는 올바른 추상화 경계를 잡기 어렵다.
3. **이미 SCIP 어댑터 방향이 로드맵에 있다**: BENCHMARK.md 5.8(SCIP 호환성 검토)이 "향후 언어 Analyzer는 SCIP Importer로 흡수"하는 어댑터 구조를 이미 제안하고 있다. 자체 플러그인 인터페이스를 별도로 또 설계하는 것은 두 가지 확장 메커니즘을 만드는 셈이라 비효율적이다.

NFR-7은 "Parser/Resolver가 모듈 경계로 분리되어 있다"(현재 상태)로 최소 충족된 것으로 재해석한다 — "런타임에 교체 가능한 플러그인"까지는 요구하지 않는다.

## 하지 않는 것

- 지금 플러그인 인터페이스를 설계하거나 구현하지 않는다.
- 다중 언어 Analyzer의 뼈대(추상 클래스, 언어 레지스트리 등)를 미리 만들지 않는다.
- ROADMAP.md의 Java/Spring 같은 예시 문구를 실제 구현 계획으로 승격하지 않는다(ROADMAP.md 갱신은 별도 항목, BENCHMARK.md 5.15).

## 재검토 조건

실제로 두 번째 언어(예: Java) 지원이 확정되는 시점에 이 결정을 재검토한다. 그때는 처음부터 자체 플러그인 인터페이스를 설계하기보다, BENCHMARK.md 5.8이 제안한 SCIP 어댑터 경로를 먼저 검토한다.
