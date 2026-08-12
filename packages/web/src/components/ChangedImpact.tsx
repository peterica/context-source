import { useEffect, useState } from 'react';
import type { AnalysisRun, ChangedImpactCandidate } from '@contextsource/core';
import { api, ApiRequestError } from '../api/client.js';
import { entityIdLabel, formatRevision } from '../format.js';
import { clickableRowProps } from '../a11y.js';
import { REL_TYPE_TOOLTIP, RESOLUTION_TOOLTIP } from '../glossary.js';

// BENCHMARK.md 5.3의 검토 순서(변경된 Entity → 직접 영향 → 간접 영향 → 관련 테스트 →
// Evidence)를 그대로 화면 구조로 옮긴다 — ADR-0008 결정 5.
type Group = 'direct' | 'indirect' | 'test';

function groupOf(c: ChangedImpactCandidate): Group {
  if (c.isLikelyTestFile) return 'test';
  return c.isDirectImpact ? 'direct' : 'indirect';
}

const GROUP_TITLE: Record<Group, string> = {
  direct: '직접 영향',
  indirect: '간접 영향',
  test: '관련 테스트로 보이는 파일',
};

const GROUP_TOOLTIP: Record<Group, string> = {
  direct: '변경된 Entity를 한 단계(depth 1)로 바로 참조하는 후보입니다.',
  indirect: '변경된 Entity에 2단계 이상 떨어져 있는 후보입니다 — 경로를 펼쳐 어떻게 연결되는지 확인하세요.',
  test:
    '파일 경로가 test/spec 패턴과 일치해 관련 테스트로 추정되는 후보입니다(구조적 관계가 아니라 경로 기반 휴리스틱입니다).',
};

function CandidateRow(props: {
  candidate: ChangedImpactCandidate;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectEntity: (id: string) => void;
}) {
  const { candidate } = props;
  return (
    <div style={{ marginBottom: 4 }}>
      <div className="entity-row" {...clickableRowProps(() => props.onSelectEntity(candidate.candidate))}>
        <span className="name">{candidate.reason}</span>{' '}
        <span
          className={`badge ${candidate.hasInferredHop ? 'inferred' : 'static'}`}
          title={
            candidate.hasInferredHop
              ? '경로에 추론된(inferred) 관계가 섞여 있어 confidence가 낮아졌습니다.'
              : '경로의 모든 관계가 정적 분석(static)으로 확정되었습니다.'
          }
        >
          confidence {candidate.confidence.toFixed(2)}
        </span>{' '}
        <button
          className="btn secondary"
          style={{ padding: '1px 8px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleExpand();
          }}
        >
          경로 {candidate.path.length}단계 {props.expanded ? '▴' : '▾'}
        </button>
        <div className="path">{entityIdLabel(candidate.candidate)}</div>
      </div>
      {props.expanded && (
        <div style={{ marginLeft: 16, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {candidate.path.map((step, i) => (
            <div key={i} className="panel" style={{ padding: 8 }}>
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <strong>{entityIdLabel(step.sourceId)}</strong>{' '}
                <span className="badge kind" title={REL_TYPE_TOOLTIP[step.type]}>
                  {step.type}
                </span>{' '}
                <span className={`badge ${step.resolution}`} title={RESOLUTION_TOOLTIP[step.resolution]}>
                  {step.resolution}
                </span>{' '}
                (confidence {step.confidence.toFixed(2)}) → <strong>{entityIdLabel(step.targetId)}</strong>
              </div>
              {step.evidence.map((ev) => (
                <div key={ev.id} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                    {ev.filePath}:{ev.range.startLine}:{ev.range.startCol} – {ev.range.endLine}:{ev.range.endCol} ·{' '}
                    {ev.analyzer} · rev {formatRevision(ev.revision)}
                  </div>
                  <div className="evidence-snippet">{ev.snippet}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateGroup(props: {
  group: Group;
  candidates: ChangedImpactCandidate[];
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectEntity: (id: string) => void;
}) {
  if (props.candidates.length === 0) return null;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <h2 className="section-title" title={GROUP_TOOLTIP[props.group]}>
        {GROUP_TITLE[props.group]} ({props.candidates.length})
      </h2>
      {props.candidates.map((c) => (
        <CandidateRow
          key={c.candidate}
          candidate={c}
          expanded={props.expandedId === c.candidate}
          onToggleExpand={() => props.onToggleExpand(c.candidate)}
          onSelectEntity={props.onSelectEntity}
        />
      ))}
    </div>
  );
}

export function ChangedImpact(props: { projectId: string; refreshKey: number; onSelectEntity: (id: string) => void }) {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ChangedImpactCandidate[] | null>(null);
  const [changedEntityCount, setChangedEntityCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .listRuns(props.projectId, 50)
      .then((res) => {
        setRuns(res.items);
        setSelectedRunId((prev) => {
          if (prev && res.items.some((r) => r.id === prev)) return prev;
          const latestCompleted = res.items.find((r) => r.status === 'completed');
          return latestCompleted?.id ?? res.items[0]?.id ?? null;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.projectId, props.refreshKey]);

  useEffect(() => {
    if (!selectedRunId) return;
    setError(null);
    setCandidates(null);
    setExpandedId(null);
    setLoading(true);
    api
      .getChangedImpact(props.projectId, selectedRunId, { depth: 3, maxCandidates: 100 })
      .then((res) => {
        setCandidates(res.candidates);
        setChangedEntityCount(res.stats.changedEntityCount);
        setTruncated(res.truncated);
      })
      .catch((e) => {
        if (e instanceof ApiRequestError) setError(e.message);
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [props.projectId, selectedRunId]);

  const groups: Record<Group, ChangedImpactCandidate[]> = { direct: [], indirect: [], test: [] };
  for (const c of candidates ?? []) groups[groupOf(c)].push(c);

  return (
    <div>
      <h2 className="section-title">변경 영향</h2>
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          비교할 분석 run{' '}
          <select
            value={selectedRunId ?? ''}
            onChange={(e) => setSelectedRunId(e.target.value || null)}
            disabled={runs.length === 0}
          >
            {runs.length === 0 && <option value="">분석 이력 없음</option>}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleString('ko-KR')} · {r.mode} · {formatRevision(r.revision)}
              </option>
            ))}
          </select>
        </label>
        {candidates && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            변경된 Entity {changedEntityCount} · 후보 {candidates.length}
            {truncated && <span className="badge fail" style={{ marginLeft: 6 }}>truncated</span>}
          </span>
        )}
      </div>

      {loading && <div className="empty">불러오는 중…</div>}
      {!loading && error && <div className="empty">{error}</div>}
      {!loading && !error && runs.length === 0 && (
        <div className="empty">분석 이력이 없습니다 — 먼저 전체 분석을 실행하세요.</div>
      )}
      {!loading && !error && candidates && changedEntityCount === 0 && (
        <div className="empty">
          이 run에서 변경된 Entity가 없습니다{runs.length > 0 && runs[0]?.mode === 'full' ? ' (전체 분석은 비교 대상 diff가 없습니다)' : ''}.
        </div>
      )}
      {!loading && !error && candidates && changedEntityCount > 0 && candidates.length === 0 && (
        <div className="empty">변경된 Entity에 구조적으로 의존하는 후보를 찾지 못했습니다.</div>
      )}
      {!loading && !error && candidates && candidates.length > 0 && (
        <>
          <CandidateGroup
            group="direct"
            candidates={groups.direct}
            expandedId={expandedId}
            onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
            onSelectEntity={props.onSelectEntity}
          />
          <CandidateGroup
            group="indirect"
            candidates={groups.indirect}
            expandedId={expandedId}
            onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
            onSelectEntity={props.onSelectEntity}
          />
          <CandidateGroup
            group="test"
            candidates={groups.test}
            expandedId={expandedId}
            onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
            onSelectEntity={props.onSelectEntity}
          />
        </>
      )}
    </div>
  );
}
