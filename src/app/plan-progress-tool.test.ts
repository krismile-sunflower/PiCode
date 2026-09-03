import { describe, expect, it } from 'vitest';
// The default export is the extension entry point; the alias resolves to the
// real packaged extension, so this exercises the code Pi actually loads.
import planPermissions from '@picode-plan-permissions';

interface FakeTool {
  name: string;
  parameters?: unknown;
  promptGuidelines?: string[];
  execute(id: string, params: unknown): Promise<{ content: unknown; details: Record<string, unknown> }>;
}

/**
 * Minimal stand-in for Pi's ExtensionAPI.
 *
 * Only the surface the plan controller touches is implemented; anything else
 * would be guessing at behaviour we cannot verify here.
 */
function fakePi(initialTools: string[] = ['read', 'bash', 'edit', 'write']) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const tools: FakeTool[] = [];
  const state = {
    active: [...initialTools],
    entries: [] as unknown[],
    messages: [] as unknown[],
  };

  const pi = {
    registerTool: (tool: FakeTool) => {
      tools.push(tool);
      state.active.push(tool.name);
    },
    registerCommand: () => undefined,
    events: { on: () => undefined },
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(event, handler);
    },
    appendEntry: (customType: string, data: unknown) => {
      state.entries.push({ type: 'custom', customType, data });
    },
    sendMessage: (message: unknown) => state.messages.push(message),
    getActiveTools: () => [...state.active],
    setActiveTools: (next: string[]) => {
      state.active = [...next];
    },
    getAllTools: () => [
      ...initialTools.map((name) => ({ name, sourceInfo: { source: 'builtin' } })),
      ...tools.map((tool) => ({ name: tool.name, sourceInfo: { source: 'extension' } })),
    ],
  };

  return { pi, state, tools, handlers };
}

function sessionEntries(phase: string, steps: unknown[]) {
  return [
    { type: 'session', id: 'session-1' },
    { type: 'custom', customType: 'plan-mode', data: { phase, goal: 'ship', steps, updatedAt: '2026-09-03T00:00:00.000Z' } },
  ];
}

async function startSession(harness: ReturnType<typeof fakePi>, entries: unknown[]) {
  const handler = harness.handlers.get('session_start');
  expect(handler, 'the extension subscribes to session_start').toBeTruthy();
  await handler?.({}, { sessionManager: { getEntries: () => entries } });
}

describe('plan progress tool wiring', () => {
  it('registers the progress tool with a model-usable schema', () => {
    const harness = fakePi();
    planPermissions(harness.pi as never);

    const tool = harness.tools.find((item) => item.name === 'plan_progress');
    expect(tool, 'plan_progress is registered').toBeTruthy();
    const parameters = tool?.parameters as { properties?: Record<string, { enum?: string[] }>; required?: string[] };
    expect(parameters?.required).toEqual(['step', 'status']);
    expect(parameters?.properties?.status?.enum).toEqual(['complete', 'blocked']);
    // The guideline must name the tool: Pi appends these flat, with no grouping.
    expect(tool?.promptGuidelines?.[0]).toContain('plan_progress');
  });

  it('offers the tool only while a plan is executing', async () => {
    const harness = fakePi();
    planPermissions(harness.pi as never);
    const steps = [{ id: '1', title: 'a', status: 'in_progress' }];

    await startSession(harness, sessionEntries('build', []));
    expect(harness.state.active).not.toContain('plan_progress');

    await startSession(harness, sessionEntries('executing', steps));
    expect(harness.state.active).toContain('plan_progress');

    // Planning is read-only: only Pi's own builtin tools survive.
    await startSession(harness, sessionEntries('plan', steps));
    expect(harness.state.active).not.toContain('plan_progress');
    expect(harness.state.active).not.toContain('write');
  });

  it('records a reported step and persists the new plan state', async () => {
    const harness = fakePi();
    planPermissions(harness.pi as never);
    await startSession(harness, sessionEntries('executing', [
      { id: '1', title: '写实现', status: 'in_progress' },
      { id: '2', title: '补测试', status: 'pending' },
    ]));

    const tool = harness.tools.find((item) => item.name === 'plan_progress');
    const result = await tool?.execute('call-1', { step: 1, status: 'complete' });
    expect(result?.details).toMatchObject({ applied: true, step: 1, status: 'complete' });

    const persisted = harness.state.entries.at(-1) as { data: { steps: Array<{ status: string }> } };
    expect(persisted.data.steps.map((step) => step.status)).toEqual(['complete', 'in_progress']);
  });

  it('reports a no-op instead of corrupting state for an unknown step', async () => {
    const harness = fakePi();
    planPermissions(harness.pi as never);
    await startSession(harness, sessionEntries('executing', [{ id: '1', title: 'a', status: 'in_progress' }]));

    const tool = harness.tools.find((item) => item.name === 'plan_progress');
    const result = await tool?.execute('call-1', { step: 7, status: 'complete' });
    expect(result?.details).toMatchObject({ applied: false });
  });
});
