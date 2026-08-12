import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { runFullAnalysis } from '../src/orchestrator.js';
import { runIncrementalAnalysis } from '../src/incremental/incremental-runner.js';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';
import { fileEntityId, symbolEntityId } from '../src/id.js';
import { getEntity } from '../src/query/entity-queries.js';
import { listCallees } from '../src/query/relationship-queries.js';

const PROJECT = 'p1';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(repoDir: string, relPath: string, content: string): void {
  const full = path.join(repoDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function remove(repoDir: string, relPath: string): void {
  fs.rmSync(path.join(repoDir, relPath));
}

function commit(repoDir: string, message: string): string {
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', message]);
  return git(repoDir, ['rev-parse', 'HEAD']).trim();
}

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'commonjs',
      moduleResolution: 'node',
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
    },
    include: ['src/**/*.ts'],
  },
  null,
  2,
);

describe('Incremental analysis against a real Git repository (FR-A6)', () => {
  let repoDir: string;
  let tsconfigPath: string;
  let revA: string;
  let revB: string;
  let revC: string;
  let revD: string;
  let db: Db;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-incremental-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);

    write(repoDir, 'tsconfig.json', TSCONFIG);
    write(repoDir, 'src/a.ts', `export function foo(): number {\n  return 1;\n}\n`);
    write(
      repoDir,
      'src/b.ts',
      `import { foo } from './a';\nexport function useFoo(): number {\n  return foo();\n}\n`,
    );
    write(repoDir, 'src/c.ts', `export function unrelated(): string {\n  return 'noop';\n}\n`);
    write(repoDir, 'src/old-name.ts', `export function oldName(): string {\n  return 'x';\n}\n`);
    write(repoDir, 'src/d-consumer.ts', `export function standalone(): number {\n  return 42;\n}\n`);
    write(repoDir, 'src/g.ts', `export function g(): number {\n  return 1;\n}\n`);
    write(repoDir, 'src/h.ts', `export function h(): number {\n  return 2;\n}\n`);
    revA = commit(repoDir, 'commit A: baseline');

    tsconfigPath = path.join(repoDir, 'tsconfig.json');
    db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'incremental-fixture', rootPath: repoDir, tsconfigPath });

    const fullRun = runFullAnalysis({ db, projectId: PROJECT, tsconfigPath, revision: revA });
    expect(fullRun.status).toBe('completed');
    expect(fullRun.failures).toEqual([]);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('commit B: modify a.ts (rename+re-export), add e.ts, delete c.ts, rename old-name.ts, break g.ts', () => {
    // a.ts: 내부 구현을 fooImpl로 이름을 바꾸고 foo라는 이름으로 재노출한다.
    // b.ts는 전혀 건드리지 않는다 — 역방향 1단계 재분석이 없으면 stale이 되는 시나리오.
    write(
      repoDir,
      'src/a.ts',
      `function fooImpl(): number {\n  return 1;\n}\nexport { fooImpl as foo };\n`,
    );
    write(repoDir, 'src/e.ts', `export function newFn(): number {\n  return 2;\n}\n`);
    remove(repoDir, 'src/c.ts');
    git(repoDir, ['mv', 'src/old-name.ts', 'src/renamed.ts']);
    write(repoDir, 'src/g.ts', `export function g( {\n  broken syntax\n`);
    revB = commit(repoDir, 'commit B: rename/add/delete/move/break');

    const run = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(run.mode).toBe('incremental');
    expect(run.baseRevision).toBe(revA);
    expect(run.revision).toBe(revB);
    expect(run.status).toBe('completed');

    // g.ts 실패가 보고되고, 이전에 성공했던 revision(A)이 preservedRevision으로 남는다.
    const gFailure = run.failures.find((f) => f.filePath === 'src/g.ts');
    expect(gFailure).toBeDefined();
    expect(gFailure?.preservedRevision).toBe(revA);

    // 삭제된 파일 정리
    expect(getEntity(db, fileEntityId(PROJECT, 'src/c.ts'))).toBeUndefined();
    expect(getEntity(db, symbolEntityId(PROJECT, 'src/c.ts', 'unrelated'))).toBeUndefined();

    // 파일 이동 — 옛 id는 사라지고 새 id가 생긴다 (FR-A4)
    expect(getEntity(db, symbolEntityId(PROJECT, 'src/old-name.ts', 'oldName'))).toBeUndefined();
    expect(getEntity(db, symbolEntityId(PROJECT, 'src/renamed.ts', 'oldName'))).toBeDefined();

    // 파일 추가
    expect(getEntity(db, symbolEntityId(PROJECT, 'src/e.ts', 'newFn'))).toBeDefined();

    // a.ts: foo 엔티티는 사라지고 fooImpl이 생긴다
    expect(getEntity(db, symbolEntityId(PROJECT, 'src/a.ts', 'foo'))).toBeUndefined();
    expect(getEntity(db, symbolEntityId(PROJECT, 'src/a.ts', 'fooImpl'))).toBeDefined();

    // b.ts는 git diff에 없었지만 역방향 1단계로 재분석되어 새 관계가 정확히 재구성된다.
    const useFooId = symbolEntityId(PROJECT, 'src/b.ts', 'useFoo');
    const callees = listCallees(db, useFooId, 50, 0);
    expect(callees.items).toHaveLength(1);
    expect(callees.items[0]?.counterpart.id).toBe(symbolEntityId(PROJECT, 'src/a.ts', 'fooImpl'));

    // 건드리지 않은 파일은 재분석되지 않아 revision이 이전 그대로다.
    const standalone = getEntity(db, symbolEntityId(PROJECT, 'src/d-consumer.ts', 'standalone'));
    expect(standalone?.revision).toBe(revA);
  });

  it('commit C: only h.ts changes, but g.ts is retried anyway (still broken)', () => {
    write(repoDir, 'src/h.ts', `export function h(): number {\n  return 3;\n}\n`);
    revC = commit(repoDir, 'commit C: unrelated change, g.ts still broken');

    const run = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(run.revision).toBe(revC);
    expect(run.baseRevision).toBe(revB);

    const gFailure = run.failures.find((f) => f.filePath === 'src/g.ts');
    expect(gFailure).toBeDefined();
    expect(gFailure?.preservedRevision).toBe(revA); // 여전히 A 시점 데이터가 보존됨

    const hEntity = getEntity(db, symbolEntityId(PROJECT, 'src/h.ts', 'h'));
    expect(hEntity?.revision).toBe(revC);
  });

  it('commit D: g.ts fixed', () => {
    write(repoDir, 'src/g.ts', `export function g(): number {\n  return 3;\n}\n`);
    revD = commit(repoDir, 'commit D: fix g.ts');

    const run = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(run.revision).toBe(revD);
    expect(run.failures.find((f) => f.filePath === 'src/g.ts')).toBeUndefined();

    const gEntity = getEntity(db, symbolEntityId(PROJECT, 'src/g.ts', 'g'));
    expect(gEntity?.revision).toBe(revD);
  });

  it('incremental result at commit D equals a fresh full scan at commit D (no failures on either side)', () => {
    const incrementalEntities = db
      .prepare('SELECT id, kind, name, file_path, revision FROM entity WHERE project_id = ? ORDER BY id')
      .all(PROJECT);
    const incrementalRelationships = db
      .prepare(
        `SELECT r.id, r.type, r.source_id, r.target_id, r.resolution, r.confidence
         FROM relationship r JOIN entity s ON s.id = r.source_id
         WHERE s.project_id = ? ORDER BY r.id`,
      )
      .all(PROJECT);

    const freshFull = analyzeProject({ tsconfigPath, projectId: PROJECT, revision: revD });
    expect(freshFull.failures).toEqual([]);

    const freshEntityIds = freshFull.entities.map((e) => e.id).sort();
    const incrementalEntityIds = (incrementalEntities as { id: string }[]).map((e) => e.id).sort();
    expect(incrementalEntityIds).toEqual(freshEntityIds);

    const freshRelKeys = freshFull.relationships
      .map((r) => `${r.type}|${r.sourceId}|${r.targetId}|${r.resolution}|${r.confidence}`)
      .sort();
    const incrementalRelKeys = (
      incrementalRelationships as {
        type: string;
        source_id: string;
        target_id: string;
        resolution: string;
        confidence: number;
      }[]
    )
      .map((r) => `${r.type}|${r.source_id}|${r.target_id}|${r.resolution}|${r.confidence}`)
      .sort();
    expect(incrementalRelKeys).toEqual(freshRelKeys);
  });
});

/**
 * 회귀 테스트: reverse-import로 재분석되는 파일(B)이 "변경 파일도 아니고 B를 통해서만
 * 도달하는" 제3의 미변경 파일(C)의 Entity를 참조하는 경우, 그 관계가 소실되지 않아야 한다.
 * (onlyFiles로 좁힌 재분석에서 nodeToEntityId/entitiesById가 범위 밖 파일을 포함하지 못해
 * 발생했던 실제 버그 — B가 C를 IMPORTS/CALLS 하는데 C는 재분석 대상이 아닌 경우.)
 */
describe('Incremental analysis preserves relationships into untouched third-party files', () => {
  it('B (reverse-importer of the changed file A) still resolves its existing reference to untouched C', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-incremental-thirdfile-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    write(repoDir, 'tsconfig.json', TSCONFIG);
    write(repoDir, 'src/c.ts', `export class Widget {\n  render(): string {\n    return 'ok';\n  }\n}\n`);
    write(
      repoDir,
      'src/b.ts',
      [
        `import { Widget } from './c';`,
        `import { unusedFromA } from './a';`,
        `export function render(): string {`,
        `  const w = new Widget();`,
        `  return w.render();`,
        `}`,
        '',
      ].join('\n'),
    );
    write(repoDir, 'src/a.ts', `export function unusedFromA(): void {}\n`);
    const revA = commit(repoDir, 'baseline');

    const tsconfigPath = path.join(repoDir, 'tsconfig.json');
    const db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'thirdfile', rootPath: repoDir, tsconfigPath });
    const full = runFullAnalysis({ db, projectId: PROJECT, tsconfigPath, revision: revA });
    expect(full.failures).toEqual([]);

    // a.ts만 변경한다 — b.ts는 안 건드리지만 a.ts를 IMPORTS 하므로 역방향 1단계로 재분석된다.
    // b.ts가 재분석될 때 c.ts(Widget)에 대한 기존 관계가 살아남아야 한다.
    write(repoDir, 'src/a.ts', `export function unusedFromA(): void {\n  /* changed */\n}\n`);
    commit(repoDir, 'change a.ts only');

    const run = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(run.failures).toEqual([]);

    const renderId = symbolEntityId(PROJECT, 'src/b.ts', 'render');
    const widgetId = symbolEntityId(PROJECT, 'src/c.ts', 'Widget');
    const widgetRenderId = symbolEntityId(PROJECT, 'src/c.ts', 'Widget.render');

    const callees = listCallees(db, renderId, 50, 0);
    const targets = callees.items.map((i) => i.counterpart.id);
    expect(targets).toContain(widgetId);
    expect(targets).toContain(widgetRenderId);

    const bFileId = fileEntityId(PROJECT, 'src/b.ts');
    const cFileId = fileEntityId(PROJECT, 'src/c.ts');
    const imports = db
      .prepare("SELECT * FROM relationship WHERE type = 'IMPORTS' AND source_id = ? AND target_id = ?")
      .get(bFileId, cFileId);
    expect(imports).toBeDefined();

    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});

/**
 * 회귀 테스트: 실제 규모 검증(typeorm, 약 28만 LOC — BENCHMARK.md 5.11)에서 발견된 관계 유실
 * 버그. c.ts가 바뀌면 b.ts(c.ts의 직접 reverse-importer)는 재분석되어 entity가 delete+reinsert된다.
 * 이때 a.ts가 b.ts를 호출하지만 c.ts는 전혀 import하지 않는다면, 역방향 조회를 1단계로만 하면
 * a.ts는 재분석 대상에 잡히지 않는다 — b.ts의 entity가 지워질 때 a→b 관계가 cascade로 삭제되고,
 * a.ts는 재분석되지 않으므로 그 관계가 다시는 만들어지지 않는다(전수 확인 결과 실제 typeorm에서
 * 4,552건, 25,761건 중 17.7%가 이 패턴으로 소실됨). findReverseImporters가 전이적 폐포를
 * 구하도록 고쳐 a.ts까지 재분석 대상에 포함시킴으로써 해결한다.
 */
describe('Incremental analysis preserves relationships across a 2-hop reverse-import chain', () => {
  it('a.ts (imports b.ts, not c.ts) still resolves its call into b.ts after only c.ts changes', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-incremental-2hop-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    write(repoDir, 'tsconfig.json', TSCONFIG);
    write(repoDir, 'src/c.ts', `export function helperC(): number {\n  return 1;\n}\n`);
    write(
      repoDir,
      'src/b.ts',
      [
        `import { helperC } from './c';`,
        `export class B {`,
        `  method(): number {`,
        `    return helperC();`,
        `  }`,
        `}`,
        '',
      ].join('\n'),
    );
    write(
      repoDir,
      'src/a.ts',
      [
        `import { B } from './b';`,
        `export function run(): number {`,
        `  return new B().method();`,
        `}`,
        '',
      ].join('\n'),
    );
    const revA = commit(repoDir, 'baseline');

    const tsconfigPath = path.join(repoDir, 'tsconfig.json');
    const db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: '2hop', rootPath: repoDir, tsconfigPath });
    const full = runFullAnalysis({ db, projectId: PROJECT, tsconfigPath, revision: revA });
    expect(full.failures).toEqual([]);

    // a→B.method 관계가 애초에 있는지부터 확인한다.
    const runId = symbolEntityId(PROJECT, 'src/a.ts', 'run');
    const methodId = symbolEntityId(PROJECT, 'src/b.ts', 'B.method');
    expect(listCallees(db, runId, 50, 0).items.map((i) => i.counterpart.id)).toContain(methodId);

    // c.ts만 바꾼다 — a.ts와 b.ts는 git diff에 없다.
    write(repoDir, 'src/c.ts', `export function helperC(): number {\n  return 2; /* changed */\n}\n`);
    commit(repoDir, 'change c.ts only');

    const run = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(run.failures).toEqual([]);

    // b.ts는 c.ts의 직접 reverse-importer라 재분석되고 entity가 delete+reinsert된다.
    // a.ts는 b.ts만 import하고 c.ts는 import하지 않으므로, 1단계 역방향 조회로는 재분석
    // 대상에서 빠진다 — 전이적 폐포로 고치지 않으면 아래 assertion이 실패한다.
    const calleesAfter = listCallees(db, runId, 50, 0).items.map((i) => i.counterpart.id);
    expect(calleesAfter).toContain(methodId);

    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});

describe('unresolved_reference persists correctly across incremental analysis (ADR-0011)', () => {
  function countUnresolved(db: Db, sourceId: string): number {
    return (
      db.prepare('SELECT COUNT(*) AS c FROM unresolved_reference WHERE source_id = ?').get(sourceId) as {
        c: number;
      }
    ).c;
  }

  it('an unrelated file change does not disturb an existing unresolved reference; fixing the call site removes it', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-incremental-unresolved-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    write(repoDir, 'tsconfig.json', TSCONFIG);
    write(repoDir, 'src/logger.ts', `export interface Logger {\n  log(message: string): void;\n}\n`);
    write(
      repoDir,
      'src/service.ts',
      [
        `import { Logger } from './logger';`,
        `export class Service {`,
        `  constructor(private readonly logger: Logger) {}`,
        `  run(): void {`,
        `    this.logger.log('ran');`,
        `  }`,
        `}`,
        '',
      ].join('\n'),
    );
    write(repoDir, 'src/unrelated.ts', `export function unrelated(): number {\n  return 1;\n}\n`);
    const revA = commit(repoDir, 'baseline');

    const tsconfigPath = path.join(repoDir, 'tsconfig.json');
    const db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'unresolved', rootPath: repoDir, tsconfigPath });
    const full = runFullAnalysis({ db, projectId: PROJECT, tsconfigPath, revision: revA });
    expect(full.failures).toEqual([]);

    const runMethodId = symbolEntityId(PROJECT, 'src/service.ts', 'Service.run');
    expect(countUnresolved(db, runMethodId)).toBe(1);

    // unrelated.ts만 바꾼다 — service.ts는 재분석 대상이 아니다.
    write(repoDir, 'src/unrelated.ts', `export function unrelated(): number {\n  return 2; /* changed */\n}\n`);
    commit(repoDir, 'change unrelated.ts only');
    const incr1 = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(incr1.failures).toEqual([]);
    expect(countUnresolved(db, runMethodId)).toBe(1); // 그대로 살아있어야 한다 — 삭제되거나 중복되면 안 됨

    // 이번엔 service.ts 자체를 고쳐서 구체 타입을 통해 호출하게 만든다 — 사각지대가 해소돼야 한다.
    write(
      repoDir,
      'src/service.ts',
      [
        `import { Logger } from './logger';`,
        `class ConsoleLogger implements Logger {`,
        `  log(message: string): void {}`,
        `}`,
        `export class Service {`,
        `  private readonly logger: ConsoleLogger = new ConsoleLogger();`,
        `  run(): void {`,
        `    this.logger.log('ran');`,
        `  }`,
        `}`,
        '',
      ].join('\n'),
    );
    commit(repoDir, 'fix service.ts to use a concrete logger type');
    const incr2 = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(incr2.failures).toEqual([]);
    expect(countUnresolved(db, runMethodId)).toBe(0);

    const rel = listCallees(db, runMethodId, 50, 0).items.map((i) => i.counterpart.id);
    expect(rel).toContain(symbolEntityId(PROJECT, 'src/service.ts', 'ConsoleLogger.log'));

    fs.rmSync(repoDir, { recursive: true, force: true });
  });
});
