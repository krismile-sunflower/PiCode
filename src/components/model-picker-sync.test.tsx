import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, ModelInfo } from '../lib/types';
import { controller } from '../app/controller';
import { Header } from './WorkbenchChrome';

vi.mock('../app/controller', () => ({
  controller: {
    setModel: vi.fn().mockResolvedValue(undefined),
    setThinkingLevel: vi.fn(),
  },
}));

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    slashCommands: [],
    queue: [],
    plan: { phase: 'off' },
    workspace: { path: '', noFolder: true },
    thinkingLevel: 'off',
    isStreaming: false,
    timeline: [],
    models: [],
    currentModelId: '',
    currentModelProvider: '',
    defaultProvider: '',
    defaultModel: '',
    ...overrides,
  } as unknown as AppSnapshot;
}

const openai: ModelInfo[] = [
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', contextWindow: 128000 },
];
// The provider was just added and saved: refresh succeeded, so its models
// are already in the snapshot — the picker must make them reachable.
const deepseek: ModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', contextWindow: 64000 },
];

function renderHeader(overrides: Partial<AppSnapshot> = {}) {
  return render(
    <Header
      snapshot={snapshot(overrides)}
      sidebarOpen={false}
      onOpenSidebar={vi.fn()}
      fileOpen={false}
      onToggleFiles={vi.fn()}
    />,
  );
}

describe('Header 顶部模型选择器同步新增供应商', () => {
  it('keeps listing the active provider models on open', () => {
    renderHeader({
      models: [...openai, ...deepseek],
      currentModelId: 'gpt-4.1',
      currentModelProvider: 'openai',
    });
    fireEvent.click(screen.getByTitle('切换模型'));
    expect(screen.getByRole('option', { name: /gpt-4\.1/ })).toBeInTheDocument();
  });

  it('makes a newly added provider reachable from the picker', () => {
    renderHeader({
      models: [...openai, ...deepseek],
      currentModelId: 'gpt-4.1',
      currentModelProvider: 'openai',
    });
    fireEvent.click(screen.getByTitle('切换模型'));

    // The list spans all providers: the new provider's models are listed
    // directly, no provider-filter step in between.
    expect(screen.getByRole('option', { name: /deepseek-chat/ })).toBeInTheDocument();

    // Selecting one of its models goes through controller.setModel.
    fireEvent.click(screen.getByRole('option', { name: /deepseek-chat/ }));
    expect(controller.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'deepseek-chat', provider: 'deepseek' }),
    );
  });

  it('still offers models that only exist in models.json when the runtime list lags', () => {
    renderHeader({
      models: [...openai],
      currentModelId: 'gpt-4.1',
      currentModelProvider: 'openai',
      modelsConfig: { providers: { deepseek: { models: [{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }] } } },
    } as Partial<AppSnapshot>);
    fireEvent.click(screen.getByTitle('切换模型'));
    expect(screen.getByRole('option', { name: /deepseek-reasoner/ })).toBeInTheDocument();
  });

  it('narrows the list when searching across providers', () => {
    renderHeader({
      models: [...openai, ...deepseek],
      currentModelId: 'gpt-4.1',
      currentModelProvider: 'openai',
    });
    fireEvent.click(screen.getByTitle('切换模型'));
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'deepseek' } });
    expect(screen.getByRole('option', { name: /deepseek-chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /gpt-4\.1/ })).not.toBeInTheDocument();
  });
});
