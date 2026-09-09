import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../lib/types';

vi.hoisted(() => {
  // Node 22 can expose its incomplete localStorage implementation to jsdom
  // when no storage file is configured. The application only needs the
  // browser Storage surface during module initialization.
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { PiStudioController } from './controller';
import { appStore } from './store';

const openaiModel: ModelInfo = { id: 'gpt-4.1', provider: 'openai' };
const deepseekModel: ModelInfo = { id: 'deepseek-chat', provider: 'deepseek' };

function collectToasts(): Array<{ title: string; message: string; type: string }> {
  const toasts: Array<{ title: string; message: string; type: string }> = [];
  window.addEventListener('pi-studio:toast', (event) => {
    toasts.push((event as CustomEvent<{ title: string; message: string; type: string }>).detail);
  });
  return toasts;
}

describe('controller model picker sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.tauDesktop.setTransport('mirror');
    appStore.update({
      hasActivePiSession: false,
      connection: 'idle',
      models: [],
      currentModelId: '',
      currentModelProvider: '',
    });
  });

  it('surfaces a toast instead of failing silently when the runtime rejects the model', async () => {
    window.tauDesktop.setTransport('rpc');
    const instance = new PiStudioController();
    vi.spyOn(instance, 'rpcCommand').mockResolvedValue({ success: false, error: 'unknown model' } as never);
    const toasts = collectToasts();

    await instance.setModel(deepseekModel);

    expect(toasts.some((toast) =>
      toast.type === 'error'
        && toast.title === '切换模型失败'
        && toast.message.includes('deepseek-chat'),
    )).toBe(true);
  });

  it('records the switched model when the runtime accepts it', async () => {
    window.tauDesktop.setTransport('rpc');
    const instance = new PiStudioController();
    vi.spyOn(instance, 'rpcCommand').mockResolvedValue({
      success: true,
      data: { model: deepseekModel, thinkingLevel: 'off' },
    } as never);

    await instance.setModel({ ...deepseekModel, contextWindow: 64000 });

    const snapshot = appStore.getSnapshot();
    expect(snapshot.currentModelId).toBe('deepseek-chat');
    expect(snapshot.currentModelProvider).toBe('deepseek');
  });

  it('reloads models.json and retries when the runtime does not know the model yet', async () => {
    window.tauDesktop.setTransport('rpc');
    const instance = new PiStudioController();
    appStore.update({ hasActivePiSession: true, connection: 'connected' });
    const zedModel: ModelInfo = { id: 'claude-opus-4-8', provider: 'zed' };
    let setModelCalls = 0;
    let registryReads = 0;
    vi.spyOn(instance, 'rpcCommand').mockImplementation(async (command) => {
      if (command.type === 'set_model') {
        setModelCalls += 1;
        if (setModelCalls === 1) {
          return { success: false, error: 'Model not found: zed/claude-opus-4-8' } as never;
        }
        return { success: true, data: { model: zedModel, thinkingLevel: 'off' } } as never;
      }
      if (command.type === 'get_commands') {
        return { success: true, data: { commands: [{ name: 'refresh-models', description: '', source: 'builtin' }] } } as never;
      }
      if (command.type === 'prompt') return { success: true } as never;
      if (command.type === 'get_available_models') {
        registryReads += 1;
        // First read is the "before" signature; the refreshed registry only
        // contains the new provider on later polls.
        return { success: true, data: { models: registryReads === 1 ? [openaiModel] : [openaiModel, zedModel] } } as never;
      }
      return { success: true } as never;
    });
    vi.spyOn(instance, 'loadModels').mockResolvedValue(undefined);
    const toasts = collectToasts();

    await instance.setModel(zedModel);

    expect(setModelCalls).toBe(2);
    const snapshot = appStore.getSnapshot();
    expect(snapshot.currentModelId).toBe('claude-opus-4-8');
    expect(snapshot.currentModelProvider).toBe('zed');
    expect(toasts.some((toast) => toast.type === 'success' && toast.title === '模型已切换')).toBe(true);
    expect(toasts.some((toast) => toast.type === 'error')).toBe(false);
  });

  it('does not reload the session for failures that a refresh cannot fix', async () => {
    window.tauDesktop.setTransport('rpc');
    const instance = new PiStudioController();
    vi.spyOn(instance, 'rpcCommand').mockResolvedValue({
      success: false,
      error: 'No API key configured for this model',
    } as never);
    const refreshSpy = vi.spyOn(instance, 'refreshPiModels');
    const toasts = collectToasts();

    await instance.setModel(deepseekModel);

    expect(refreshSpy).not.toHaveBeenCalled();
    // Credential errors now surface as the actionable missing-key toast.
    expect(toasts.some((toast) => toast.type === 'error' && toast.title === '该供应商未配置 API Key')).toBe(true);
  });

  it('waits for the runtime model list to actually change before reloading after a save', async () => {
    window.tauDesktop.setTransport('rpc');
    const instance = new PiStudioController();
    appStore.update({ hasActivePiSession: true, connection: 'connected' });
    // The refresh command re-reads models.json asynchronously: the first
    // registry read still serves the stale list, only later polls see the
    // newly added provider.
    let registryReads = 0;
    vi.spyOn(instance, 'rpcCommand').mockImplementation(async (command) => {
      if (command.type === 'get_commands') {
        return { success: true, data: { commands: [{ name: 'refresh-models', description: '', source: 'builtin' }] } } as never;
      }
      if (command.type === 'prompt') return { success: true } as never;
      if (command.type === 'get_available_models') {
        registryReads += 1;
        const models = registryReads === 1 ? [openaiModel] : [openaiModel, deepseekModel];
        return { success: true, data: { models } } as never;
      }
      return { success: true } as never;
    });
    const loadModels = vi.spyOn(instance, 'loadModels').mockResolvedValue(undefined);

    await instance.refreshPiModels();

    // Once for the "before" signature, once for the first poll that sees the change.
    expect(registryReads).toBe(2);
    expect(loadModels).toHaveBeenCalled();
  });
});
