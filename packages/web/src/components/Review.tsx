import { useEffect, useState } from 'react';
import type { Relationship, Entity } from '@contextsource/core';
import { api } from '../api/client.js';

interface Item {
  relationship: Relationship;
  source: Entity;
  target: Entity;
}

export function Review(props: {
  projectId: string;
  refreshKey: number;
  onSelectEntity: (id: string) => void;
}) {
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
    <div>
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
                <th>Confidence</th>
                <th>근거 위치</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.relationship.id}>
                  <td>
                    <a onClick={() => props.onSelectEntity(item.source.id)} style={{ cursor: 'pointer' }}>
                      {item.source.name}
                    </a>
                  </td>
                  <td>{item.relationship.type}</td>
                  <td>
                    <a onClick={() => props.onSelectEntity(item.target.id)} style={{ cursor: 'pointer' }}>
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
