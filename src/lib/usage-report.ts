import type { ModelUsageRow, TimelineItem } from './types';

/**
 * Aggregate a conversation's token and cost usage per model.
 *
 * The header only ever showed a session total and a context percentage, which
 * answers "am I close to the limit" but not "what is this actually costing,
 * and which model spent it" — the question that matters once a project routes
 * different work to different providers.
 */
export function usageByModel(timeline: TimelineItem[]): ModelUsageRow[] {
  const rows = new Map<string, ModelUsageRow>();
  for (const item of timeline) {
    if (item.kind !== 'message' || item.message.role !== 'assistant' || !item.message.usage) continue;
    const usage = item.message.usage;
    const key = item.message.model || '未记录模型';
    const row = rows.get(key) || { model: key, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    row.messages += 1;
    row.input += usage.input || 0;
    row.output += usage.output || 0;
    row.cacheRead += usage.cacheRead || 0;
    row.cacheWrite += (usage.cacheWrite || 0) + (usage.cacheWrite1h || 0);
    row.cost += usage.cost?.total || 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => right.cost - left.cost || right.messages - left.messages);
}

/** CSV of the per-model breakdown, for pasting into a spreadsheet. */
export function usageCsv(rows: readonly ModelUsageRow[]): string {
  const header = 'model,messages,input,output,cacheRead,cacheWrite,cost';
  const body = rows.map((row) =>
    [row.model, row.messages, row.input, row.output, row.cacheRead, row.cacheWrite, row.cost.toFixed(6)]
      .map((value) => (typeof value === 'string' && /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : String(value)))
      .join(','),
  );
  return [header, ...body].join('\n');
}
