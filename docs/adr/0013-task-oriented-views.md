# ADR-0013: 작업 중심·계층형 시각화 (BENCHMARK.md 5.7)

- **상태**: 채택, 구현 완료 (2026-08-13 — web 단계, IMPLEMENTATION_REPORT.md §21)
- **날짜**: 2026-08-12
- **근거 문서**: BENCHMARK.md 5.7, ADR-0008(변경 영향 분석), API.md 2.1·2.3·2.5
- **검토**: 구현 착수 전 사용자 요청으로 유사 오픈소스를 리서치했다([docs/research/similar-projects.md](../research/similar-projects.md)) — 이 항목의 설계 자체를 바꾸지는 않았고(웹 UI 정보구조 문제라 그래프 데이터 모델 포지셔닝과는 무관), 이 ADR은 리서치 이전 설계 그대로 구현됐다.

## 배경

BENCHMARK.md 5.7은 "전체 그래프 화면 하나" 대신 최소 세 가지 작업 중심 뷰(구조 보기/호출 보기/변경 보기)를 요구하고, File → Class → Method로 점진적으로 펼치는 계층형 탐색을 요구한다.

**지금 실제로 없는 것과 있는 것을 먼저 구분한다** — Web UI 소스(`ProjectWorkspace.tsx`, `EntityExplorer.tsx`, `ImpactGraph.tsx`)와 API를 점검한 결과:

| 5.7이 요구하는 뷰 | 지금 상태 |
|---|---|
| 변경 보기 (Git diff 포함 Entity, 영향 후보·검토 경로) | **이미 있다** — `impact` 탭(ADR-0008)이 정확히 이 목적으로 존재한다. 그래프가 아니라 그룹화된 목록(직접/간접/테스트 추정)이지만, "전체 그래프 화면 하나"와 대비되는 작업 중심 뷰라는 5.7의 취지 자체는 이미 충족한다. |
| 호출 보기 (Function/Method, 호출자·피호출자 탐색) | **부분적으로 있다** — `EntityExplorer` 안의 `ImpactGraph`가 이미 CALLS 포함 임의 방향/깊이/타입 조합을 그릴 수 있다. 다만 진입 시 기본값이 `direction='in'`, `types=전체 5종`이라 "호출자·피호출자"를 보려면 매번 수동으로 방향을 `both`로, 타입을 CALLS만으로 바꿔야 한다. |
| 구조 보기 (File/Class/Interface, 온보딩·전체 구조 이해) | **없다** — 지금 그래프에 들어가려면 먼저 검색으로 특정 Entity 하나를 골라야 한다(`rootId` 필수). "아무것도 모르는 상태에서 프로젝트 전체 구조를 훑어본다"는 진입 경로 자체가 없다. File → Class → Method 계층형 드릴다운도 없다(있는 그래프는 Cytoscape dagre 평면 배치 하나뿐). |

**결론**: 5.7이 요구하는 세 뷰 중 둘(변경 보기, 호출 보기)은 기존 인프라를 그대로 또는 프리셋만 얹어 재사용할 수 있다. 진짜 새로 만들 것은 "구조 보기" 하나 — File 목록에서 시작해 DECLARES를 따라 펼치는 계층형 트리 — 뿐이다. 새 core/API/MCP 작업은 없다: 필요한 조회는 기존 `GET /entities?kind=file`(API.md 2.1)과 `GET /entities/{id}/relationships?direction=out&types=DECLARES`(API.md 2.3)로 이미 가능하다.

## 결정 1 — 구조 보기: 새 탭 + 새 컴포넌트(`StructureTree`), File 목록을 루트로 DECLARES를 지연 확장하는 범용 트리

`ProjectWorkspace`에 새 탭 `structure`("구조")를 `overview`와 `explore` 사이에 추가한다(온보딩 동선상 개요 다음 순서).

트리 루트: `GET /projects/{id}/entities?kind=file&limit=&offset=`로 프로젝트의 모든 File Entity를 가져와 최상위 노드로 나열한다(페이지네이션 — 대형 프로젝트에서 한 번에 수천 개를 그리지 않는다).

노드 확장(지연 로드): 특정 노드를 펼치면 `GET /entities/{id}/relationships?direction=out&types=DECLARES`를 호출해 그 Entity가 DECLARES하는 counterpart들을 자식으로 붙인다. 이미 로드한 자식은 캐시하고 재확장 시 재요청하지 않는다.

**"File → Class → Method" 3단으로 하드코딩하지 않는다** — 분석기(`file-analyzer.ts`)의 `containerEntityId`는 함수 내부에 중첩 함수가 있으면 그 함수 자신이 될 수 있어(예: 함수가 함수를 DECLARES), 실제 DECLARES 트리 깊이가 3단을 넘을 수 있다. 그러므로 트리는 "이 노드가 DECLARES하는 자식이 있으면 펼침 화살표를 보여준다"는 범용 재귀로 만들고, File/Class/Method는 전형적인 사례일 뿐 강제 스키마로 두지 않는다.

리프 또는 임의 노드 클릭 시 "탐색" 탭으로 이동해 그 Entity를 선택한 상태로 연다(기존 `onSelectEntity`/`onNavigate('explore', id)` 경로 재사용 — `ProjectWorkspace.tsx:58` 참고).

## 결정 2 — 호출 보기: 새 탭을 만들지 않고 `ImpactGraph`의 초기 상태를 Entity 종류에 따라 프리셋한다

`ImpactGraph`(`ImpactGraph.tsx:35-38`)의 `direction`/`types` `useState` 초기값을 고정 리터럴 대신, 새 선택적 prop `rootKind: EntityKind`을 받아 계산한다:

- `rootKind`이 `function` 또는 `method`이면 → 초기값 `direction='both'`, `types=new Set(['CALLS'])` ("호출자·피호출자 탐색").
- 그 외(`class`/`interface`/`file`/`external_module`)이면 → 초기값 `direction='out'`, `types=new Set(['DECLARES','EXTENDS','IMPLEMENTS'])`.

`EntityExplorer`는 이미 선택된 `entity.kind`를 갖고 있으므로 `<ImpactGraph rootKind={entity.kind} ... />`로 한 줄만 넘긴다. 기존 수동 컨트롤(방향 셀렉트, 타입 체크박스, resolution 필터, depth 슬라이더)은 전혀 건드리지 않는다 — 프리셋은 "처음 그렸을 때 무엇을 보여줄지"만 바꿀 뿐, 사용자는 언제든 그대로 수동 조정할 수 있다. `ImpactGraph`를 별도 "호출 보기" 탭으로 중복해서 새로 만들지 않는다 — 지금도 탐색 탭에서 함수/메서드를 선택하면 사실상 호출 보기가 되므로, 새 화면을 만드는 건 같은 기능의 중복이다.

## 결정 3 — 변경 보기: 기존 `impact` 탭을 그대로 5.7의 "변경 보기"로 삼는다

새로 만들지 않는다. `impact` 탭(ADR-0008)이 "Git diff에 포함된 Entity 중심, 영향 후보와 검토 경로 확인"을 이미 정확히 수행한다. 표현이 그래프가 아니라 그룹화된 목록이라는 점은 5.7의 요구사항(뷰의 형식이 아니라 "무엇을 중심으로, 무엇을 위해 보여주는가")을 어기지 않는다 — 오히려 5.7이 대비하려는 "전체 그래프 화면 하나"보다 검토 목적에는 목록이 더 적합하다는 것이 ADR-0008 채택 당시의 판단이었다.

## 하지 않는 것

- core/API/MCP 변경 없음 — 기존 엔드포인트(`GET /entities`, `GET /entities/{id}/relationships`, `GET /subgraph`)만 재사용한다.
- `impact` 탭을 그래프로 다시 만들지 않는다.
- 트리 깊이를 3단으로 강제하지 않는다(위 결정 1 근거).
- `computeImpact`/`buildContext`/`getSubgraph` 등 기존 core 함수는 건드리지 않는다.

## 구현 순서

1. `web`: `StructureTree.tsx` 신규(File 목록 루트 + DECLARES 지연 확장 재귀 트리, 탐색 탭으로 이동하는 클릭 핸들러).
2. `web`: `router.ts`의 `Tab` 유니온에 `'structure'` 추가, `ProjectWorkspace.tsx`에 탭 버튼·라우팅 추가(`overview`와 `explore` 사이).
3. `web`: `ImpactGraph.tsx`에 `rootKind` prop 추가 + 초기 `useState` 계산 로직 변경, `EntityExplorer.tsx`에서 `rootKind={entity.kind}` 전달.
4. 검증: 기존 `web` 빌드/타입체크 + Playwright로 구조 보기 트리 확장/탐색 이동, 호출 보기 프리셋(함수 선택 시 CALLS+both로 초기 렌더) 확인.
5. `BENCHMARK.md` 5.7 표시, `IMPLEMENTATION_REPORT.md` 부록 추가.
