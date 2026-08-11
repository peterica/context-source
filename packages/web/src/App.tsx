import { useState } from 'react';
import { ProjectList } from './components/ProjectList.js';
import { ProjectWorkspace } from './components/ProjectWorkspace.js';

export default function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  if (selectedProjectId) {
    return (
      <ProjectWorkspace
        projectId={selectedProjectId}
        onBack={() => setSelectedProjectId(null)}
        onSwitchProject={setSelectedProjectId}
      />
    );
  }

  return <ProjectList onSelect={setSelectedProjectId} />;
}
