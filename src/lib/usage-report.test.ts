import { describe, expect, it } from 'vitest';
import type { TimelineItem } from './types';
import { usageByModel, usageCsv } from './usage-report';

const timeline: TimelineItem[] = [
  { id: 'u1', kind: 'message', message: { id: 'u1', role: 'user', content: 'hi' } },
  {
    id: 'a1',
    kind: 'message',
    message: {
      id: 'a1', role: 'assistant', content: 'ok', model: 'openai/gpt-5',
      usage: { input: 100, output: 20, cacheRead: 900, cost: { total: 0.002 } },
    },
  },
  {
    id: 'a2',
    kind: 'message',
    message: {
      id: 'a2', role: 'assistant', content: 'ok', model: 'openai/gpt-5',
      usage: { input: 50, output: 10, cost: { total: 0.001 } },
    },
  },
  {
    id: 'a3',
    kind: 'message',
    message: {
      id: 'a3', role: 'assistant', content: 'ok', model: 'anthropic/claude',
      usage: { input: 10, output: 5, cacheWrite: 7, cacheWrite1h: 3, cost: { total: 0.05 } },
    },
  },
];

describe('usage breakdown', () => {
  it('groups by model and sorts by spend', () => {
    const rows = usageByModel(timeline);
    expect(rows.map((row) => row.model)).toEqual(['anthropic/claude', 'openai/gpt-5']);
    const openai = rows.find((row) => row.model === 'openai/gpt-5');
    expect(openai).toMatchObject({ messages: 2, input: 150, output: 30, cacheRead: 900 });
    expect(openai?.cost).toBeCloseTo(0.003, 6);
    // Both cache-write buckets belong to the same column.
    expect(rows[0]?.cacheWrite).toBe(10);
  });

  it('labels assistant messages with no recorded model instead of dropping them', () => {
    const rows = usageByModel([
      { id: 'x', kind: 'message', message: { id: 'x', role: 'assistant', content: 'x', usage: { output: 1 } } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe('未记录模型');
  });

  it('escapes CSV fields that contain separators', () => {
    const csv = usageCsv([{ model: 'a,b', messages: 1, input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.5 }]);
    expect(csv.split('\n')[1]).toBe('"a,b",1,2,3,0,0,0.500000');
  });
});
