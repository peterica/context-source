import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { formatRevision } from '../format.js';
import type { Tab } from '../router.js';
import type { AnalysisRun, Project } from '@contextsource/core';
import { Overview } from './Overview.js';
import { StructureTree } from './StructureTree.js';
import { Explore } from './Explore.js';
import { Review } from './Review.js';
import { RunHistory } from './RunHistory.js';
import { ChangedImpact } from './ChangedImpact.js';

export function ProjectWorkspace(props: {
  projectId: string;
  tab: Tab;
  selectedEntityId: string | null;
  onBack: () => void;
  onSwitchProject: (projectId: string) => void;
  onNavigate: (tab: Tab, entityId?: string) => void;
}) {
  const { projectId, tab, selectedEntityId } = props;
  const [project, setProject] = useState<Project | null>(null);
  const [lastRun, setLastRun] = useState<AnalysisRun | null>(null);
  const [runningMode, setRunningMode] = useState<'full' | 'incremental' | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const running = runningMode !== null;

  async function loadProject() {
    const res = await api.getProjectSummary(projectId);
    setProject(res.project);
    setLastRun(res.lastRun);
  }

  useEffect(() => {
    loadProject().catch((e) => console.error(e));
  }, [projectId, refreshKey]);

  async function triggerRun(mode: 'full' | 'incremental') {
    setRunningMode(mode);
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
      setRunningMode(null);
    }
  }

  function goToEntity(id: string) {
    props.onNavigate('explore', id);
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
                ? `마지막 분석: ${lastRun.mode} · ${formatRevision(lastRun.revision)} · entities ${lastRun.entityCount} · relationships ${lastRun.relationshipCount}`
                : '분석 이력 없음 — 전체 분석을 실행하세요'}
            </div>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => props.onNavigate('overview')}>
            Overview
          </button>
          <button className={tab === 'structure' ? 'active' : ''} onClick={() => props.onNavigate('structure')}>
            구조
          </button>
          <button className={tab === 'explore' ? 'active' : ''} onClick={() => props.onNavigate('explore')}>
            탐색
          </button>
          <button className={tab === 'review' ? 'active' : ''} onClick={() => props.onNavigate('review')}>
            검토
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => props.onNavigate('history')}>
            분석 이력
          </button>
          <button className={tab === 'impact' ? 'active' : ''} onClick={() => props.onNavigate('impact')}>
            변경 영향
          </button>
        </nav>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {runError && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{runError}</span>}
          <button
            className="btn secondary"
            disabled={running || !lastRun}
            title={!lastRun ? '먼저 전체 분석을 1회 실행해야 합니다' : undefined}
            onClick={() => triggerRun('incremental')}
          >
            {runningMode === 'incremental' ? '실행 중…' : '증분 분석'}
          </button>
          <button className="btn" disabled={running} onClick={() => triggerRun('full')}>
            {runningMode === 'full' ? '실행 중…' : '전체 분석'}
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
              onGoToReview={() => props.onNavigate('review')}
              onSelectProject={props.onSwitchProject}
            />
          </div>
        )}
        {tab === 'structure' && <StructureTree projectId={projectId} onSelectEntity={goToEntity} />}
        {tab === 'explore' && (
          <Explore projectId={projectId} selectedEntityId={selectedEntityId} onSelectEntity={goToEntity} />
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
        {tab === 'impact' && (
          <div className="content" style={{ width: '100%' }}>
            <ChangedImpact projectId={projectId} refreshKey={refreshKey} onSelectEntity={goToEntity} />
          </div>
        )}
      </main>
    </>
  );
}
