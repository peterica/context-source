import { Fragment, useEffect, useState } from 'react';
import type { AnalysisRun } from '@contextsource/core';
import { api } from '../api/client.js';
import { formatRevision } from '../format.js';

export function RunHistory(props: { projectId: string; refreshKey: number }) {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRuns(props.projectId, 50)
      .then((res) => setRuns(res.items))
      .catch((e) => console.error(e));
  }, [props.projectId, props.refreshKey]);

  return (
    <div>
      <h2 className="section-title">분석 이력</h2>
      <div className="panel">
        {runs.length === 0 && <div className="empty">분석 이력이 없습니다.</div>}
        {runs.length > 0 && (
          <table className="list">
            <thead>
              <tr>
                <th>시작 시각</th>
                <th>모드</th>
                <th>상태</th>
                <th>Revision</th>
                <th>Entity 수</th>
                <th>Relationship 수</th>
                <th>실패</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    key={r.id}
                    style={{ cursor: r.failures.length > 0 ? 'pointer' : 'default' }}
                    onClick={() => r.failures.length > 0 && setExpanded(expanded === r.id ? null : r.id)}
                  >
                    <td>{new Date(r.startedAt).toLocaleString('ko-KR')}</td>
                    <td>{r.mode}</td>
                    <td>
                      <span className={`badge ${r.status === 'completed' ? 'static' : 'fail'}`}>{r.status}</span>
                    </td>
                    <td>{formatRevision(r.revision)}</td>
                    <td>{r.entityCount ?? '-'}</td>
                    <td>{r.relationshipCount ?? '-'}</td>
                    <td>{r.failures.length > 0 ? `${r.failures.length} ▾` : '0'}</td>
                  </tr>
                  {expanded === r.id && r.failures.length > 0 && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={7}>
                        <table className="list">
                          <tbody>
                            {r.failures.map((f) => (
                              <tr key={f.filePath}>
                                <td>{f.filePath}</td>
                                <td>{f.message}</td>
                                <td>{f.preservedRevision ? formatRevision(f.preservedRevision) : '(없음)'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
