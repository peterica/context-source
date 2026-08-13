import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
// @ts-expect-error cytoscape-dagre has no bundled types
import dagre from 'cytoscape-dagre';
import type { Entity, EntityKind, Relationship, RelationshipType, Resolution } from '@contextsource/core';
import { api, encodeEntityId } from '../api/client.js';
import { ENTITY_KIND_LABEL } from '../format.js';
import { RESOLUTION_TOOLTIP } from '../glossary.js';
import { clickableRowProps } from '../a11y.js';

cytoscape.use(dagre);

const KIND_COLOR: Record<EntityKind, string> = {
  file: '#5b8def',
  class: '#d97fd9',
  interface: '#7fd9c8',
  function: '#f2b45c',
  method: '#f2905c',
  external_module: '#9aa1ae',
};

const ALL_TYPES: RelationshipType[] = ['DECLARES', 'IMPORTS', 'CALLS', 'IMPLEMENTS', 'EXTENDS'];

export interface SubgraphState {
  entities: Entity[];
  relationships: Relationship[];
  truncated: boolean;
  stats: { entityCount: number; relationshipCount: number; maxDepthReached: number };
}

// ADR-0013(BENCHMARK.md 5.7) "호출 보기" — rootKind에 따라 처음 렌더링될 때 보여줄 방향/타입을
// 다르게 프리셋한다. function/method는 "호출자·피호출자 탐색"이 목적이므로 CALLS만 양방향으로,
// class/interface/file은 "구조 이해"가 목적이므로 DECLARES/EXTENDS/IMPLEMENTS를 out 방향으로 연다.
// 프리셋은 초기값일 뿐이고 아래 툴바에서 언제든 수동으로 바꿀 수 있다 — 새 화면을 만들지 않고
// 기존 컨트롤 위에 "처음 무엇을 보여줄지"만 얹는다.
function initialDirection(rootKind: EntityKind | undefined): 'in' | 'out' | 'both' {
  if (rootKind === 'function' || rootKind === 'method') return 'both';
  if (rootKind === 'class' || rootKind === 'interface' || rootKind === 'file') return 'out';
  return 'in';
}
function initialTypes(rootKind: EntityKind | undefined): Set<RelationshipType> {
  if (rootKind === 'function' || rootKind === 'method') return new Set(['CALLS']);
  if (rootKind === 'class' || rootKind === 'interface' || rootKind === 'file') {
    return new Set(['DECLARES', 'EXTENDS', 'IMPLEMENTS']);
  }
  return new Set(ALL_TYPES);
}

export function ImpactGraph(props: {
  projectId: string;
  rootId: string;
  rootKind?: EntityKind;
  onSelectNode: (id: string) => void;
  onSelectEdge: (rel: Relationship, sourceLabel: string, targetLabel: string) => void;
}) {
  const [direction, setDirection] = useState<'in' | 'out' | 'both'>(() => initialDirection(props.rootKind));
  const [depth, setDepth] = useState(2);
  const [types, setTypes] = useState<Set<RelationshipType>>(() => initialTypes(props.rootKind));
  const [resolution, setResolution] = useState<Resolution | ''>('');
  const [data, setData] = useState<SubgraphState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ADR-0016(BENCHMARK.md 5.20 잔여분) — Cytoscape canvas는 픽셀 렌더링이라 키보드로 노드/엣지를
  // 순회할 방법이 없다. canvas를 고치는 대신 같은 subgraph 데이터를 목록으로도 보여준다(새 API 호출 없음).
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  // EntityExplorer는 Entity를 바꿔도 ImpactGraph를 다시 마운트하지 않는다(같은 컴포넌트 인스턴스가
  // 재사용된다) — 그래서 프리셋을 최초 마운트 시점의 useState 초기값으로만 두면 두 번째로 고른
  // Entity부터는 프리셋이 전혀 적용되지 않는다. rootId가 바뀔 때마다 새로 프리셋을 적용한다.
  useEffect(() => {
    setDirection(initialDirection(props.rootKind));
    setTypes(initialTypes(props.rootKind));
    // rootKind는 항상 rootId와 함께 바뀌므로(같은 Entity의 kind가 도중에 변하지 않는다) rootId만으로 충분하다.
  }, [props.rootId]);

  useEffect(() => {
    setError(null);
    api
      .getSubgraph(props.projectId, encodeEntityId(props.rootId), {
        direction,
        depth,
        types: types.size < ALL_TYPES.length ? [...types] : undefined,
        resolution: resolution || undefined,
        maxNodes: 200,
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.projectId, props.rootId, direction, depth, types, resolution]);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    const elements = [
      ...data.entities.map((e) => ({
        data: { id: e.id, label: e.name, kind: e.kind, isRoot: e.id === props.rootId },
      })),
      ...data.relationships.map((r) => ({
        data: {
          id: r.id,
          source: r.sourceId,
          target: r.targetId,
          label: r.type,
          resolution: r.resolution,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele) => KIND_COLOR[ele.data('kind') as EntityKind] ?? '#888',
            label: 'data(label)',
            color: '#e6e8ec',
            'font-size': 9,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            width: 22,
            height: 22,
            'border-width': (ele) => (ele.data('isRoot') ? 3 : 0),
            'border-color': '#ffffff',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': (ele) => (ele.data('resolution') === 'inferred' ? '#d9a441' : '#4caf7d'),
            'target-arrow-color': (ele) =>
              ele.data('resolution') === 'inferred' ? '#d9a441' : '#4caf7d',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'line-style': (ele) => (ele.data('resolution') === 'inferred' ? 'dashed' : 'solid'),
            label: 'data(label)',
            'font-size': 7,
            color: '#9aa1ae',
            'text-rotation': 'autorotate',
          },
        },
      ],
      layout: { name: 'dagre', rankDir: direction === 'in' ? 'LR' : 'LR', nodeSep: 20, rankSep: 60 } as any,
    });

    const entityById = new Map(data.entities.map((e) => [e.id, e]));
    cy.on('tap', 'node', (evt) => props.onSelectNode(evt.target.id()));
    cy.on('tap', 'edge', (evt) => {
      const rel = data.relationships.find((r) => r.id === evt.target.id());
      if (rel) {
        props.onSelectEdge(
          rel,
          entityById.get(rel.sourceId)?.name ?? rel.sourceId,
          entityById.get(rel.targetId)?.name ?? rel.targetId,
        );
      }
    });

    cyRef.current = cy;
    return () => cy.destroy();
  }, [data]);

  function toggleType(t: RelationshipType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <div>
      <div className="graph-toolbar">
        <label>
          방향
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out' | 'both')}>
            <option value="in">영향 (in) — 누가 이 Entity에 의존하는가</option>
            <option value="out">의존 (out) — 이 Entity가 무엇에 의존하는가</option>
            <option value="both">양방향</option>
          </select>
        </label>
        <label>
          depth
          <input
            type="range"
            min={0}
            max={5}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
          {depth}
        </label>
        <label>
          resolution
          <select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution | '')}>
            <option value="">전체</option>
            <option value="static">static</option>
            <option value="inferred">inferred</option>
          </select>
        </label>
        {ALL_TYPES.map((t) => (
          <label key={t}>
            <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />
            {t}
          </label>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            type="button"
            className={viewMode === 'graph' ? 'btn secondary active' : 'btn secondary'}
            aria-pressed={viewMode === 'graph'}
            onClick={() => setViewMode('graph')}
          >
            그래프
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'btn secondary active' : 'btn secondary'}
            aria-pressed={viewMode === 'list'}
            title="Cytoscape 캔버스는 키보드로 순회할 수 없습니다 — 같은 데이터를 목록으로 봅니다."
            onClick={() => setViewMode('list')}
          >
            목록
          </button>
        </span>
      </div>
      {error && <div className="empty">{error}</div>}
      {data && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
          entities {data.stats.entityCount} · relationships {data.stats.relationshipCount} · maxDepth{' '}
          {data.stats.maxDepthReached}
          {data.truncated && <span className="badge fail" style={{ marginLeft: 6 }}>truncated</span>}
          {' · '}
          <span className="badge static">static</span> <span className="badge inferred">inferred</span>
        </div>
      )}
      {/* 노드 색상이 무엇을 뜻하는지 그래프 화면 안에 범례가 전혀 없었다(UX 감사 P1-5). */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          fontSize: 11,
          color: 'var(--text-dim)',
          marginBottom: 6,
        }}
      >
        {(Object.keys(KIND_COLOR) as EntityKind[]).map((kind) => (
          <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 9,
                height: 9,
                borderRadius: '50%',
                backgroundColor: KIND_COLOR[kind],
              }}
            />
            {ENTITY_KIND_LABEL[kind]}
          </span>
        ))}
      </div>
      <div className="graph-canvas" ref={containerRef} style={{ display: viewMode === 'graph' ? 'block' : 'none' }} />
      {viewMode === 'list' && data && <SubgraphList data={data} rootId={props.rootId} onSelectNode={props.onSelectNode} onSelectEdge={props.onSelectEdge} />}
    </div>
  );
}

// canvas 대신 같은 subgraph 데이터를 키보드로 순회 가능한 목록으로 보여준다(ADR-0016) — 노드/엣지
// 클릭 시의 동작은 캔버스와 동일한 콜백을 그대로 재사용해 두 뷰가 서로 다른 동작을 하지 않게 한다.
function SubgraphList(props: {
  data: SubgraphState;
  rootId: string;
  onSelectNode: (id: string) => void;
  onSelectEdge: (rel: Relationship, sourceLabel: string, targetLabel: string) => void;
}) {
  const entityById = new Map(props.data.entities.map((e) => [e.id, e]));

  return (
    <div className="split graph-list-view" style={{ marginTop: 6 }}>
      <div className="panel">
        <h3 className="section-title">노드 ({props.data.entities.length})</h3>
        {props.data.entities.map((e) => (
          <div key={e.id} className="entity-row" {...clickableRowProps(() => props.onSelectNode(e.id))}>
            <span className="badge kind">{ENTITY_KIND_LABEL[e.kind]}</span>{' '}
            <span className="name">
              {e.name}
              {e.id === props.rootId && ' (root)'}
            </span>
            <div className="path">{e.filePath ?? '(external package)'}</div>
          </div>
        ))}
        {props.data.entities.length === 0 && <div className="empty">없음</div>}
      </div>
      <div className="panel">
        <h3 className="section-title">관계 ({props.data.relationships.length})</h3>
        {props.data.relationships.map((r) => {
          const source = entityById.get(r.sourceId);
          const target = entityById.get(r.targetId);
          return (
            <div
              key={r.id}
              className="entity-row"
              {...clickableRowProps(() =>
                props.onSelectEdge(r, source?.name ?? r.sourceId, target?.name ?? r.targetId),
              )}
            >
              <span className="name">
                {source?.name ?? r.sourceId} → {target?.name ?? r.targetId}
              </span>{' '}
              <span className="badge kind">{r.type}</span>{' '}
              <span className={`badge ${r.resolution}`} title={RESOLUTION_TOOLTIP[r.resolution]}>
                {r.resolution}
              </span>
            </div>
          );
        })}
        {props.data.relationships.length === 0 && <div className="empty">없음</div>}
      </div>
    </div>
  );
}
