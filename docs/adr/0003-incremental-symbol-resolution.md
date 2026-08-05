# ADR-0003: 증분 분석에서 범위 밖 파일의 심볼을 어떻게 해석하는가

- **상태**: 확정
- **날짜**: 2026-08-06
- **근거 문서**: claude-do.md M3, FR-A6, DATA-MODEL.md §3.2

## 문제

M3 증분 분석은 재분석 대상 파일 집합 `F`(변경 파일 + 역방향 1단계 + 직전 실패 파일)만 다시 분석해야 성능 이점이 있다(NFR-2). `analyzeProject({ onlyFiles: F })`를 처음 구현했을 때, `F` 안의 파일이 `F` 밖의 — 즉 이번 실행에서 재분석되지 않는 — 파일에 있는 Entity를 참조하면(예: `index.ts`가 `F`에 포함되어 재분석되지만 `index.ts`가 IMPORTS/CALLS 하는 `in-memory-task-repository.ts`는 변경되지 않아 `F` 밖에 있는 경우) 그 관계가 통째로 유실되는 버그가 있었다. 원인은 심볼 해석에 쓰는 `nodeToEntityId`/`entitiesById` 맵을 `F` 안의 파일만 순회하며 만들었기 때문에, `F` 밖 파일의 선언은 이번 실행 기준으로 "존재하지 않는" 것으로 취급되어 관계가 조용히 버려진 것이다. 샘플 프로젝트로 재현했고 실제 회귀 테스트(`packages/core/test/incremental.test.ts`의 "preserves relationships into untouched third-party files")로 고정했다.

## 결정

`analyzeProject`는 항상 프로젝트의 **모든** 파일에 대해 Phase A(AST 순회 기반 Entity 추출 — TypeChecker 호출 없음, 비용이 낮음)를 실행해 전역 `nodeToEntityId`/`entitiesById`를 구성한다. 다만:

- **저장/반환 대상**(`AnalysisResult.entities`)은 `onlyFiles` 범위로 필터링한다.
- **Phase B**(관계 해석 — `checker.getSymbolAtLocation`/`getTypeAtLocation` 등 비용이 큰 TypeChecker 호출)의 대상이 되는 pending task는 `onlyFiles` 범위 파일에서만 수집한다.

즉 "무엇을 알고 있는가(심볼 지도)"는 전역이고, "무엇을 다시 계산하고 저장하는가(관계 해석 + DB 쓰기)"는 `F`로 좁힌다. 이렇게 하면:

1. `F` 안의 파일이 `F` 밖의 안정적인(변경되지 않은) 심볼을 참조해도 정확히 해석된다.
2. 증분 분석의 성능 이점(체커 호출과 DB 쓰기 축소)은 그대로 유지된다 — AST 순회만으로는 타입 검사가 일어나지 않아 상대적으로 저렴하다.
3. `F` 밖 파일이 구문 오류로 깨져 있어도(있을 수 없는 상황이지만 방어적으로) 조용히 건너뛰고 실패로 보고하지 않는다 — 실패 보고는 `F` 범위에서만 의미가 있다(그 파일이 실제로 깨져 있었다면 직전 run에서 이미 실패 목록에 있었을 것이고, FR-A6 규칙에 따라 자동으로 `F`에 포함되어 있었을 것이다).

## 대안 검토

- **`F` 밖 파일도 완전히 재분석(Phase A+B 모두)**: 정확하지만 증분 분석의 존재 이유(성능)를 사실상 없앤다. NFR-2("증분 분석은 전체 재분석 대비 유의미하게 빨라야 한다")에 위배되어 채택하지 않음.
- **DB에서 기존 Entity id 목록을 미리 읽어와 시드**: `ts.Node` 객체 참조가 실행마다 새로 생성되는 `ts.Program` 인스턴스에 속해 있어, DB에 저장된 이전 실행의 노드 참조를 재사용할 수 없다. 결국 현재 `Program`에 대해 다시 AST를 순회해야 하므로 위 결정과 동일한 결론에 도달한다.
