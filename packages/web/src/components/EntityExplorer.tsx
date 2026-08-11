import { useEffect, useState } from 'react';
import type { Entity, Relationship } from '@contextsource/core';
import { api, encodeEntityId } from '../api/client.js';
import { formatRevision, ENTITY_KIND_LABEL } from '../format.js';
import { RESOLUTION_TOOLTIP } from '../glossary.js';
import { clickableRowProps } from '../a11y.js';
import { ImpactGraph } from './ImpactGraph.js';
import { EvidencePanel } from './EvidencePanel.js';

interface RelItem {
  relationship: Relationship;
  counterpart: Entity;
}

export function EntityExplorer(props: {
  projectId: string;
  entityId: string;
  onSelectEntity: (id: string) => void;
}) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [counts, setCounts] = useState<{ in: number; out: number } | null>(null);
  const [callers, setCallers] = useState<RelItem[]>([]);
  const [callees, setCallees] = useState<RelItem[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<{
    rel: Relationship;
    sourceLabel: string;
    targetLabel: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEdge(null);
    const encoded = encodeEntityId(props.entityId);
    Promise.all([
      api.getEntity(props.projectId, encoded),
      api.getCallers(props.projectId, encoded),
      api.getCallees(props.projectId, encoded),
    ])
      .then(([detail, callersRes, calleesRes]) => {
        setEntity(detail.entity);
        setCounts(detail.relationshipCounts);
        setCallers(callersRes.items);
        setCallees(calleesRes.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.projectId, props.entityId]);

  if (error) return <div className="empty">{error}</div>;
  if (!entity) return <div className="empty">불러오는 중…</div>;

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <span className="badge kind">{ENTITY_KIND_LABEL[entity.kind]}</span>{' '}
        <strong style={{ fontSize: 16 }}>{entity.name}</strong>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          {entity.filePath ? `${entity.filePath}${entity.range ? `:${entity.range.startLine}-${entity.range.endLine}` : ''}` : '(external package)'}
          {entity.revision && ` · rev ${formatRevision(entity.revision)}`}
        </div>
        <div
          style={{ marginTop: 6, fontSize: 12 }}
          title="DECLARES/IMPORTS/CALLS/IMPLEMENTS/EXTENDS를 모두 합친 전체 관계 수입니다."
        >
          들어오는 관계 {counts?.in ?? 0} · 나가는 관계 {counts?.out ?? 0}
        </div>
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2 className="section-title" title="CALLS 관계만 표시합니다 — 위 '들어오는 관계'의 부분집합입니다.">
            Caller ({callers.length})
          </h2>
          {callers.length === 0 && <div className="empty">없음</div>}
          {callers.map((c) => (
            <div
              key={c.relationship.id}
              className="entity-row"
              {...clickableRowProps(() => props.onSelectEntity(c.counterpart.id))}
            >
              <span className="name">{c.counterpart.name}</span>{' '}
              <span className={`badge ${c.relationship.resolution}`} title={RESOLUTION_TOOLTIP[c.relationship.resolution]}>
                {c.relationship.resolution}
              </span>
              <div className="path">{c.counterpart.filePath}</div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2 className="section-title" title="CALLS 관계만 표시합니다 — 위 '나가는 관계'의 부분집합입니다.">
            Callee ({callees.length})
          </h2>
          {callees.length === 0 && <div className="empty">없음</div>}
          {callees.map((c) => (
            <div
              key={c.relationship.id}
              className="entity-row"
              {...clickableRowProps(() => props.onSelectEntity(c.counterpart.id))}
            >
              <span className="name">{c.counterpart.name}</span>{' '}
              <span className={`badge ${c.relationship.resolution}`} title={RESOLUTION_TOOLTIP[c.relationship.resolution]}>
                {c.relationship.resolution}
              </span>
              <div className="path">{c.counterpart.filePath}</div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="section-title">영향 관계 그래프</h2>
      <ImpactGraph
        projectId={props.projectId}
        rootId={entity.id}
        onSelectNode={props.onSelectEntity}
        onSelectEdge={(rel, sourceLabel, targetLabel) => setSelectedEdge({ rel, sourceLabel, targetLabel })}
      />

      {selectedEdge && (
        <div style={{ marginTop: 16 }}>
          <EvidencePanel
            relationship={selectedEdge.rel}
            sourceLabel={selectedEdge.sourceLabel}
            targetLabel={selectedEdge.targetLabel}
          />
        </div>
      )}
    </div>
  );
}
