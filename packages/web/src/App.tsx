import { decodeEntityId, encodeEntityId } from './api/client.js';
import { ProjectList } from './components/ProjectList.js';
import { ProjectWorkspace } from './components/ProjectWorkspace.js';
import { navigate, routeToPath, useRoute, type Tab } from './router.js';

export default function App() {
  const route = useRoute();

  if (route.name === 'project') {
    const selectedEntityId = route.encodedEntityId ? decodeEntityId(route.encodedEntityId) ?? null : null;
    return (
      <ProjectWorkspace
        key={route.projectId}
        projectId={route.projectId}
        tab={route.tab}
        selectedEntityId={selectedEntityId}
        onBack={() => navigate('/')}
        onSwitchProject={(id) => navigate(routeToPath({ name: 'project', projectId: id, tab: 'overview' }))}
        onNavigate={(tab: Tab, entityId?: string) =>
          navigate(
            routeToPath({
              name: 'project',
              projectId: route.projectId,
              tab,
              encodedEntityId: entityId ? encodeEntityId(entityId) : undefined,
            }),
          )
        }
      />
    );
  }

  return (
    <ProjectList
      onSelect={(id) => navigate(routeToPath({ name: 'project', projectId: id, tab: 'overview' }))}
    />
  );
}
