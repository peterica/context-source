import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
// @ts-expect-error cytoscape-dagre has no bundled types
import dagre from 'cytoscape-dagre';
import type { Entity, EntityKind, Relationship, RelationshipType, Resolution } from '@contextsource/core';
import { api, encodeEntityId } from '../api/client.js';
import { ENTITY_KIND_LABEL } from '../format.js';

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

export function ImpactGraph(props: {
  projectId: string;
  rootId: string;
  onSelectNode: (id: string) => void;
  onSelectEdge: (rel: Relationship, sourceLabel: string, targetLabel: string) => void;
}) {
  const [direction, setDirection] = useState<'in' | 'out' | 'both'>('in');
  const [depth, setDepth] = useState(2);
  const [types, setTypes] = useState<Set<RelationshipType>>(new Set(ALL_TYPES));
  const [resolution, setResolution] = useState<Resolution | ''>('');
  const [data, setData] = useState<SubgraphState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

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
      <div className="graph-canvas" ref={containerRef} />
    </div>
  );
}
