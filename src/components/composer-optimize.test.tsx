import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, PiPromptTemplate } from '../lib/types';
import { writeOptimizeTemplatePref } from '../lib/prompt-optimizer';
import { Composer } from './WorkbenchChrome';

// This vitest/jsdom setup ships without a working storage backend (Node warns
// "localstorage-file was provided without a valid path"); the composer reads
// its optimizer preference on mount, so swap in an in-memory Storage.
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() { return store.size; },
    },
  });
});

const { optimizePromptText } = vi.hoisted(() => ({ optimizePromptText: vi.fn() }));

vi.mock('../app/controller', () => ({
  controller: {
    optimizePromptText,
    setThinkingLevel: vi.fn(),
    loadPrompts: vi.fn(),
    setView: vi.fn(),
    openOptimizeTemplates: vi.fn(),
  },
}));

const optimizeTemplate: PiPromptTemplate = {
  name: 'polish',
  description: '精简改写',
  body: '精简改写，不要扩写：{{input}}',
  filePath: 'D:/prompts/polish.md',
  scope: 'user',
  origin: '',
  editable: true,
  optimize: true,
};

const plainTemplate: PiPromptTemplate = {
  name: 'review',
  description: '普通模板',
  body: '审查已暂存的改动',
  filePath: 'D:/prompts/review.md',
  scope: 'user',
  origin: '',
  editable: true,
};

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    slashCommands: [],
    queue: [],
    plan: { phase: 'off' },
    workspace: { path: '', noFolder: true },
    thinkingLevel: 'off',
    isStreaming: false,
    ...overrides,
  } as unknown as AppSnapshot;
}

function renderComposer(overrides: Partial<AppSnapshot> = {}) {
  return render(
    <Composer
      snapshot={snapshot(overrides)}
      pendingFiles={[]}
      editingMessage={null}
      onRemoveFile={vi.fn()}
      onCancelEditing={vi.fn()}
      onOpenCommands={vi.fn()}
    />,
  );
}

describe('Composer AI 优化输入', () => {
  beforeEach(() => {
    optimizePromptText.mockReset();
    // Storage is stubbed in memory; clear the optimizer preference and any
    // leftover draft so every test starts from a clean composer.
    window.localStorage.clear();
  });

  it('sends the draft to the controller and writes the optimized text back', async () => {
    optimizePromptText.mockResolvedValue('优化后的提示词');
    renderComposer();
    const textarea = screen.getByPlaceholderText('向 Pi 发送消息… 输入 / 查看命令');
    fireEvent.change(textarea, { target: { value: '帮我修 bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化输入' }));
    await waitFor(() => expect(optimizePromptText).toHaveBeenCalledWith('帮我修 bug', undefined));
    await waitFor(() => expect(textarea).toHaveValue('优化后的提示词'));
  });

  it('stays disabled while the draft is empty', () => {
    renderComposer();
    expect(screen.getByRole('button', { name: 'AI 优化输入' })).toBeDisabled();
  });

  it('keeps the draft untouched when optimization returns nothing', async () => {
    optimizePromptText.mockResolvedValue('');
    renderComposer();
    const textarea = screen.getByPlaceholderText('向 Pi 发送消息… 输入 / 查看命令');
    fireEvent.change(textarea, { target: { value: '原始内容' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化输入' }));
    await waitFor(() => expect(optimizePromptText).toHaveBeenCalledWith('原始内容', undefined));
    expect(textarea).toHaveValue('原始内容');
  });

  it('does not overwrite newer edits made while optimizing', async () => {
    let resolveOptimization: (value: string) => void = () => {};
    optimizePromptText.mockImplementation(
      () => new Promise<string>((resolve) => { resolveOptimization = resolve; }),
    );
    renderComposer();
    const textarea = screen.getByPlaceholderText('向 Pi 发送消息… 输入 / 查看命令');
    fireEvent.change(textarea, { target: { value: '原始' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化输入' }));
    fireEvent.change(textarea, { target: { value: '用户改过的内容' } });
    resolveOptimization('过期的优化结果');
    await waitFor(() => expect(optimizePromptText).toHaveBeenCalledWith('原始', undefined));
    expect(textarea).toHaveValue('用户改过的内容');
  });

  it('runs the picked optimize template with its body as the instruction', async () => {
    optimizePromptText.mockResolvedValue('改写结果');
    renderComposer({ prompts: { userDir: '', projectDir: null, projectTrusted: true, templates: [optimizeTemplate, plainTemplate] } });
    fireEvent.click(screen.getByRole('button', { name: '选择优化方式' }));
    expect(await screen.findByRole('menuitemradio', { name: '/polish' })).toBeInTheDocument();
    // Plain templates are not optimizer instructions and stay out of the menu.
    expect(screen.queryByRole('menuitemradio', { name: '/review' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: '/polish' }));
    const textarea = screen.getByPlaceholderText('向 Pi 发送消息… 输入 / 查看命令');
    fireEvent.change(textarea, { target: { value: '草稿' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化输入（/polish）' }));
    await waitFor(() => expect(optimizePromptText).toHaveBeenCalledWith('草稿', '精简改写，不要扩写：{{input}}'));
    await waitFor(() => expect(textarea).toHaveValue('改写结果'));
  });

  it('activates a remembered template and falls back via the default menu item', async () => {
    optimizePromptText.mockResolvedValue('默认结果');
    writeOptimizeTemplatePref('polish');
    renderComposer({ prompts: { userDir: '', projectDir: null, projectTrusted: true, templates: [optimizeTemplate] } });
    expect(screen.getByRole('button', { name: 'AI 优化输入（/polish）' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择优化方式' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '默认优化' }));
    expect(screen.getByRole('button', { name: 'AI 优化输入' })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText('向 Pi 发送消息… 输入 / 查看命令');
    fireEvent.change(textarea, { target: { value: '草稿' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化输入' }));
    await waitFor(() => expect(optimizePromptText).toHaveBeenCalledWith('草稿', undefined));
  });
});
