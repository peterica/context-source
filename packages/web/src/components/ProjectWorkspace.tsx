import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { AnalysisRun, Project } from '@contextsource/core';
import { Overview } from './Overview.js';
import { Explore } from './Explore.js';
import { Review } from './Review.js';
import { RunHistory } from './RunHistory.js';

type Tab = 'overview' | 'explore' | 'review' | 'history';

export function ProjectWorkspace(props: { projectId: string; onBack: () => void }) {
  const { projectId } = props;
  const [tab, setTab] = useState<Tab>('overview');
  const [project, setProject] = useState<Project | null>(null);
  const [lastRun, setLastRun] = useState<AnalysisRun | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function loadProject() {
    const res = await api.getProjectSummary(projectId);
    setProject(res.project);
    setLastRun(res.lastRun);
  }

  useEffect(() => {
    setTab('overview');
    setSelectedEntityId(null);
    loadProject().catch((e) => console.error(e));
  }, [projectId, refreshKey]);

  async function triggerRun(mode: 'full' | 'incremental') {
    setRunning(true);
    setRunError(null);
    try {
      const { status, body } = await api.triggerRun(projectId, mode);
      if (status >= 400) {
        setRunError((body as { error?: { message?: string } }).error?.message ?? 'analysis run failed');
      } else {
        // 분석 실행은 동기적으로 완료된다 (M2/M3 orchestrator) — 바로 최신 상태를 다시 읽는다.
        await loadProject();
        setRefreshKey((k) => k + 1);
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function goToEntity(id: string) {
    setSelectedEntityId(id);
    setTab('explore');
  }

  return (
    <>
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn secondary" onClick={props.onBack}>
            ← 프로젝트 목록
          </button>
          <div>
            <h1>ContextSource{project ? ` — ${project.name}` : ''}</h1>
            <div className="sub">
              {lastRun
                ? `마지막 분석: ${lastRun.mode} · ${lastRun.revision.slice(0, 10)} · entities ${lastRun.entityCount} · relationships ${lastRun.relationshipCount}`
                : '분석 이력 없음 — 전체 분석을 실행하세요'}
            </div>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button className={tab === 'explore' ? 'active' : ''} onClick={() => setTab('explore')}>
            탐색
          </button>
          <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
            검토
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            분석 이력
          </button>
        </nav>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {runError && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{runError}</span>}
          <button className="btn secondary" disabled={running} onClick={() => triggerRun('incremental')}>
            {running ? '실행 중…' : '증분 분석'}
          </button>
          <button className="btn" disabled={running} onClick={() => triggerRun('full')}>
            {running ? '실행 중…' : '전체 분석'}
          </button>
        </div>
      </header>
      <main className="layout">
        {tab === 'overview' && (
          <div className="content" style={{ width: '100%' }}>
            <Overview
              projectId={projectId}
              refreshKey={refreshKey}
              onSelectEntity={goToEntity}
              onGoToReview={() => setTab('review')}
            />
          </div>
        )}
        {tab === 'explore' && (
          <Explore projectId={projectId} selectedEntityId={selectedEntityId} onSelectEntity={setSelectedEntityId} />
        )}
        {tab === 'review' && (
          <div className="content" style={{ width: '100%' }}>
            <Review projectId={projectId} refreshKey={refreshKey} onSelectEntity={goToEntity} />
          </div>
        )}
        {tab === 'history' && (
          <div className="content" style={{ width: '100%' }}>
            <RunHistory projectId={projectId} refreshKey={refreshKey} />
          </div>
        )}
      </main>
    </>
  );
}
