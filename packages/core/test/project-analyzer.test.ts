import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';
import {
  externalModuleEntityId,
  fileEntityId,
  relationshipId,
  symbolEntityId,
} from '../src/id.js';
import type { Relationship } from '../src/types.js';
import { fixtureTsconfig } from './helpers.js';

const PROJECT = 'p1';
const REV = 'rev1';

function findRel(rels: Relationship[], type: string, sourceId: string, targetId: string) {
  return rels.find((r) => r.type === type && r.sourceId === sourceId && r.targetId === targetId);
}

describe('basic import + alias import', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('basic-import'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('extracts File and Function entities', () => {
    const aFile = fileEntityId(PROJECT, 'src/a.ts');
    const bFile = fileEntityId(PROJECT, 'src/b.ts');
    const foo = symbolEntityId(PROJECT, 'src/a.ts', 'foo');
    const useFoo = symbolEntityId(PROJECT, 'src/b.ts', 'useFoo');
    const ids = result.entities.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([aFile, bFile, foo, useFoo]));
    expect(result.entities.find((e) => e.id === foo)?.kind).toBe('function');
  });

  it('IMPORTS b.ts -> a.ts (static)', () => {
    const bFile = fileEntityId(PROJECT, 'src/b.ts');
    const aFile = fileEntityId(PROJECT, 'src/a.ts');
    const rel = findRel(result.relationships, 'IMPORTS', bFile, aFile);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
    expect(rel?.confidence).toBe(1.0);
    expect(rel?.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it('CALLS useFoo -> foo resolves through the alias import (static)', () => {
    const useFoo = symbolEntityId(PROJECT, 'src/b.ts', 'useFoo');
    const foo = symbolEntityId(PROJECT, 'src/a.ts', 'foo');
    const rel = findRel(result.relationships, 'CALLS', useFoo, foo);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
    expect(rel?.confidence).toBe(1.0);
  });

  it('every relationship carries at least one Evidence entry', () => {
    for (const rel of result.relationships) {
      expect(rel.evidence.length).toBeGreaterThan(0);
      for (const ev of rel.evidence) {
        expect(ev.filePath).toBeTruthy();
        expect(ev.snippet.length).toBeGreaterThan(0);
        expect(ev.analyzer).toBe('ts-analyzer@0.1.0');
        expect(ev.revision).toBe(REV);
      }
    }
  });
});

describe('barrel re-export', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('barrel-reexport'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('IMPORTS index.ts -> service.ts (re-export) and consumer.ts -> index.ts', () => {
    const index = fileEntityId(PROJECT, 'src/index.ts');
    const service = fileEntityId(PROJECT, 'src/service.ts');
    const consumer = fileEntityId(PROJECT, 'src/consumer.ts');
    expect(findRel(result.relationships, 'IMPORTS', index, service)).toBeDefined();
    expect(findRel(result.relationships, 'IMPORTS', consumer, index)).toBeDefined();
  });

  it('CALLS run -> Greeter (construction) resolves through the barrel re-export chain', () => {
    const run = symbolEntityId(PROJECT, 'src/consumer.ts', 'run');
    const greeter = symbolEntityId(PROJECT, 'src/service.ts', 'Greeter');
    const rel = findRel(result.relationships, 'CALLS', run, greeter);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });

  it('CALLS run -> Greeter.greet (static)', () => {
    const run = symbolEntityId(PROJECT, 'src/consumer.ts', 'run');
    const greet = symbolEntityId(PROJECT, 'src/service.ts', 'Greeter.greet');
    const rel = findRel(result.relationships, 'CALLS', run, greet);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });
});

describe('interface implementation and class/interface inheritance', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('inheritance'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('Square IMPLEMENTS Shape (static)', () => {
    const square = symbolEntityId(PROJECT, 'src/square.ts', 'Square');
    const shape = symbolEntityId(PROJECT, 'src/base.ts', 'Shape');
    const rel = findRel(result.relationships, 'IMPLEMENTS', square, shape);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
    expect(rel?.confidence).toBe(1.0);
  });

  it('Square EXTENDS BaseShape (static)', () => {
    const square = symbolEntityId(PROJECT, 'src/square.ts', 'Square');
    const baseShape = symbolEntityId(PROJECT, 'src/base.ts', 'BaseShape');
    const rel = findRel(result.relationships, 'EXTENDS', square, baseShape);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });

  it('Colored EXTENDS Shape (interface-to-interface)', () => {
    const colored = symbolEntityId(PROJECT, 'src/base.ts', 'Colored');
    const shape = symbolEntityId(PROJECT, 'src/base.ts', 'Shape');
    const rel = findRel(result.relationships, 'EXTENDS', colored, shape);
    expect(rel).toBeDefined();
  });
});

describe('overload and generic method', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('overload-generic'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('collapses overloads into a single Function entity', () => {
    const identityEntities = result.entities.filter((e) => e.name === 'identity');
    expect(identityEntities).toHaveLength(1);
    expect(identityEntities[0]?.kind).toBe('function');
  });

  it('two call sites of an overloaded function merge into one relationship with two Evidence entries', () => {
    const run = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const identity = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const rel = findRel(result.relationships, 'CALLS', run, identity);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
    expect(rel?.evidence).toHaveLength(2);
  });

  it('generic method Box.get is extracted and resolvable as a CALLS target', () => {
    const boxGet = symbolEntityId(PROJECT, 'src/math.ts', 'Box.get');
    expect(result.entities.find((e) => e.id === boxGet)?.kind).toBe('method');
    const run = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const rel = findRel(result.relationships, 'CALLS', run, boxGet);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });

  it('CALLS run -> Box via `new Box<number>()`', () => {
    const run = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const box = symbolEntityId(PROJECT, 'src/math.ts', 'Box');
    const rel = findRel(result.relationships, 'CALLS', run, box);
    expect(rel).toBeDefined();
  });
});

describe('duplicate symbol names within a file (regression, 2026-08-12)', () => {
  // 실제 typeorm(약 28만 LOC) 전체 분석에서 `UNIQUE constraint failed: entity.id`로
  // 재현된 실제 결함 — containerNames+name만으로 symbolPath를 만들면 서로 다른 선언이
  // 충돌할 수 있었다(BENCHMARK.md 5.11). fixture: duplicate-symbol-names.
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('duplicate-symbol-names'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures and produces no duplicate entity ids', () => {
    expect(result.failures).toEqual([]);
    const ids = result.entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('disambiguates instance vs static methods of the same name (first keeps clean id, second gets $2)', () => {
    const instance = symbolEntityId(PROJECT, 'src/index.ts', 'Widget.hasId');
    const staticOne = symbolEntityId(PROJECT, 'src/index.ts', 'Widget.hasId$2');
    expect(result.entities.find((e) => e.id === instance)?.kind).toBe('method');
    expect(result.entities.find((e) => e.id === staticOne)?.kind).toBe('method');
  });

  it('disambiguates a same-named interface and class in one file', () => {
    const iface = symbolEntityId(PROJECT, 'src/index.ts', 'Marker');
    const cls = symbolEntityId(PROJECT, 'src/index.ts', 'Marker$2');
    expect(result.entities.find((e) => e.id === iface)?.kind).toBe('interface');
    expect(result.entities.find((e) => e.id === cls)?.kind).toBe('class');
  });

  it('disambiguates same-named local functions in sibling if/else blocks', () => {
    const first = symbolEntityId(PROJECT, 'src/index.ts', 'run.helper.inner');
    const second = symbolEntityId(PROJECT, 'src/index.ts', 'run.helper.inner$2');
    expect(result.entities.find((e) => e.id === first)?.kind).toBe('function');
    expect(result.entities.find((e) => e.id === second)?.kind).toBe('function');
  });

  it('re-analyzing the same unchanged fixture yields identical ids (FR-A4 stability preserved)', () => {
    const again = analyzeProject({
      tsconfigPath: fixtureTsconfig('duplicate-symbol-names'),
      projectId: PROJECT,
      revision: REV,
    });
    expect(again.entities.map((e) => e.id).sort()).toEqual(result.entities.map((e) => e.id).sort());
  });
});

describe('callback and higher-order function', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('callback-hof'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('does NOT create a CALLS relationship for a callback invoked through a generically-typed parameter', () => {
    const registerHandler = symbolEntityId(PROJECT, 'src/handlers.ts', 'registerHandler');
    const onClick = symbolEntityId(PROJECT, 'src/handlers.ts', 'onClick');
    const rel = findRel(result.relationships, 'CALLS', registerHandler, onClick);
    expect(rel).toBeUndefined();
  });

  it('records that call as an unresolved reference (ambiguous-callable-type, ADR-0011)', () => {
    const registerHandler = symbolEntityId(PROJECT, 'src/handlers.ts', 'registerHandler');
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === registerHandler);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.kind).toBe('CALLS');
    expect(unresolved[0]?.reason).toBe('ambiguous-callable-type');
    expect(unresolved[0]?.snippet).toBe('handler()');
  });

  it('does NOT record an unresolved reference for console.log (external/ambient, OQ-11 boundary)', () => {
    const onClick = symbolEntityId(PROJECT, 'src/handlers.ts', 'onClick');
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === onClick);
    expect(unresolved).toEqual([]);
  });

  it('creates an inferred CALLS relationship when a known function is called through a direct local alias', () => {
    const invoke = symbolEntityId(PROJECT, 'src/handlers.ts', 'invoke');
    const greet = symbolEntityId(PROJECT, 'src/handlers.ts', 'greet');
    const rel = findRel(result.relationships, 'CALLS', invoke, greet);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('inferred');
    expect(rel?.confidence).toBe(0.8);
  });

  it('setup -> registerHandler is a direct static call', () => {
    const setup = symbolEntityId(PROJECT, 'src/wiring.ts', 'setup');
    const registerHandler = symbolEntityId(PROJECT, 'src/handlers.ts', 'registerHandler');
    const rel = findRel(result.relationships, 'CALLS', setup, registerHandler);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });
});

describe('dependency injection (constructor-injected interface)', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('dependency-injection'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('ConsoleLogger IMPLEMENTS Logger (static)', () => {
    const consoleLogger = symbolEntityId(PROJECT, 'src/console-logger.ts', 'ConsoleLogger');
    const logger = symbolEntityId(PROJECT, 'src/logger.ts', 'Logger');
    const rel = findRel(result.relationships, 'IMPLEMENTS', consoleLogger, logger);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });

  it('run CALLS OrderService and ConsoleLogger via `new` (static)', () => {
    const run = symbolEntityId(PROJECT, 'src/main.ts', 'run');
    const orderService = symbolEntityId(PROJECT, 'src/order-service.ts', 'OrderService');
    const consoleLogger = symbolEntityId(PROJECT, 'src/console-logger.ts', 'ConsoleLogger');
    expect(findRel(result.relationships, 'CALLS', run, orderService)?.resolution).toBe('static');
    expect(findRel(result.relationships, 'CALLS', run, consoleLogger)?.resolution).toBe('static');
  });

  it('run CALLS OrderService.placeOrder directly on the concretely-typed instance (static)', () => {
    const run = symbolEntityId(PROJECT, 'src/main.ts', 'run');
    const placeOrder = symbolEntityId(PROJECT, 'src/order-service.ts', 'OrderService.placeOrder');
    const rel = findRel(result.relationships, 'CALLS', run, placeOrder);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });

  it('known limitation: does NOT create a CALLS relationship for a call through a constructor-injected interface field (IMPLEMENTATION_REPORT.md §10)', () => {
    // OrderService.placeOrder는 this.logger.log(...)를 호출하지만, logger는 인터페이스
    // Logger 타입으로 주입되고 인터페이스 멤버는 Entity로 추출되지 않는다(ADR-0002 §2) —
    // 그래서 대상을 특정할 수 없어 CALLS 관계 자체가 생성되지 않는다(false positive를
    // 만들지 않기 위한 의도적 설계, 다만 DI가 많은 코드베이스에서는 recall이 낮아짐).
    const placeOrder = symbolEntityId(PROJECT, 'src/order-service.ts', 'OrderService.placeOrder');
    const loggerLog = result.relationships.filter((r) => r.type === 'CALLS' && r.sourceId === placeOrder);
    expect(loggerLog).toEqual([]);
  });

  it('records that call as an unresolved reference (entity-not-extracted, ADR-0011) — turns the known limitation above into a measured, CI-enforced fact', () => {
    const placeOrder = symbolEntityId(PROJECT, 'src/order-service.ts', 'OrderService.placeOrder');
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === placeOrder);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.kind).toBe('CALLS');
    expect(unresolved[0]?.reason).toBe('entity-not-extracted');
  });

  it('does NOT record an unresolved reference for console.log inside ConsoleLogger.log (external/ambient, OQ-11 boundary)', () => {
    const consoleLoggerLog = symbolEntityId(PROJECT, 'src/console-logger.ts', 'ConsoleLogger.log');
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === consoleLoggerLog);
    expect(unresolved).toEqual([]);
  });
});

describe('dynamic import and unresolvable calls', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('dynamic-import'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('literal dynamic import produces an inferred IMPORTS relationship', () => {
    const loader = fileEntityId(PROJECT, 'src/loader.ts');
    const lazy = fileEntityId(PROJECT, 'src/lazy.ts');
    const rel = findRel(result.relationships, 'IMPORTS', loader, lazy);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('inferred');
    expect(rel?.confidence).toBe(0.6);
  });

  it('computed dynamic import specifier produces no relationship (unresolvable)', () => {
    // loadDynamic는 loader.ts 안에서 lazy.ts 이외의 어떤 파일로도 IMPORTS 관계가 생기지 않는다.
    const loader = fileEntityId(PROJECT, 'src/loader.ts');
    const importsFromLoader = result.relationships.filter(
      (r) => r.type === 'IMPORTS' && r.sourceId === loader,
    );
    expect(importsFromLoader).toHaveLength(1); // lazy.ts로의 관계 1건뿐
  });

  it('records the computed specifier as an unresolved reference (unresolvable-specifier, ADR-0011)', () => {
    const loader = fileEntityId(PROJECT, 'src/loader.ts');
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === loader);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.kind).toBe('IMPORTS');
    expect(unresolved[0]?.reason).toBe('unresolvable-specifier');
    expect(unresolved[0]?.snippet).toBe('import(pathVar)');
  });
});

describe('unresolved imports (ADR-0011)', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('unresolved-imports'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures (a missing module is a semantic diagnostic, not a syntactic one)', () => {
    expect(result.failures).toEqual([]);
  });

  it('a broken relative specifier produces no IMPORTS relationship, recorded as unresolvable-specifier', () => {
    const brokenImport = fileEntityId(PROJECT, 'src/broken-import.ts');
    const rel = result.relationships.filter((r) => r.type === 'IMPORTS' && r.sourceId === brokenImport);
    expect(rel).toEqual([]);
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === brokenImport);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toBe('unresolvable-specifier');
  });

  it('a real file outside tsconfig include produces no IMPORTS relationship, recorded as internal-path-not-in-project', () => {
    const outsideImport = fileEntityId(PROJECT, 'src/outside-import.ts');
    const rel = result.relationships.filter((r) => r.type === 'IMPORTS' && r.sourceId === outsideImport);
    expect(rel).toEqual([]);
    const unresolved = result.unresolvedReferences.filter((u) => u.sourceId === outsideImport);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toBe('internal-path-not-in-project');
  });
});

describe('external package import', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('external-package'),
    projectId: PROJECT,
    revision: REV,
  });

  it('has no failures', () => {
    expect(result.failures).toEqual([]);
  });

  it('creates an ExternalModule entity for the package (no location/revision)', () => {
    const ext = externalModuleEntityId(PROJECT, 'left-pad-like');
    const entity = result.entities.find((e) => e.id === ext);
    expect(entity).toBeDefined();
    expect(entity?.kind).toBe('external_module');
    expect(entity?.filePath).toBeNull();
    expect(entity?.range).toBeNull();
    expect(entity?.revision).toBeNull();
  });

  it('IMPORTS consumer.ts -> ExternalModule(left-pad-like)', () => {
    const consumer = fileEntityId(PROJECT, 'src/consumer.ts');
    const ext = externalModuleEntityId(PROJECT, 'left-pad-like');
    const rel = findRel(result.relationships, 'IMPORTS', consumer, ext);
    expect(rel).toBeDefined();
    expect(rel?.resolution).toBe('static');
  });

  it('does NOT create a CALLS relationship to the external symbol (OQ-11)', () => {
    const run = symbolEntityId(PROJECT, 'src/consumer.ts', 'run');
    const callsFromRun = result.relationships.filter(
      (r) => r.type === 'CALLS' && r.sourceId === run,
    );
    expect(callsFromRun).toHaveLength(0);
  });
});

describe('parsing failure isolation', () => {
  const result = analyzeProject({
    tsconfigPath: fixtureTsconfig('parse-failure'),
    projectId: PROJECT,
    revision: REV,
  });

  it('reports the broken file as a failure', () => {
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.filePath).toBe('src/bad.ts');
    expect(result.failures[0]?.message.length).toBeGreaterThan(0);
  });

  it('still analyzes the valid file in the same project', () => {
    const ok = symbolEntityId(PROJECT, 'src/good.ts', 'ok');
    expect(result.entities.find((e) => e.id === ok)).toBeDefined();
  });

  it('creates no entities sourced from the broken file', () => {
    const fromBadFile = result.entities.filter((e) => e.filePath === 'src/bad.ts');
    expect(fromBadFile).toHaveLength(0);
  });
});

describe('Entity id stability (FR-A4)', () => {
  it('relationship id is a deterministic hash of (type, source, target)', () => {
    const id1 = relationshipId('CALLS', 'p1/sym:a.ts#f', 'p1/sym:b.ts#g');
    const id2 = relationshipId('CALLS', 'p1/sym:a.ts#f', 'p1/sym:b.ts#g');
    expect(id1).toBe(id2);
  });

  it('re-analyzing the same unchanged project yields identical entity and relationship ids', () => {
    const first = analyzeProject({
      tsconfigPath: fixtureTsconfig('basic-import'),
      projectId: PROJECT,
      revision: 'rev-a',
    });
    const second = analyzeProject({
      tsconfigPath: fixtureTsconfig('basic-import'),
      projectId: PROJECT,
      revision: 'rev-b',
    });
    expect(new Set(first.entities.map((e) => e.id))).toEqual(new Set(second.entities.map((e) => e.id)));
    expect(new Set(first.relationships.map((r) => r.id))).toEqual(
      new Set(second.relationships.map((r) => r.id)),
    );
  });
});
