import { useEffect, useState } from 'react';
import { api, type ProjectSummary } from '../api/client.js';
import type { TechStackEntry } from '@contextsource/core';

export function ProjectList(props: { onSelect: (projectId: string) => void }) {
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api
      .listProjects()
      .then((res) => setSummaries(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshKey]);

  const filtered = summaries.filter((s) => s.project.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="content" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>ContextSource</h1>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            등록된 프로젝트 {summaries.length}개 — 코드 관계 지식베이스
          </div>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '취소' : '+ 새 프로젝트 등록'}
        </button>
      </div>

      {showForm && (
        <RegisterProjectForm
          onDone={() => {
            setShowForm(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <input
        placeholder="프로젝트 이름으로 검색…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: 320, marginBottom: 12 }}
      />

      {error && <div className="empty">{error}</div>}

      <div className="panel">
        {filtered.length === 0 ? (
          <div className="empty">
            {summaries.length === 0
              ? '등록된 프로젝트가 없습니다. "새 프로젝트 등록"으로 시작하세요.'
              : '검색 결과가 없습니다.'}
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>이름</th>
                <th>경로</th>
                <th>기술 스택</th>
                <th>Entities</th>
                <th>Relationships</th>
                <th>마지막 분석</th>
                <th>revision</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.project.id} className="entity-row" onClick={() => props.onSelect(s.project.id)}>
                  <td>
                    <strong>{s.project.name}</strong>
                    {s.project.description && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.project.description}</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{s.project.rootPath}</td>
                  <td>
                    <TechStackBadges entries={s.techStack} />
                  </td>
                  <td>{s.entityCount}</td>
                  <td>{s.relationshipCount}</td>
                  <td>
                    {s.lastRun ? (
                      <>
                        <span className={`badge ${s.lastRun.status === 'completed' ? 'static' : 'fail'}`}>
                          {s.lastRun.mode}
                        </span>{' '}
                        {new Date(s.lastRun.startedAt).toLocaleString()}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>분석 안 됨</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{s.lastRun?.revision.slice(0, 10) ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// listProjectsWithStats가 프로젝트 목록과 함께 기술 스택을 한 번에 내려주므로(N+1 방지),
// 이 컴포넌트는 별도 요청 없이 받은 값만 그린다.
function TechStackBadges(props: { entries: TechStackEntry[] }) {
  const values = props.entries.map((e) => e.value);

  if (values.length === 0) return <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>-</span>;

  const shown = values.slice(0, 4);
  const rest = values.length - shown.length;
  return (
    <span>
      {shown.map((v) => (
        <span key={v} className="badge kind" style={{ marginRight: 4 }}>
          {v}
        </span>
      ))}
      {rest > 0 && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>+{rest}</span>}
    </span>
  );
}

function RegisterProjectForm(props: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [tsconfigPath, setTsconfigPath] = useState('tsconfig.json');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { status, body } = await api.createProject({
        name,
        path: projectPath,
        tsconfigPath,
        description: description || undefined,
      });
      if (status >= 400) {
        setError((body as { error?: { message?: string } }).error?.message ?? '등록 실패');
        return;
      }
      props.onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ marginBottom: 16 }}>
      <h2 className="section-title">새 프로젝트 등록</h2>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 0 }}>
        경로는 서버의 workspace root 기준 상대 경로입니다 (예: <code>my-service</code>).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <label>
          이름
          <input required value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          경로 (workspace root 기준 상대 경로)
          <input
            required
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="my-service"
            style={{ width: '100%' }}
          />
        </label>
        <label>
          tsconfig 경로 (프로젝트 경로 기준)
          <input
            required
            value={tsconfigPath}
            onChange={(e) => setTsconfigPath(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          설명 (선택)
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
        </label>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <button className="btn" type="submit" disabled={submitting}>
        {submitting ? '등록 중…' : '등록'}
      </button>
    </form>
  );
}
