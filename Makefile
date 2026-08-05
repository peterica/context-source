.PHONY: setup build typecheck lint test analyze run-api run-web run-mcp \
        docker-up docker-down clean

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

# 샘플 프로젝트(samples/demo-project)를 전체 분석하여 SQLite에 저장한다 (M1 CLI + M2 storage).
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

run-api: build
	mkdir -p data
	node packages/api/dist/index.js \
		--db data/contextsource.sqlite \
		--project-id demo \
		--project-name "Demo Project" \
		--root-path samples/demo-project \
		--tsconfig samples/demo-project/tsconfig.json \
		--port 8080

run-web:
	npm run dev -w @contextsource/web

run-mcp: build
	node packages/mcp/dist/index.js --db data/contextsource.sqlite --project-id demo

docker-up:
	docker compose up --build

docker-down:
	docker compose down -v

clean:
	rm -rf packages/*/dist packages/*/*.tsbuildinfo data
