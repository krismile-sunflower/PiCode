import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../lib/types';
import { ProjectsView } from './Views';

vi.mock('../app/controller', () => ({ controller: {} }));

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    projects: [
      { name: 'src-tauri', path: 'D:\\demo\\src-tauri', active: true, sessionCount: 2, lastActive: 0 },
      { name: 'dodge-the-creeps-2d', path: 'D:\\demo\\dodge-the-creeps-2d', active: false, sessionCount: 0, lastActive: 0 },
    ],
    liveInstances: [
      { pid: 1, projectPath: 'D:\\demo\\src-tauri' },
      { pid: 2, projectPath: 'D:\\DEMO\\Dodge-The-Creeps-2D\\' },
    ],
    noFolderActive: false,
    projectsLoading: false,
  } as unknown as AppSnapshot;
}

describe('launcher running-state badges', () => {
  it('marks the window project as current and other running projects as running', () => {
    render(<ProjectsView snapshot={snapshot()} />);
    expect(screen.getByText('当前窗口')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('does not mark projects without a live instance as running', () => {
    render(
      <ProjectsView
        snapshot={{
          ...snapshot(),
          liveInstances: [{ pid: 1, projectPath: 'D:\\demo\\src-tauri' }],
        } as unknown as AppSnapshot}
      />,
    );
    expect(screen.getByText('当前窗口')).toBeInTheDocument();
    expect(screen.queryByText('运行中')).not.toBeInTheDocument();
  });
});
