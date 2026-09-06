import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIMIZE_INSTRUCTION,
  buildOptimizePrompt,
  readOptimizeTemplatePref,
  writeOptimizeTemplatePref,
} from './prompt-optimizer';

// This vitest/jsdom setup ships without a working storage backend (Node warns
// "localstorage-file was provided without a valid path"), so swap in an
// in-memory Storage before exercising the preference helpers.
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

describe('buildOptimizePrompt', () => {
  it('appends the draft to the default instruction', () => {
    const prompt = buildOptimizePrompt('  帮我修 bug  ');
    expect(prompt).toContain(DEFAULT_OPTIMIZE_INSTRUCTION);
    expect(prompt).toContain('帮我修 bug');
    expect(prompt.indexOf(DEFAULT_OPTIMIZE_INSTRUCTION)).toBeLessThan(prompt.indexOf('帮我修 bug'));
  });

  it('wraps the draft when the custom instruction has no placeholder', () => {
    const prompt = buildOptimizePrompt('原始输入', ' 精简改写，不要扩写 ');
    expect(prompt.startsWith('精简改写，不要扩写')).toBe(true);
    expect(prompt).toContain('原始输入');
  });

  it('substitutes every {{input}} placeholder and keeps the surrounding text', () => {
    const prompt = buildOptimizePrompt('原始输入', '翻译成英文并只输出译文：\n{{input}}\n（以上 {{ input }} 是原文）');
    expect(prompt).toBe('翻译成英文并只输出译文：\n原始输入\n（以上 原始输入 是原文）');
  });
});

describe('optimize template preference', () => {
  it('round-trips through localStorage and clears with an empty name', () => {
    writeOptimizeTemplatePref('polish');
    expect(readOptimizeTemplatePref()).toBe('polish');
    writeOptimizeTemplatePref('');
    expect(readOptimizeTemplatePref()).toBe('');
  });
});
