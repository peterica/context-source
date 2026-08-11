import { useEffect, useState } from 'react';
import { api, type ProjectStats } from '../api/client.js';
import type { AnalysisRun } from '@contextsource/core';
import { TechStackEditor } from './TechStackEditor.js';

const KIND_LABEL: Record<string, string> = {
  file: 'File',
  class: 'Class',
  interface: 'Interface',
  function: 'Function',
  method: 'Method',
  external_module: 'External Module',
};

export function Overview(props: {
  projectId: string;
  refreshKey: number;
  onSelectEntity: (id: string) => void;
  onGoToReview: () => void;
}) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [lastRun, setLastRun] = useState<AnalysisRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getStats(props.projectId), api.getProjectSummary(props.projectId)])
      .then(([s, p]) => {
        setStats(s);
        setLastRun(p.lastRun);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.projectId, props.refreshKey]);

  if (error) return <div className="empty">{error}</div>;
  if (!stats) return <div className="empty">불러오는 중…</div>;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <TechStackEditor projectId={props.projectId} />
      </div>

      <h2 className="section-title">Entity / Relationship / Evidence 통계</h2>
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-tile">
          <div className="n">{stats.entities.total}</div>
          <div className="l">Entities</div>
        </div>
        <div className="stat-tile">
          <div className="n">{stats.relationships.total}</div>
          <div className="l">Relationships</div>
        </div>
        <div className="stat-tile">
          <div className="n">{stats.evidence.total}</div>
          <div className="l">Evidence</div>
        </div>
        <div className="stat-tile">
          <div className="n">{stats.relationships.byResolution.static}</div>
          <div className="l">Static</div>
        </div>
        <div className="stat-tile">
          <div className="n">{stats.relationships.byResolution.inferred}</div>
          <div className="l">Inferred</div>
        </div>
      </div>

      <div className="split" style={{ marginBottom: 20 }}>
        <div className="panel">
          <h2 className="section-title">Entity 종류별</h2>
          <table className="list">
            <tbody>
              {Object.entries(stats.entities.byKind).map(([kind, count]) => (
                <tr key={kind}>
                  <td>{KIND_LABEL[kind] ?? kind}</td>
                  <td style={{ textAlign: 'right' }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2 className="section-title">Relationship 종류별</h2>
          <table className="list">
            <tbody>
              {Object.entries(stats.relationships.byType).map(([type, count]) => (
                <tr key={type}>
                  <td>{type}</td>
                  <td style={{ textAlign: 'right' }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section-title">
        분석 실패{lastRun && lastRun.failures.length > 0 ? ` (${lastRun.failures.length})` : ''}
      </h2>
      <div className="panel" style={{ marginBottom: 20 }}>
        {!lastRun || lastRun.failures.length === 0 ? (
          <div className="empty">최근 분석에 실패한 파일이 없습니다.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>파일</th>
                <th>메시지</th>
                <th>보존된 revision</th>
              </tr>
            </thead>
            <tbody>
              {lastRun.failures.map((f) => (
                <tr key={f.filePath}>
                  <td>{f.filePath}</td>
                  <td>{f.message}</td>
                  <td>{f.preservedRevision ? f.preservedRevision.slice(0, 10) : '(없음)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <button className="btn secondary" onClick={props.onGoToReview}>
          Inferred 관계 검토하기 ({stats.relationships.byResolution.inferred}건) →
        </button>
      </div>
    </div>
  );
}
