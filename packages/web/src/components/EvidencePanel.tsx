import type { Relationship } from '@contextsource/core';
import { formatRevision } from '../format.js';

export function EvidencePanel(props: { relationship: Relationship; sourceLabel: string; targetLabel: string }) {
  const { relationship } = props;
  return (
    <div className="panel">
      <h2 className="section-title">Edge Evidence</h2>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <strong>{props.sourceLabel}</strong> —{' '}
        <span className="badge kind">{relationship.type}</span>{' '}
        <span className={`badge ${relationship.resolution}`}>{relationship.resolution}</span>{' '}
        (confidence {relationship.confidence.toFixed(2)}) → <strong>{props.targetLabel}</strong>
      </div>
      {relationship.evidence.map((ev) => (
        <div key={ev.id} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
            {ev.filePath}:{ev.range.startLine}:{ev.range.startCol} – {ev.range.endLine}:{ev.range.endCol}{' '}
            · {ev.analyzer} · rev {formatRevision(ev.revision)}
          </div>
          <div className="evidence-snippet">{ev.snippet}</div>
        </div>
      ))}
    </div>
  );
}
