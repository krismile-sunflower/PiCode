import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, PiPromptTemplate } from '../lib/types';
import { writeOptimizeTemplatePref } from '../lib/prompt-optimizer';
import { CustomizationView } from './Views';

// This vitest/jsdom setup ships without a working storage backend (Node warns
// "localstorage-file was provided without a valid path"); the manager reads
// the optimizer preference to mark the active template, so swap in an
// in-memory Storage.
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

const { controllerMock } = vi.hoisted(() => {
  let pending: 'optimize' | null = null;
  return {
    controllerMock: {
      loadPrompts: vi.fn(),
      returnToChat: vi.fn(),
      // Mirrors the real one-shot handoff between the composer menu and the pane.
      openOptimizeTemplates: vi.fn(() => { pending = 'optimize'; }),
      consumePendingCustomizationTab: vi.fn(() => {
        const tab = pending;
        pending = null;
        return tab;
      }),
      savePrompt: vi.fn(async () => true),
      deletePrompt: vi.fn(async () => undefined),
    },
  };
});

vi.mock('../app/controller', () => ({ controller: controllerMock }));

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
  description: '审查改动',
  body: '审查已暂存的改动',
  filePath: 'D:/prompts/review.md',
  scope: 'user',
  origin: '',
  editable: true,
};

function snapshot(): AppSnapshot {
  return {
    extensions: { extensions: [], errors: [] },
    packages: { packages: [] },
    automations: [],
    prompts: { userDir: '~/.pi/agent/prompts', projectDir: null, projectTrusted: false, templates: [optimizeTemplate, plainTemplate] },
    promptsLoading: false,
    promptSaving: false,
    promptError: '',
  } as unknown as AppSnapshot;
}

describe('输入优化模板管理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // Drop any pending tab left over by an earlier test.
    controllerMock.consumePendingCustomizationTab();
  });

  it('lands on the optimizer tab when requested from the composer', () => {
    controllerMock.openOptimizeTemplates();
    render(<CustomizationView snapshot={snapshot()} />);
    expect(screen.getByRole('heading', { name: '输入优化' })).toBeInTheDocument();
    expect(screen.getByText('/polish')).toBeInTheDocument();
    // The general manager does not list optimizer templates.
    expect(screen.queryByText('/review')).not.toBeInTheDocument();
    // The built-in default ships as the first, immutable list entry and is in
    // use while no custom template is picked.
    expect(screen.getByText('默认优化')).toBeInTheDocument();
    expect(screen.getByText(/你是提示词工程师/)).toBeInTheDocument();
    expect(screen.getByText('使用中')).toBeInTheDocument();
  });

  it('marks the remembered optimizer as in use', () => {
    writeOptimizeTemplatePref('polish');
    controllerMock.openOptimizeTemplates();
    render(<CustomizationView snapshot={snapshot()} />);
    expect(screen.getByText('使用中')).toBeInTheDocument();
  });

  it('keeps optimizer templates out of the general template manager', () => {
    controllerMock.openOptimizeTemplates();
    render(<CustomizationView snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button', { name: /提示模板/ }));
    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(screen.queryByText('/polish')).not.toBeInTheDocument();
    expect(screen.getByText(/个输入优化模板在「输入优化」页管理/)).toBeInTheDocument();
  });
});
