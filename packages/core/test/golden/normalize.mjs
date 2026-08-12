// golden.test.ts(vitest, esbuild로 트랜스파일)와 generate.mjs(node, 빌드된 dist/index.js 사용) 양쪽이
// 이 파일을 그대로 import해서 쓴다 — 정규화 로직을 두 언어/두 파일로 중복시키지 않기 위해 순수 JS로
// 작성한다(BENCHMARK.md 5.4: 각 fixture의 예상 Entity/Relationship/resolution/Evidence를 golden.json으로
// 선언하고 CI에서 비교하는 하네스).

function byId(a, b) {
  return a.id.localeCompare(b.id);
}

export function normalizeEntities(entities) {
  return entities
    .map((e) => ({ id: e.id, kind: e.kind, name: e.name, filePath: e.filePath, range: e.range, revision: e.revision }))
    .sort(byId);
}

export function normalizeRelationships(relationships) {
  return relationships
    .map((r) => ({
      id: r.id,
      type: r.type,
      sourceId: r.sourceId,
      targetId: r.targetId,
      resolution: r.resolution,
      confidence: r.confidence,
      evidence: r.evidence
        .map((ev) => ({
          id: ev.id,
          filePath: ev.filePath,
          range: ev.range,
          snippet: ev.snippet,
          analyzer: ev.analyzer,
          revision: ev.revision,
        }))
        .sort(byId),
    }))
    .sort(byId);
}

// TS 컴파일러 진단 메시지 텍스트는 TypeScript 버전에 따라 달라질 수 있어(문구 변경, 버전 업그레이드)
// golden에 그대로 박아두면 컴파일러 업그레이드만으로 무관한 테스트가 깨진다 — filePath와
// "메시지가 비어있지 않다"만 골든에 담고 정확한 문구는 비교하지 않는다.
export function normalizeFailures(failures) {
  return failures
    .map((f) => ({ filePath: f.filePath, hasMessage: f.message.length > 0 }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export function normalizeResult(result) {
  return {
    entities: normalizeEntities(result.entities),
    relationships: normalizeRelationships(result.relationships),
    failures: normalizeFailures(result.failures),
  };
}
