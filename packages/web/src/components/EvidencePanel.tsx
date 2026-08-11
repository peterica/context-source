import type { Relationship } from '@contextsource/core';
import { formatRevision } from '../format.js';
import { REL_TYPE_TOOLTIP, RESOLUTION_TOOLTIP } from '../glossary.js';

export function EvidencePanel(props: { relationship: Relationship; sourceLabel: string; targetLabel: string }) {
  const { relationship } = props;
  return (
    <div className="panel">
      <h2 className="section-title" title="이 관계가 실제로 존재한다는 근거(코드 위치와 스니펫)입니다.">
        Edge Evidence
      </h2>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <strong>{props.sourceLabel}</strong> —{' '}
        <span className="badge kind" title={REL_TYPE_TOOLTIP[relationship.type]}>
          {relationship.type}
        </span>{' '}
        <span className={`badge ${relationship.resolution}`} title={RESOLUTION_TOOLTIP[relationship.resolution]}>
          {relationship.resolution}
        </span>{' '}
        <span title="관계가 실제로 맞을 확신도 — static은 항상 1.0, inferred는 1.0보다 낮을 수 있습니다.">
          (confidence {relationship.confidence.toFixed(2)})
        </span>{' '}
        → <strong>{props.targetLabel}</strong>
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
