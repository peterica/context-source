import { useEffect, useState } from 'react';
import type { Entity, EntityKind } from '@contextsource/core';
import { api, encodeEntityId } from '../api/client.js';
import { ENTITY_KIND_LABEL } from '../format.js';

const KINDS: EntityKind[] = ['file', 'class', 'interface', 'function', 'method', 'external_module'];

export function EntitySearch(props: {
  projectId: string;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntityKind | ''>('');
  const [items, setItems] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .searchEntities(props.projectId, { name: name || undefined, kind: kind || undefined, limit: 50 })
        .then((res) => {
          setItems(res.items);
          setTotal(res.total);
        })
        .catch((e) => console.error(e))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [props.projectId, name, kind]);

  return (
    <div>
      <h2 className="section-title">Entity 검색</h2>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          placeholder="이름으로 검색…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as EntityKind | '')}>
          <option value="">모든 종류</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {ENTITY_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
        {loading ? '검색 중…' : `${total}건`}
      </div>
      <div>
        {items.map((e) => (
          <div
            key={e.id}
            className={`entity-row${props.selectedId === e.id ? ' selected' : ''}`}
            onClick={() => props.onSelect(e.id)}
          >
            <span className="badge kind">{ENTITY_KIND_LABEL[e.kind]}</span>{' '}
            <span className="name">{e.name}</span>
            <div className="path">{e.filePath ?? '(external package)'}</div>
          </div>
        ))}
        {items.length === 0 && !loading && <div className="empty">결과 없음</div>}
      </div>
    </div>
  );
}

export { encodeEntityId };
