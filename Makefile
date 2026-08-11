.PHONY: setup build typecheck lint test analyze run-api run-web run-mcp \
        register-demo docker-up docker-down clean

# Node.js >= 22.5.0 필요 (node:sqlite 내장 모듈, ADR-0001).

setup:
	npm install

build:
	npm run build -w @contextsource/core
	npm run build -w @contextsource/cli
	npm run build -w @contextsource/api
	npm run build -w @contextsource/mcp
	npm run build -w @contextsource/web

typecheck:
	npm run typecheck -w @contextsource/core
	npm run typecheck -w @contextsource/cli
	npm run typecheck -w @contextsource/api
	npm run typecheck -w @contextsource/mcp
	npm run typecheck -w @contextsource/web

lint:
	npm run lint -w @contextsource/core
	npm run lint -w @contextsource/cli
	npm run lint -w @contextsource/api
	npm run lint -w @contextsource/mcp
	npm run lint -w @contextsource/web

# 단위/통합 테스트 (core: analyzer/storage/query/incremental, api: HTTP 통합, mcp: MCP tool 통합).
test:
	npm run test -w @contextsource/core
	npm run test -w @contextsource/api
	npm run test -w @contextsource/mcp

# CLI 직접 저장 경로 — 프로젝트 레지스트리(ADR-0004)를 거치지 않고 샘플 프로젝트를 바로 분석한다.
# 스크립트/CI에서 단일 프로젝트만 다룰 때 쓰기 편하다 (M1 CLI + M2 storage).
analyze: build
	mkdir -p data
	node packages/cli/dist/index.js analyze \
		--tsconfig samples/demo-project/tsconfig.json \
		--project-id demo \
		--db data/contextsource.sqlite \
		--mode full

# 증분 분석 (samples/demo-project가 Git 저장소일 때만 동작 — 없으면 초기화 안내를 출력한다).
analyze-incremental: build
	mkdir -p data
	node packages/cli/dist/index.js analyze \
		--tsconfig samples/demo-project/tsconfig.json \
		--project-id demo \
		--db data/contextsource.sqlite \
		--mode incremental

# workspace-root(samples/)를 읽기 전용으로 다루는 다중 프로젝트 API 서버.
# 프로젝트 등록은 Web UI("+ 새 프로젝트 등록") 또는 `make register-demo`로 한다.
run-api: build
	mkdir -p data
	node packages/api/dist/index.js \
		--db data/contextsource.sqlite \
		--workspace-root samples \
		--port 9080

run-web:
	npm run dev -w @contextsource/web

run-mcp: build
	node packages/mcp/dist/index.js --db data/contextsource.sqlite --project-id demo

# run-api가 떠 있는 상태에서 samples/demo-project를 프로젝트로 등록한다.
register-demo:
	curl -sf -X POST http://localhost:9080/api/v1/projects \
		-H 'Content-Type: application/json' \
		-d '{"id":"demo","name":"Demo Project","path":"demo-project","tsconfigPath":"tsconfig.json"}' \
		| tee /dev/stderr | grep -q '"id":"demo"' && echo "\nregistered: demo"

docker-up:
	docker compose up --build

docker-down:
	docker compose down -v

clean:
	rm -rf packages/*/dist packages/*/*.tsbuildinfo data
