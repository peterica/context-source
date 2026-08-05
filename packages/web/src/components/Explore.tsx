import { EntitySearch } from './EntitySearch.js';
import { EntityExplorer } from './EntityExplorer.js';

export function Explore(props: { selectedEntityId: string | null; onSelectEntity: (id: string) => void }) {
  return (
    <>
      <div className="sidebar">
        <EntitySearch onSelect={props.onSelectEntity} selectedId={props.selectedEntityId} />
      </div>
      <div className="content">
        {props.selectedEntityId ? (
          <EntityExplorer entityId={props.selectedEntityId} onSelectEntity={props.onSelectEntity} />
        ) : (
          <div className="empty">왼쪽에서 Entity를 검색해 선택하세요.</div>
        )}
      </div>
    </>
  );
}
