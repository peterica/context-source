# 리서치: ContextSource와 유사한 아이디어를 가진 오픈소스 프로젝트

- **리서치 날짜**: 2026-08-13
- **리서치 방법**: `codex exec --search`(OpenAI Codex CLI, 실제 `web_search` 도구를 반복 호출)로 1차 조사 → 그 결과에서 가장 중요한 후보 2건(code2graph, Eshu)을 이 세션에서 `WebFetch`로 직접 재확인.
- **목적**: 사용자가 "나와 같은 생각을 가진 다른 개발자가 이미 만들었을 것 같다"는 가설을 확인하기 위한 조사. ADR-0013(작업 중심·계층형 시각화) 구현에 앞서, 지금까지 쌓은 설계·포지셔닝 판단이 여전히 유효한지 점검하는 목적도 겸한다.
- **표기 규칙**: "검색으로 확인" = Codex가 web_search로 실제 확인. "이 세션에서 재확인" = 위 두 건에 한해 WebFetch로 직접 재검증. "미확인" = 공개 문서에서 찾지 못함(없다고 단정하지 않음). "미검증" = 존재는 확인했지만 해당 속성은 확인하지 못함.

## ContextSource 요약 (비교 기준)

Entity(file/class/interface/function/method/external_module) — Relationship(DECLARES/IMPORTS/CALLS/IMPLEMENTS/EXTENDS) — Evidence(관계마다 소스 스니펫+위치) 3층 그래프. 모든 Relationship에 `resolution: static(TypeScript Compiler API 확정)|inferred(confidence 0.6~0.8)`을 태깅하고, **대상을 확정하지 못한 경우 Relationship을 아예 만들지 않고 별도 `unresolved_reference` 테이블로 격리**한다(그래프가 완전하다고 오인하지 않도록). git diff 기반 증분 분석(변경 파일 + 역방향 import 전이적 폐포), HTTP API, Web UI, MCP 서버(`build_context` 포함)를 제공하며, 벡터 임베딩/RAG는 의도적으로 채택하지 않았다.

---

## 카테고리 1 — MCP로 코드 그래프를 노출하는 프로젝트

| 프로젝트 | 설명 | 상태 | resolution/confidence | evidence | unresolved 격리 |
|---|---|---|---|---|---|
| [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext) | Tree-sitter(+선택적 SCIP)로 파일/심볼/호출/상속/import 그래프를 만들어 MCP·CLI로 제공 | 활성 유지보수 | 미확인 | 미확인 | 미확인 |
| [CartographAI/mcp-server-codegraph](https://github.com/CartographAI/mcp-server-codegraph) | Python/JS/Rust entity·relationship을 MCP 도구로 질의 | 초기, 소규모(23 커밋) | 미확인 | 미확인 | 미확인 |
| [codegraph-ai/CodeGraph](https://github.com/codegraph-ai/CodeGraph) | 38개 언어, Tree-sitter, semantic graph + impact analysis, MCP 도구 42개, `--graph-only` 옵션, content-hash 증분 재색인, git diff 기반 PR context(blast radius/test gap) | 매우 활발한 초기 프로젝트, Apache-2.0 | README에 미확인(다른 동명 프로젝트 ColinVaughn/CodeGraph는 Extracted/Inferred/Ambiguous 주장) | 미확인 | 미확인 |
| [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | 다언어 Tree-sitter → SQLite persistent graph, MCP로 검색/호출경로/impact | 활성/신규(2026 초 공개, 관련 논문도 발표) | 미확인 | 미확인 | 미확인 |
| [andrew-hernandez-paragon/code-graph-context](https://github.com/andrew-hernandez-paragon/code-graph-context) | ts-morph 기반 TypeScript AST 그래프 + Neo4j + vector embedding, MCP, impact analysis | 활성 초기(~16 stars) | dead-code 위험 판단에 한정된 confidence(전체 relationship 대상 아님) | 미확인 | 미확인 |

그 외 검색으로 존재만 확인된 프로젝트: [JudiniLabs/mcp-code-graph](https://github.com/JudiniLabs/mcp-code-graph), [nahisaho/CodeGraphMCPServer](https://github.com/nahisaho/CodeGraphMCPServer), [websines/codegraph-mcp](https://github.com/websines/codegraph-mcp), [FalkorDB/code-graph](https://github.com/FalkorDB/code-graph), [GraphTrail](https://graphtrail.escoffierlabs.dev/) — 전부 confidence/evidence/unresolved 스키마는 공개 문서에서 확인되지 않았다.

**소결**: "코드 그래프 + MCP" 조합 자체는 이미 흔하다(2024~2026년 사이 우후죽순). ContextSource가 여기서 독자적인 지점은 그래프의 존재가 아니라 그 그래프의 각 edge가 얼마나 확실한지, 그리고 확실하지 않은 부분을 어떻게 다루는지다.

---

## 카테고리 2 — 기존 정적 분석/코드 인텔리전스 플랫폼

| 프로젝트 | 현재 상태(2026 기준) | ContextSource와 핵심 차이 |
|---|---|---|
| [Sourcegraph SCIP](https://github.com/sourcegraph/scip/releases) | 활성 — 2026-03 독립 community-governed 프로젝트로 전환, Sourcegraph 6.12가 SCIP 0.9.0 사용 | occurrence→symbol 교환 형식이지 relationship/evidence 제품이 아님. edge별 static/inferred 구분은 핵심 스키마에 없음 |
| [Meta Glean](https://github.com/facebookincubator/glean) | 활성 — 2024년 설계 재소개, 대규모 내부 사용 | 범용 fact DB/query engine. 관계마다 단일 confidence를 강제하는 공통 스키마 없음. MCP/토큰예산 context builder 아님 |
| [Google Kythe](https://github.com/kythe/kythe) | 저장소/릴리스는 유지되나 활발도는 상대적으로 낮아 보임(Chromium이 사용 중) | anchor는 위치 근거이지 독립 Evidence 객체가 아님. confidence/resolution 없음 |
| [CodeQL](https://codeql.github.com/docs/codeql-overview/codeql-changelog/) | 매우 활발 — 2026-07 기준 2.26.1까지 지속 릴리스 | 보안/취약점 질의 중심. 일반 CALLS/IMPORTS edge마다 evidence를 강제하지 않음, 공통 resolution 필드 없음 |
| [Joern](https://github.com/joernio/joern) | 매우 활발 — 2026-05 v4.0.548, 4200+ 커밋, 자동 일일 릴리스 | `Finding` 노드는 evidence 목록을 가질 수 있지만 일반 relationship에는 강제 안 됨. resolution/confidence 공통 필드 없음 |

**소결**: 이 카테고리의 강자들은 전부 활발히 유지보수되고 있지만(단종된 게 아니다), "관계별 static/inferred 정직한 구분"과 "확정 실패를 별도 진단으로 격리"라는 조합은 이들 중 어디에도 1급 시민으로 존재하지 않는다.

---

## 카테고리 3 — AI 코딩 에이전트용 레포 컨텍스트/레포맵 도구

| 프로젝트 | 접근 방식 | confidence/resolution | evidence | 비고 |
|---|---|---|---|---|
| [aider repo-map](https://aider.chat/docs/repomap.html) | Tree-sitter tags + PageRank 그래프 랭킹, 토큰예산 pruning | 없음 | critical source lines는 제공하나 관계별 Evidence 레코드 아님 | 영속 DB/MCP 아님, 대화 시 재생성되는 압축 prompt map |
| [Repomix](https://github.com/yamadashy/repomix) | 저장소 전체를 XML/MD/JSON로 패킹(+선택적 Tree-sitter 압축) | 없음 | 원문 포함이라는 의미에서만 | 그래프도 RAG도 아닌 deterministic packing |
| [Continue](https://github.com/continuedev/continue) | 과거 `@Codebase`는 embedding+rerank, 현재는 agent 파일탐색 중심으로 이동(구 provider는 deprecated) | relevance score만 | 없음 | MCP를 커스텀 context source로 연결 가능 |
| Cursor | semantic search index | 미공개 | 검색 결과 snippet은 있으나 구조화된 관계 evidence 아님 | 상용, 비-오픈소스 |
| Windsurf | RAG retrieval engine(공식 문서가 명시) | 미공개 | 미공개 | 상용, 비-오픈소스 |
| Greptile | 함수/클래스/dependency graph 기반 PR 리뷰 | 미확인 | PR 댓글의 파일/라인은 있으나 relationship evidence 모델 아님 | 상용, 엔진 비공개 |
| [Sweep AI](https://github.com/sweepai/sweep) | vector search 기반 code chunk 선택 | 없음(공개 설명 기준) | 없음 | 2026년 활동 여부 **미검증**(최근 릴리스 확인 못함) |

**소결**: 이 카테고리는 대부분 임베딩/RAG 아니면 압축된 텍스트 맵이다. "관계 단위의 confidence·evidence"라는 개념 자체가 이 카테고리에는 거의 없다 — ContextSource가 이들과 가장 뚜렷하게 갈라지는 지점.

---

## 카테고리 4 — resolution/confidence + evidence를 명시적으로 다루는 프로젝트 (가장 근접한 후보들)

### NodeDB-Lab/code2graph — edge resolution 데이터 모델이 가장 근접

- **설명**: Tree-sitter 기반 다중언어 symbol/reference 추출 + cross-file edge resolution을 수행하는 storage-neutral Rust 라이브러리.
- **상태**: `docs.rs` 기준 `0.0.0-beta.15`(2026-07-19), 385 커밋, pre-0.1의 초기 활발한 개발 단계. **이 세션에서 GitHub README를 직접 재확인함.**
- **핵심 스키마(README 원문 확인)**: `"each edge records its source and target IDs, relationship role, confidence, provenance, and reference occurrence"`, `"Every resolver emits the same CodeGraph schema, tagging each edge with a Confidence (how sure) and a Provenance (which analysis derived it)"`. Confidence는 `NameOnly/Scoped/Exact`, Provenance는 `SymbolTable/ScopeGraph/LocalType/Conformance/FfiBridge/External/NormalizedName` 등으로 세분화되어 있다.
- **ContextSource와 유사점**: 확정도와 해석 방법을 edge의 1급 데이터로 노출, 정확한 resolver와 이름 기반 추론을 구분, 임베딩 불필요한 결정적 구조 그래프.
- **핵심 차이점**: (1) ContextSource의 이진(`static/inferred`+숫자 confidence)보다 다단계 vocabulary가 더 세밀하다. (2) **가장 중요한 차이** — code2graph는 확정 못 한 참조를 `External`이라는 provenance가 붙은 edge로 그래프 **안에** 만든다. ContextSource는 확정 못 하면 Relationship을 아예 만들지 않고 그래프 **밖의** `unresolved_reference`로 격리한다 — 이 "격리" 정책 자체가 code2graph에는 없다. (3) 별도 Evidence 엔티티/스니펫 저장은 미확인(reference occurrence가 근거 위치 역할). (4) MCP, Web UI, git-aware 증분 분석은 core에 없음(문서가 스스로 "storage/product opinion 없음"이라고 명시).
- **확신도**: 존재·핵심 스키마 문구 모두 **이 세션에서 직접 재확인**.

### Eshu — 전체 제품 철학(그래프+MCP+evidence)에서 가장 근접

- **설명**: 코드·의존성·인프라·운영 지식을 하나의 evidence graph로 통합하고 HTTP와 MCP에서 같은 정보를 반환하는 자체 호스팅 플랫폼.
- **상태**: Go, 3,467 커밋(main), 55 열린 이슈, 6 PR, 활발한 개발 중. **이 세션에서 GitHub README를 직접 재확인함.**
- **Codex가 보고한 스키마**: 관계마다 resolution method/source family, numeric confidence, reason, truth state(derived/heuristic/unsupported), MCP `get_code_relationship_story`/`get_relationship_evidence`, `min_confidence` 필터, missing evidence 개념.
- **이 세션의 재확인 결과**: README 루트 페이지에서는 "evidence-backed source of truth", "Show the evidence behind this service-to-infrastructure link" 같은 표현은 직접 확인했으나, **confidence/resolution method/truth state/특정 MCP 도구명 같은 세부 스키마는 루트 README 한 번의 조회로는 재확인하지 못했다** — 더 깊은 문서 페이지에 있을 가능성이 높지만, 이 세부 항목들은 Codex의 검색 결과에 기반한 것으로 표시해둔다(미검증 아님 — Codex는 web_search로 확인했다고 보고했으나, 이 세션이 독립적으로 재검증하지 못했다는 뜻).
- **ContextSource와 유사점**: 그래프 + MCP + 구조화된 provenance/confidence + evidence, heuristic/unsupported 상태를 사용자·에이전트에 그대로 노출, 근거 부족을 `missing_evidence`로 명시.
- **핵심 차이점**: 코드 전용이 아니라 조직 전체 엔지니어링 지식 그래프(운영/보안/인프라 포함) — 범위가 ContextSource보다 훨씬 넓다. PostgreSQL 등 운영 구성이 무겁다. TypeScript Compiler API 수준의 단일 언어 정밀 분석이 목표가 아니다. `unresolved_reference`처럼 확정 실패를 그래프 밖 별도 테이블로 격리하는지는 미확인.

### 그 외 주목할 후보

- **[ColinVaughn/CodeGraph](https://github.com/ColinVaughn/CodeGraph)**: 저자가 모든 edge를 `Extracted/Inferred/Ambiguous`로 표시한다고 설명 — 프로젝트 존재와 주장은 검색으로 확인했지만 안정된 공식 스키마 문서까지는 교차검증하지 못함(부분 검증). evidence/unresolved 별도 모델은 미확인.
- **[Joern CPG](https://cpg.joern.io/)**: `Finding` 노드가 evidence node 목록을 가질 수 있으나, 일반 relationship 전체에 강제되지 않음.
- **CAST Imaging**(상용, 비-오픈소스): 관계를 `Static/Dynamic/Remote`로 구분하고 dynamic link를 reviewed/unreviewed로 표시 — "static과 inferred를 사용자에게 드러낸다"는 발상 자체는 상용 코드 인텔리전스 제품에도 이미 존재한다는 선행 사례로서 의미가 있다.

---

## 기능 조합 비교표

| 프로젝트 | 코드 그래프 | 관계별 resolution/confidence | 관계별 evidence | 미확정 부분의 격리 | MCP | git diff 증분 |
|---|---|---|---|---|---|---|
| **ContextSource** | O | O (모든 관계) | O (별도 Evidence) | O (별도 `unresolved_reference`) | O | O (역방향 import 폐포) |
| NodeDB-Lab/code2graph | O | O (모든 edge) | 위치(occurrence)만 | X (External edge로 그래프 안에 편입) | core에 없음 | 미확인 |
| Eshu | O | O (보고 기준, 세부 미재확인) | O (보고 기준) | 미확인 | O | 부분적(재분석 알고리즘 미확인) |
| codegraph-ai/CodeGraph | O | 미확인 | 미확인 | 미확인 | O | O (content-hash + git diff) |
| Joern | O | 일반 edge엔 없음 | Finding에 한정 | 부분적 | core에 없음 | 부분적 |
| Glean / SCIP | 사실DB/인덱스 | 공통 필드 없음 | 위치 기반 | 진단 가능(표준 아님) | 없음 | 강력함(생태계 차원) |
| aider repo-map / Repomix | 랭킹/패킹 | 없음 | 부분적 | 없음 | 없음 | 대화 시 재생성 |

---

## 종합 결론

**1. ContextSource와 정확히 같은 조합(그래프 + 모든 관계의 resolution/confidence 명시 + 관계별 evidence + 미확정 부분의 그래프 밖 격리 + MCP + git diff 역의존 증분)을 모두 갖춘 오픈소스 프로젝트는, 이번 리서치 범위에서 발견하지 못했다.**

**2. 가장 근접한 후보는 관점에 따라 둘로 갈린다.**
- Edge resolution 데이터 모델 자체는 **NodeDB-Lab/code2graph**가 가장 가깝다(모든 edge에 confidence+provenance) — 다만 확정 실패를 그래프 안의 `External` edge로 다루지, ContextSource처럼 그래프 밖으로 격리하지 않는다.
- 전체 제품 철학(그래프+MCP+evidence+heuristic 노출)은 **Eshu**가 가장 가깝다 — 다만 코드 전용이 아니라 훨씬 넓은 범위(인프라/보안/운영)를 다루는 무거운 플랫폼이다.
- 실용적 MCP+git-diff 조합으로는 **codegraph-ai/CodeGraph**가 근접하지만 confidence/evidence 정직성은 공개 문서에서 확인되지 않았다.

**3. 개별 조각의 흔함/드묾:**
- **이미 흔함**: AST/Tree-sitter 기반 코드 그래프, MCP를 통한 callers/callees/impact 노출, 파일 hash 기반 증분 재색인, git diff 기반 blast-radius 분석, 그래프 순회에 토큰 예산 적용.
- **아직 덜 흔함**: 모든 edge에 resolution confidence를 붙이는 것, confidence와 provenance를 별도 축으로 모델링하는 것.
- **실제로 드묾**: 모든 relationship에 evidence를 필수화하는 것, **확정 실패를 낮은-confidence edge로 만들지 않고 별도 unresolved 진단으로 격리하는 것**, 분석 coverage와 blind spot을 검토 UI/MCP 워크플로로 직접 노출하는 것, 이 전부를 embedding-free deterministic context builder + git-diff 역의존 폐포와 결합하는 것.

**결론적으로 사용자의 가설("나와 같은 생각을 가진 개발자가 이미 만들었을 것")은 부분적으로 맞다** — "그래프+confidence+MCP"라는 큰 방향은 2026년 기준 이미 여러 프로젝트(특히 code2graph, Eshu)가 빠르게 수렴하고 있는 영역이다. 다만 ContextSource가 실제로 갖춘 정확한 조합, 특히 **"확정하지 못한 관계는 만들지 않고 별도로 격리해 사각지대를 정직하게 드러낸다"는 정책**은 검색 범위 내에서 그대로 일치하는 사례를 찾지 못했다. 앞으로 이 프로젝트를 외부에 설명할 때는 "confidence가 있다"는 주장보다 이 격리 정책, compiler-confirmed 의미론, evidence의 필수성, git-diff 역의존 폐포의 정확성을 전면에 내세우는 편이 이미 수렴 중인 인접 프로젝트들과 더 뚜렷하게 구분된다.

## 리서치의 한계

- Codex의 web_search 결과에 의존한 부분(특히 카테고리 1~3의 다수 항목, Eshu의 세부 스키마)은 이 세션이 URL 존재와 최상위 설명 정도만 표본 재확인했고, 모든 세부 주장을 하나하나 원문 대조하지는 않았다.
- "활성/비활성" 판단은 각 저장소의 최근 커밋·릴리스 시점에 대한 검색 시점(2026-08-13) 스냅샷이며, 이후 상태가 바뀔 수 있다.
- 비공개(closed-source) 상용 제품(Cursor, Windsurf, Greptile 등)은 공개된 마케팅/문서 수준에서만 비교했다 — 내부 구현이 문서와 다를 가능성을 배제할 수 없다.
