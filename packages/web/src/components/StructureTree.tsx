import { useEffect, useState } from 'react';
import type { Entity, EntityKind } from '@contextsource/core';
import { api, encodeEntityId } from '../api/client.js';
import { ENTITY_KIND_LABEL } from '../format.js';
import { clickableRowProps } from '../a11y.js';

// ADR-0013(BENCHMARK.md 5.7) "구조 보기" — File을 루트로 DECLARES를 지연 확장하는 계층형 트리.
// 3단(File→Class→Method)으로 깊이를 강제하지 않는다 — 분석기는 중첩 함수도 DECLARES로 기록하므로
// (함수가 함수를 선언하는 경우) 실제 깊이는 3단을 넘을 수 있다. 그래서 "펼칠 자식이 있으면 보여준다"는
// 범용 재귀로 만든다.

// external_module은 분석 대상 프로젝트 밖의 패키지를 가리키는 Entity라 DECLARES-out을 가질 수 없다
// (모델 자체가 그렇게 정의돼 있다 — ADR-0002) — 펼침 화살표를 아예 보여주지 않는다.
const NON_EXPANDABLE: Set<EntityKind> = new Set(['external_module']);

function TreeNode(props: { projectId: string; entity: Entity; depth: number; onSelectEntity: (id: string) => void }) {
  const { entity, depth } = props;
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expandable = !NON_EXPANDABLE.has(entity.kind);

  function toggle() {
    if (!expandable) return;
    const next = !expanded;
    setExpanded(next);
    if (next && children === null && !loading) {
      setLoading(true);
      setError(null);
      api
        .getRelationships(props.projectId, encodeEntityId(entity.id), { direction: 'out', types: ['DECLARES'] })
        .then((res) => setChildren(res.items.map((i) => i.counterpart)))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div>
      <div
        className="entity-row"
        style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8 + depth * 18 }}
        {...clickableRowProps(() => props.onSelectEntity(entity.id))}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={expanded ? `${entity.name} 접기` : `${entity.name} 펼치기`}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              width: 16,
              flexShrink: 0,
              fontSize: 10,
              padding: 0,
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        <span className="badge kind">{ENTITY_KIND_LABEL[entity.kind]}</span>
        <span className="name">{entity.name}</span>
        {entity.kind !== 'file' && entity.filePath && (
          <span className="path" style={{ marginLeft: 'auto' }}>
            {entity.filePath}
          </span>
        )}
      </div>
      {expanded && (
        <div>
          {loading && <div className="empty" style={{ padding: '4px 0', paddingLeft: 8 + (depth + 1) * 18 }}>불러오는 중…</div>}
          {error && <div className="empty" style={{ padding: '4px 0', paddingLeft: 8 + (depth + 1) * 18 }}>{error}</div>}
          {children && children.length === 0 && (
            <div className="empty" style={{ padding: '4px 0', paddingLeft: 8 + (depth + 1) * 18, textAlign: 'left' }}>
              선언된 항목 없음
            </div>
          )}
          {children?.map((c) => (
            <TreeNode key={c.id} projectId={props.projectId} entity={c} depth={depth + 1} onSelectEntity={props.onSelectEntity} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StructureTree(props: { projectId: string; onSelectEntity: (id: string) => void }) {
  const [files, setFiles] = useState<Entity[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const LIMIT = 200; // GET /entities의 limit 상한(API.md 2.1)

  useEffect(() => {
    setFiles(null);
    api
      .searchEntities(props.projectId, { kind: 'file', limit: LIMIT })
      .then((res) => {
        setFiles(res.items);
        setTotal(res.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.projectId]);

  if (error) return <div className="empty">{error}</div>;
  if (!files) return <div className="empty">불러오는 중…</div>;

  return (
    <div className="content" style={{ width: '100%' }}>
      <h2 className="section-title">
        구조 보기 — File {total}개{total > LIMIT ? ` (상위 ${LIMIT}개만 표시)` : ''}
      </h2>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        File을 펼쳐 그 안에서 선언된 Class/Interface/Function을 따라가고, 다시 Method까지 내려갈 수 있습니다. 이름을
        클릭하면 탐색 탭에서 자세히 볼 수 있습니다.
      </div>
      {files.length === 0 && <div className="empty">분석된 File이 없습니다. 먼저 전체 분석을 실행하세요.</div>}
      <div className="panel">
        {files.map((f) => (
          <TreeNode key={f.id} projectId={props.projectId} entity={f} depth={0} onSelectEntity={props.onSelectEntity} />
        ))}
      </div>
    </div>
  );
}
