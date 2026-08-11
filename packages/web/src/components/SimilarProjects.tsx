import { useEffect, useState } from 'react';
import { api, type SimilarProject } from '../api/client.js';

// 기술 스택 태그 교집합 기반 유사도 (ADR-0006) — 임베딩/Vector Search가 아니다.
export function SimilarProjects(props: {
  projectId: string;
  refreshKey: number;
  onSelect: (projectId: string) => void;
}) {
  const [items, setItems] = useState<SimilarProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    api
      .getSimilarProjects(props.projectId)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectId, props.refreshKey]);

  if (error) return null;
  if (!loaded) return null;
  if (items.length === 0) return null;

  return (
    <div className="panel">
      <h2 className="section-title">유사한 프로젝트</h2>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
        기술 스택을 공유하는 정도로 계산합니다 (공유 태그 수 기준).
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>이름</th>
            <th>공유 기술 스택</th>
            <th>점수</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.project.id} className="entity-row" onClick={() => props.onSelect(s.project.id)}>
              <td>
                <strong>{s.project.name}</strong>
              </td>
              <td>
                {s.sharedTechStack.map((e) => (
                  <span key={e.value} className="badge kind" style={{ marginRight: 4 }}>
                    {e.value}
                  </span>
                ))}
              </td>
              <td>{s.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
