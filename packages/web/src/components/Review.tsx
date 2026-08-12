import { useEffect, useState } from 'react';
import type { Entity, Relationship, UnresolvedReference } from '@contextsource/core';
import { api } from '../api/client.js';
import { REL_TYPE_TOOLTIP, UNRESOLVED_REASON_LABEL, UNRESOLVED_REASON_TOOLTIP } from '../glossary.js';
import { clickableRowProps } from '../a11y.js';

interface Item {
  relationship: Relationship;
  source: Entity;
  target: Entity;
}

interface UnresolvedItem {
  reference: UnresolvedReference;
  source: Entity;
}

function InferredRelationshipsSection(props: { projectId: string; refreshKey: number; onSelectEntity: (id: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  useEffect(() => {
    api
      .listInferredRelationships(props.projectId, limit, offset)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => console.error(e));
  }, [props.projectId, offset, props.refreshKey]);

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 className="section-title">참고용 — 자동 추론된 관계 목록 ({total}건)</h2>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 640 }}>
        정적으로 완전히 확정되지 않아 <span className="badge inferred">inferred</span>로 기록된 관계입니다.
        확신도(confidence)가 낮은 순으로 정렬되어 있으니, 관계가 실제로 맞는지 근거 위치의 코드를 함께
        확인해보세요. 이 화면에서 별도로 승인하거나 삭제할 필요는 없습니다 — 목록은 분석 결과를 그대로
        보여줄 뿐입니다.
      </p>
      <div className="panel">
        {items.length === 0 && <div className="empty">검토할 inferred 관계가 없습니다.</div>}
        {items.length > 0 && (
          <table className="list">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Target</th>
                <th title="관계가 실제로 맞을 확신도 (1.0에 가까울수록 확실함)">Confidence</th>
                <th>근거 위치</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.relationship.id}>
                  <td>
                    <a {...clickableRowProps(() => props.onSelectEntity(item.source.id))} style={{ cursor: 'pointer' }}>
                      {item.source.name}
                    </a>
                  </td>
                  <td title={REL_TYPE_TOOLTIP[item.relationship.type]}>{item.relationship.type}</td>
                  <td>
                    <a {...clickableRowProps(() => props.onSelectEntity(item.target.id))} style={{ cursor: 'pointer' }}>
                      {item.target.name}
                    </a>
                  </td>
                  <td>{item.relationship.confidence.toFixed(2)}</td>
                  <td>
                    {item.relationship.evidence[0]?.filePath}:{item.relationship.evidence[0]?.range.startLine}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btn secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          이전
        </button>
        <button
          className="btn secondary"
          disabled={offset + limit >= total}
          onClick={() => setOffset(offset + limit)}
        >
          다음
        </button>
      </div>
    </div>
  );
}

function UnresolvedReferencesSection(props: { projectId: string; refreshKey: number; onSelectEntity: (id: string) => void }) {
  const [items, setItems] = useState<UnresolvedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  useEffect(() => {
    api
      .listUnresolvedReferences(props.projectId, limit, offset)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => console.error(e));
  }, [props.projectId, offset, props.refreshKey]);

  return (
    <div>
      <h2 className="section-title" title="ADR-0011 — Relationship이 아니라 별도로 기록되는 진단 정보입니다.">
        사각지대 — 발견했지만 대상을 확정 못한 참조 ({total}건)
      </h2>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 640 }}>
        호출·import·상속을 발견했지만 대상을 특정할 수 없어 그래프에 관계로 기록되지 않은 항목입니다.
        이 목록이 있다고 잘못된 것은 아닙니다 — false positive를 만들지 않기 위한 의도적 설계이며, 이
        그래프가 완전하지 않을 수 있다는 사실을 투명하게 보여주기 위한 목록입니다.
      </p>
      <div className="panel">
        {items.length === 0 && <div className="empty">사각지대로 기록된 참조가 없습니다.</div>}
        {items.length > 0 && (
          <table className="list">
            <thead>
              <tr>
                <th>Source</th>
                <th>종류</th>
                <th>이유</th>
                <th>근거 위치</th>
                <th>코드</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.reference.id}>
                  <td>
                    <a {...clickableRowProps(() => props.onSelectEntity(item.source.id))} style={{ cursor: 'pointer' }}>
                      {item.source.name}
                    </a>
                  </td>
                  <td title={REL_TYPE_TOOLTIP[item.reference.kind]}>{item.reference.kind}</td>
                  <td title={UNRESOLVED_REASON_TOOLTIP[item.reference.reason]}>
                    {UNRESOLVED_REASON_LABEL[item.reference.reason]}
                  </td>
                  <td>
                    {item.reference.filePath}:{item.reference.range.startLine}
                  </td>
                  <td>
                    <code style={{ fontSize: 11 }}>{item.reference.snippet}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btn secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          이전
        </button>
        <button
          className="btn secondary"
          disabled={offset + limit >= total}
          onClick={() => setOffset(offset + limit)}
        >
          다음
        </button>
      </div>
    </div>
  );
}

export function Review(props: {
  projectId: string;
  refreshKey: number;
  onSelectEntity: (id: string) => void;
}) {
  return (
    <div>
      <InferredRelationshipsSection {...props} />
      <UnresolvedReferencesSection {...props} />
    </div>
  );
}
