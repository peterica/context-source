import { useEffect, useState } from 'react';
import { api, type ProjectStats } from '../api/client.js';
import { formatRevision, ENTITY_KIND_LABEL } from '../format.js';
import { RESOLUTION_TOOLTIP } from '../glossary.js';
import type { UnresolvedReferenceKind } from '@contextsource/core';
import type { AnalysisRun, EntityKind } from '@contextsource/core';
import { TechStackEditor } from './TechStackEditor.js';
import { SimilarProjects } from './SimilarProjects.js';

export function Overview(props: {
  projectId: string;
  refreshKey: number;
  onSelectEntity: (id: string) => void;
  onGoToReview: () => void;
  onSelectProject: (projectId: string) => void;
}) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [lastRun, setLastRun] = useState<AnalysisRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [techStackVersion, setTechStackVersion] = useState(0);

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
        <TechStackEditor
          projectId={props.projectId}
          onChange={() => setTechStackVersion((v) => v + 1)}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <SimilarProjects
          projectId={props.projectId}
          refreshKey={props.refreshKey + techStackVersion}
          onSelect={props.onSelectProject}
        />
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
        <div className="stat-tile" title={RESOLUTION_TOOLTIP.static}>
          <div className="n">{stats.relationships.byResolution.static}</div>
          <div className="l">Static</div>
        </div>
        <div className="stat-tile" title={RESOLUTION_TOOLTIP.inferred}>
          <div className="n">{stats.relationships.byResolution.inferred}</div>
          <div className="l">Inferred</div>
        </div>
        <div
          className="stat-tile"
          title="발견했지만 대상을 확정 못한 참조 개수입니다 — 이 그래프가 완전하지 않을 수 있다는 신호입니다(ADR-0011)."
        >
          <div className="n">{stats.unresolvedReferences.total}</div>
          <div className="l">Unresolved</div>
        </div>
      </div>

      <div className="split" style={{ marginBottom: 20 }}>
        <div className="panel">
          <h2 className="section-title">Entity 종류별</h2>
          <table className="list">
            <tbody>
              {Object.entries(stats.entities.byKind).map(([kind, count]) => (
                <tr key={kind}>
                  <td>{ENTITY_KIND_LABEL[kind as EntityKind] ?? kind}</td>
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
        <div className="panel">
          <h2 className="section-title">사각지대 종류별</h2>
          {stats.unresolvedReferences.total === 0 ? (
            <div className="empty">없음</div>
          ) : (
            <table className="list">
              <tbody>
                {(Object.entries(stats.unresolvedReferences.byKind) as [UnresolvedReferenceKind, number][])
                  .filter(([, count]) => count > 0)
                  .map(([kind, count]) => (
                    <tr key={kind}>
                      <td>{kind}</td>
                      <td style={{ textAlign: 'right' }}>{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
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
                  <td>{f.preservedRevision ? formatRevision(f.preservedRevision) : '(없음)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn secondary" onClick={props.onGoToReview}>
          Inferred 관계 검토하기 ({stats.relationships.byResolution.inferred}건) →
        </button>
        <button className="btn secondary" onClick={props.onGoToReview}>
          사각지대 검토하기 ({stats.unresolvedReferences.total}건) →
        </button>
      </div>
    </div>
  );
}
