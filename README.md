ContextSource는 코드 관계를 중심으로 시스템을 이해하고, 장기적으로 AI를 위한 Context Platform을 구축하는 프로젝트이다.

# ContextSource 핵심 정리

## 프로젝트 목적

ContextSource는 소스 코드를 **Entity, Relationship, Evidence**로 변환하여 사람이든 AI든 동일한 관계 모델로 시스템을 이해할 수 있도록 하는 **Code Relationship Analyzer**이다.

코드를 파일이나 디렉터리 단위가 아니라 **관계(Graph)** 중심으로 이해하는 것이 핵심이다.

---

## 핵심 가치

- 코드를 Graph로 변환
- 모든 관계는 Evidence를 통해 원본 코드로 추적
- 사람과 AI가 동일한 Context 공유
- Query 기반 코드 탐색
- 변경 영향도 분석
- Git Diff 기반 증분 분석
- 로컬 실행 지원

---

## MVP (Phase 1)

- 단일 TypeScript 프로젝트 분석
- Entity 추출
- Relationship 생성
- Evidence 연결
- Graph 저장
- Query API
- 관계 시각화
- AI Subgraph 제공

---

## 향후 로드맵

### Phase 1
Code Relationship Analyzer

### Phase 2
Project Knowledge Base

- Project Entity (MVP의 projectId 속성을 독립 Entity로 승격)
- 기술 스택 관리
- 프로젝트 검색
- 유사 프로젝트 탐색

### Phase 3
Semantic Code Knowledge Base

- 코드 임베딩
- 유사 코드 검색
- Cross Project Recommendation

### Phase 4
AI Context Engine

- Graph + Vector Hybrid Search
- Context Builder
- MCP Context 확장 (기본 MCP Subgraph 조회는 Phase 1에서 제공)
- AI Context API

---

## 구현 전략

- Docker Compose 기반 로컬 실행 (api + ui 2개 서비스)
- SQLite 기반 Graph Schema (api에 임베디드, 별도 서비스 아님)
- Pinpoint와 유사한 Graph UI
- Web UI 우선
- Query-first Architecture
- Evidence-first Architecture
- Incremental Analysis

---

## 문서 구성
- README.md : 프로젝트 소개 및 핵심 개념
- PRD.md : MVP 요구사항
- ROADMAP.md : 장기 비전 및 확장 계획
- DATA-MODEL.md : SQLite Graph Schema (DDL)
- API.md : Query API 스펙 (HTTP + MCP)
- BENCHMARK.md : 유사 제품 벤치마킹 및 ContextSource 개선 과제
- BENCHMARK-PROMPT.md : 다른 프로젝트에 적용할 경쟁 벤치마킹 재사용 프롬프트
