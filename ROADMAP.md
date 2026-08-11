# ROADMAP.md

# ContextSource Roadmap

## 프로젝트 비전

ContextSource는 소스 코드를 관계(Graph) 중심으로 이해하고, 장기적으로는 프로젝트 지식과 의미(Vector)까지 활용하는 AI Native Context Platform을 목표로 한다.

---

## Phase 1. Code Relationship Analyzer (MVP)

### 목표

소스 코드를 Entity, Relationship, Evidence로 변환하여 코드 관계를 탐색한다.

### 핵심 기능

- Entity 추출
- Relationship 생성
- Evidence 연결
- Graph Query
- 영향도 분석
- 관계 시각화
- Git Diff 기반 증분 분석
- AI Subgraph 제공 (MCP 기반 서브그래프 조회)

### 결과

사람과 AI가 동일한 관계 모델을 기반으로 코드를 이해한다.

---

## Phase 2. Project Knowledge Base

### 목표

여러 프로젝트를 하나의 저장소에서 관리하고 프로젝트 단위의 지식을 축적한다.

### 추가 기능

- Project Entity (MVP의 `projectId` 속성을 검색·비교 가능한 독립 Entity로 승격) — **구현됨**, ADR-0004
- 기술 스택 관리 — **구현됨**, ADR-0005
  - Language
  - Runtime
  - Framework
  - ORM
  - Database
  - Build Tool

### 기대 효과

- 프로젝트 검색
- 유사 프로젝트 탐색
- 기술 스택 기반 검색
- 프로젝트 간 관계 분석

예)

- Java 21 프로젝트
- Spring Boot 3 프로젝트
- JPA + MySQL 프로젝트

---

## Phase 3. Semantic Code Knowledge Base

### 목표

코드의 의미를 벡터화하여 관계(Graph)와 의미(Vector)를 함께 활용한다.

### 추가 기능

- Class Embedding
- Function Embedding
- Module Embedding
- Semantic Search
- Similar Code Search
- Cross Project Recommendation

예)

- 비슷한 Service 구현 찾기
- 동일한 Repository 패턴 찾기
- 다른 프로젝트의 유사 구현 추천

---

## Phase 4. AI Context Engine

### 목표

Graph와 Vector를 결합하여 AI에게 최적의 Context를 제공한다.

### 추가 기능

- Graph + Vector Hybrid Search
- Context Builder
- MCP Context 확장 (기본 MCP Subgraph 조회는 Phase 1에서 제공하며, Phase 4는 이를 Graph + Vector Hybrid Context로 확장한다)
- AI Context API

### 기대 효과

AI는 전체 프로젝트를 읽지 않고도 필요한 관계와 의미만 전달받아 정확한 분석을 수행한다.

---

# 구현 전략

개발은 단계적으로 진행한다.

1. Code Relationship Analyzer
2. Project Knowledge Base
3. Semantic Code Knowledge Base
4. AI Context Engine

각 단계는 독립적으로 동작하며 이전 단계의 결과를 기반으로 확장한다.

---

# 로컬 개발 환경

초기 구현은 Docker Compose 기반으로 구성하며, 서비스는 두 개다.

- **api**: Query API 서버. SQLite 파일을 단독으로 소유하며, analyzer를 내부 모듈로 포함한다
- **ui**: Web UI

구성 원칙:

- SQLite는 별도 서비스가 아니라 api 컨테이너에 임베디드된 파일 DB다 (서버 프로세스가 아니므로 compose 서비스로 존재할 수 없다)
- SQLite 파일의 쓰기 주체는 api 하나로 제한하여 컨테이너 간 동시 쓰기(파일 잠금) 문제를 원천 차단한다
- 분석 대상 저장소는 api 컨테이너에 **read-only 볼륨**으로 마운트한다

목표는 다음 명령만으로 실행되는 것이다.

```bash
docker compose up
```

MacBook Pro M1 Pro 16GB를 개발 환경으로 사용하고, Mac mini M1 8GB에서도 실행 가능한 수준을 목표로 한다.