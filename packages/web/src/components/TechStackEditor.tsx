import { useEffect, useState } from 'react';
import type { TechStackCategory, TechStackEntry } from '@contextsource/core';
import { api } from '../api/client.js';

const CATEGORIES: TechStackCategory[] = [
  'language',
  'runtime',
  'framework',
  'orm',
  'database',
  'build_tool',
];

const CATEGORY_LABEL: Record<TechStackCategory, string> = {
  language: '언어',
  runtime: '런타임',
  framework: '프레임워크',
  orm: 'ORM',
  database: '데이터베이스',
  build_tool: '빌드 도구',
};

export function TechStackEditor(props: { projectId: string; onChange?: () => void }) {
  const [items, setItems] = useState<TechStackEntry[]>([]);
  const [category, setCategory] = useState<TechStackCategory>('framework');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);

  function load() {
    api
      .getTechStack(props.projectId)
      .then((res) => setItems(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(() => {
    setDetectMessage(null);
    load();
  }, [props.projectId]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setError(null);
    try {
      const { status, body } = await api.addTechStackEntry(props.projectId, category, value.trim());
      if (status >= 400) {
        setError((body as any)?.error?.message ?? '추가 실패');
        return;
      }
      setValue('');
      load();
      props.onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeEntry(entry: TechStackEntry) {
    setError(null);
    try {
      const { status, body } = await api.removeTechStackEntry(props.projectId, entry.category, entry.value);
      if (status >= 400) {
        setError((body as any)?.error?.message ?? '제거 실패');
        return;
      }
      load();
      props.onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function detect() {
    setDetecting(true);
    setDetectMessage(null);
    try {
      const { status, body } = await api.detectTechStack(props.projectId);
      if (status >= 400) {
        setError((body as any)?.error?.message ?? '자동 감지 실패');
        return;
      }
      setItems(body.items);
      setDetectMessage(
        body.added.length > 0 ? `${body.added.length}개 항목을 새로 감지했습니다.` : '새로 감지된 항목이 없습니다.',
      );
      props.onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  }

  const byCategory = CATEGORIES.map((c) => ({ category: c, entries: items.filter((i) => i.category === c) }));

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 className="section-title">기술 스택</h2>
        <button className="btn secondary" onClick={detect} disabled={detecting}>
          {detecting ? '감지 중…' : '자동 감지 (package.json)'}
        </button>
      </div>
      {detectMessage && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{detectMessage}</div>}
      {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}

      {items.length === 0 ? (
        <div className="empty" style={{ marginBottom: 12 }}>
          등록된 기술 스택이 없습니다.
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {byCategory
            .filter((g) => g.entries.length > 0)
            .map((g) => (
              <div key={g.category} style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginRight: 8 }}>
                  {CATEGORY_LABEL[g.category]}
                </span>
                {g.entries.map((entry) => (
                  <span key={entry.value} className="badge kind" style={{ marginRight: 6 }}>
                    {entry.value}{' '}
                    <span
                      onClick={() => removeEntry(entry)}
                      style={{ cursor: 'pointer', marginLeft: 4 }}
                      title="제거"
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            ))}
        </div>
      )}

      <form onSubmit={addEntry} style={{ display: 'flex', gap: 6 }}>
        <select
          aria-label="기술 스택 카테고리"
          value={category}
          onChange={(e) => setCategory(e.target.value as TechStackCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          placeholder="예: Redis"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn secondary" type="submit">
          추가
        </button>
      </form>
    </div>
  );
}
