import { useEffect, useState } from 'react';
import type { Entity, Relationship } from '@contextsource/core';
import { api, encodeEntityId } from '../api/client.js';
import { formatRevision } from '../format.js';
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
        <span className="badge kind">{entity.kind}</span>{' '}
        <strong style={{ fontSize: 16 }}>{entity.name}</strong>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          {entity.filePath ? `${entity.filePath}${entity.range ? `:${entity.range.startLine}-${entity.range.endLine}` : ''}` : '(external package)'}
          {entity.revision && ` · rev ${formatRevision(entity.revision)}`}
        </div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          들어오는 관계 {counts?.in ?? 0} · 나가는 관계 {counts?.out ?? 0}
        </div>
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2 className="section-title">Caller ({callers.length})</h2>
          {callers.length === 0 && <div className="empty">없음</div>}
          {callers.map((c) => (
            <div
              key={c.relationship.id}
              className="entity-row"
              onClick={() => props.onSelectEntity(c.counterpart.id)}
            >
              <span className="name">{c.counterpart.name}</span>{' '}
              <span className={`badge ${c.relationship.resolution}`}>{c.relationship.resolution}</span>
              <div className="path">{c.counterpart.filePath}</div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2 className="section-title">Callee ({callees.length})</h2>
          {callees.length === 0 && <div className="empty">없음</div>}
          {callees.map((c) => (
            <div
              key={c.relationship.id}
              className="entity-row"
              onClick={() => props.onSelectEntity(c.counterpart.id)}
            >
              <span className="name">{c.counterpart.name}</span>{' '}
              <span className={`badge ${c.relationship.resolution}`}>{c.relationship.resolution}</span>
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
