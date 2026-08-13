# ADR-0015: 로그 수집·메트릭 endpoint (BENCHMARK.md 5.16 잔여분)

- **상태**: 채택, 구현 완료 (2026-08-13 — api/ui 전 단계, IMPLEMENTATION_REPORT.md §23)
- **날짜**: 2026-08-13
- **근거 문서**: BENCHMARK.md 5.16, ADR-0009(카탈로그 포지셔닝), ADR-0010(보안 로드맵 — 로컬 단일 사용자 전제)

## 배경

5.16은 healthcheck/백업(2026-08-11 완료)과 **로그 수집·메트릭 endpoint(미해결로 범위 밖 남김)** 두 갈래였다. 남겨둔 이유는 "MVP 단일 사용자 로컬 실행 범위에서는 시급성이 낮다"였고, "실제 팀 규모 배포가 확정되면 재검토한다"는 조건이 붙어 있었다.

**이 조건은 지금도 충족되지 않았다** — 다중 사용자/팀 배포는 여전히 ROADMAP.md 어디에도 없다. 그래서 이 ADR은 "풀 옵저버빌리티 스택을 갖춘다"가 아니라, **ADR-0009/0010과 같은 정도로 절제된 범위**로 남은 두 항목을 마무리한다: 우리가 로그 수집기(Loki/CloudWatch/ELK)를 직접 운영하는 게 아니라, 우리 출력이 구조화되어 있어서 사용자가 원하는 아무 수집기에나 바로 붙일 수 있게만 만든다.

## 결정 1 — 구조화 로깅: 자체 15줄짜리 JSON 로거, 외부 로깅 라이브러리 없음

지금 `api`/`ui` 두 서비스 모두 `console.log`/`console.error` 몇 줄이 전부이고 요청 로그 자체가 없다. `packages/api/src/logger.ts`에 `logInfo(msg, fields?)`/`logError(msg, fields?)` 두 함수만 두고, 각각 stdout/stderr에 `{"level":"info","time":"<ISO>","msg":"...", ...fields}` 한 줄짜리 JSON을 쓴다.

**pino 같은 실제 로깅 라이브러리를 새로 추가하지 않는다** — 이 프로젝트가 필요한 건 "레벨 필터링·트랜스포트·샘플링을 갖춘 로깅 시스템"이 아니라 "grep/jq로 파싱 가능한 한 줄짜리 JSON"뿐이고, 그건 15줄짜리 자체 유틸리티로 충분하다. Docker의 기본 로그 드라이버(json-file)가 stdout/stderr를 그대로 파일로 남기므로, 사용자가 Loki/CloudWatch/Datadog 등 원하는 수집기를 컨테이너 로그 드라이버로 붙이기만 하면 된다 — 우리가 수집기를 직접 운영하지 않는다.

적용 지점:
- `app.ts`: 요청 로깅 미들웨어(`method`, 파라미터화된 route, `status`, `durationMs`)를 라우터 최상단에 추가. 원본 URL이 아니라 Express의 `req.route.path`+`req.baseUrl`로 만든 파라미터화 경로(`/projects/:projectId/entities/:encodedId`)를 쓴다 — 프로젝트 id·인코딩된 Entity id가 그대로 들어간 원본 URL을 쓰면 나중에 메트릭 라벨(결정 2)에서 카디널리티가 무한정 커진다.
- `app.ts` 에러 핸들러의 `console.error(err)` → `logError('unhandled_error', { message, stack })`.
- `index.ts` 시작 배너의 `console.log(...)` → `logInfo('server_started', { port, workspaceRoot, db, apiKeyEnabled })`.
- `packages/web/server.mjs`(별도 의존성 없는 순수 Node 스크립트 — 여기엔 로거 유틸을 새로 만들지 않고 같은 한 줄 JSON 포맷을 인라인으로 직접 쓴다): 요청 로그 한 줄, 시작 배너 한 줄, 프록시 에러 한 줄.

## 결정 2 — 메트릭 endpoint: Prometheus 텍스트 노출 형식을 손으로 작성, `prom-client` 없음

`GET /metrics`를 `/health`와 같은 위치(버전 없는 최상위, API key 미들웨어 밖)에 둔다 — 인프라 스크레이퍼가 `/api/v1` 밖에서 고정 경로로 찾는 관례를 따른다. `/health`도 같은 이유로 API key 미들웨어를 안 거치므로 일관된다.

**JSON이 아니라 Prometheus 텍스트 노출 형식을 쓴다** — "메트릭 endpoint"의 관용적 의미(Prometheus 호환 스크레이핑)를 따르는 게 실제로 더 유용하고, 텍스트 형식 자체는 `# HELP`/`# TYPE` 주석 + `metric_name{labels} value` 줄이 전부라 손으로 만들기 쉽다. `prom-client` 같은 의존성은 추가하지 않는다 — 지금 노출할 지표가 4~5개뿐이라 라이브러리가 주는 이점(레지스트리, 히스토그램 버킷 관리)이 필요 없다.

노출 지표(전부 기존 core 함수로 이미 계산 가능하거나 API 레이어의 인메모리 카운터 — **새 core/스키마 변경 없음**):

```
# TYPE contextsource_up gauge
contextsource_up 1
# TYPE contextsource_process_uptime_seconds gauge
contextsource_process_uptime_seconds 1234.5
# TYPE contextsource_http_requests_total counter
contextsource_http_requests_total{method="GET",route="/projects/:projectId",status="200"} 42
# TYPE contextsource_projects_total gauge
contextsource_projects_total 3
# TYPE contextsource_entities_total gauge
contextsource_entities_total 15234
# TYPE contextsource_relationships_total gauge
contextsource_relationships_total 28901
```

- `contextsource_up`/`process_uptime_seconds`: Node `process.uptime()` — 새 코드 거의 없음.
- `contextsource_http_requests_total`: 결정 1의 요청 로깅 미들웨어와 같은 자리에서 `{method, route, status}` 키로 인메모리 `Map<string, number>` 카운터를 증가시킨다. 프로세스 재시작 시 초기화된다 — 영속 카운터가 필요해지면(팀 규모 재검토 시점) 별도로 다룬다.
- `contextsource_projects_total`/`entities_total`/`relationships_total`: 스크레이프 시점에 기존 `listProjectsWithStats(db)`(이미 `GET /projects`가 쓰는 함수)를 그대로 호출해 합산한다 — 새 core 쿼리를 만들지 않는다.

**하지 않는 것 (이번 범위)**: 요청 지연시간 히스토그램(버킷 설계가 필요한 진짜 작업이라 지금 필요성이 낮다), 분석 실행(run) 성공/실패 카운터(전체 DB를 스캔하는 새 core 쿼리가 필요해 범위가 커진다 — 팀 규모 재검토 시점에 같이 다룬다), 영속 카운터(재시작에도 유지되는 메트릭 — 지금은 스크레이프 간격이 짧은 단일 인스턴스 전제라 불필요).

## 결정 3 — `ui` 서비스에는 `/metrics`를 추가하지 않는다

`ui`는 정적 파일 서버+리버스 프록시일 뿐이라 노출할 만한 운영 지표가 사실상 없다(요청 수 정도인데 그건 `api` 쪽 카운터로 이미 간접적으로 드러난다). 로그는 결정 1대로 구조화하지만 메트릭 endpoint는 `api`에만 둔다 — 대칭성을 위해 빈 endpoint를 하나 더 만드는 건 낭비다.

## 하지 않는 것

- Loki/Prometheus/Grafana 같은 실제 관측 스택을 docker-compose.yml에 추가하지 않는다.
- `pino`/`winston`/`prom-client` 등 새 의존성을 추가하지 않는다.
- 요청 지연시간 히스토그램, 분석 실행 성공/실패 카운터, 재시작 후에도 유지되는 영속 카운터는 이번에 다루지 않는다(팀 규모 배포가 실제로 확정되는 시점으로 미룬다 — ADR-0007과 같은 패턴의 "재검토 조건").
- `/metrics`에 API key 인증을 걸지 않는다(`/health`와 같은 근거 — 인프라 스크레이퍼용 고정 경로, 노출되는 값은 집계 카운터일 뿐 소스 코드 내용이 아니다).

## 구현 순서

1. `packages/api/src/logger.ts` 신규(`logInfo`/`logError`).
2. `packages/api/src/app.ts`: 요청 로깅 미들웨어 + 인메모리 요청 카운터, 에러 핸들러 교체, `GET /metrics` 추가.
3. `packages/api/src/index.ts`: 시작 배너를 `logInfo`로 교체.
4. `packages/web/server.mjs`: 요청/시작/프록시에러 로그를 같은 한 줄 JSON 포맷으로 교체.
5. 테스트: `api` 통합 테스트에 `/metrics`가 Prometheus 텍스트 형식으로 응답하고 실제 프로젝트 수/entity 수를 반영하는지, 요청 후 카운터가 증가하는지 확인.
6. README.md/docker-compose.yml에 "구조화 로그는 `docker compose logs`로, 메트릭은 `curl :9080/metrics`로 확인할 수 있고 원하는 수집기를 로그 드라이버/Prometheus 스크레이프 타깃으로 붙이면 된다"를 한 문단으로 추가.
7. BENCHMARK.md 5.16을 완전히 [해결됨]으로, IMPLEMENTATION_REPORT.md 부록 추가.
