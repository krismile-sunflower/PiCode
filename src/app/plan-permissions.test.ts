import { describe, expect, it } from 'vitest';
// Vite resolves this alias to the desktop extension; TypeScript only sees the
// small browser-safe declaration in vite-env.d.ts.
import { allowanceScope, applyPlanExecutionMarkers, bashScope, builtinPlanToolNames, gitConfigIsHostile, isPlanToolAllowed, isSafePlanBash, parsePlanResponse, planMarkers, PLAN_PROGRESS_TOOL, applyPlanProgress, sessionIdOf } from '@picode-plan-permissions';

describe('plan-mode permissions', () => {
  it('allows a narrow, cross-platform read-only Bash set', () => {
    expect(isSafePlanBash('Get-Content src/app/controller.ts')).toBe(true);
    expect(isSafePlanBash('rg -n "Plan:" src')).toBe(true);
    expect(isSafePlanBash('git diff -- src/app/controller.ts')).toBe(true);
    expect(isSafePlanBash('find . -maxdepth 2')).toBe(true);
  });

  it('rejects shell composition, writes, process launches, and Git writes', () => {
    for (const command of [
      'Get-Content src/app/controller.ts > plan.txt',
      'rg Plan src | Set-Content plan.txt',
      'git status; git add .',
      'git commit -am "ship"',
      'git diff --output=plan.patch',
      'git show --output plan.txt HEAD',
      'pnpm install',
      'Start-Process notepad',
      'find . -exec rm {} \\;',
      'find . -fprintf plan.txt %p',
    ]) {
      expect(isSafePlanBash(command)).toBe(false);
    }
  });

  it('parses only an explicit numbered Plan block and retains stable step ids', () => {
    const existing = {
      phase: 'plan' as const,
      goal: 'Ship the workflow',
      steps: [{ id: 'persist', title: 'Old step', status: 'pending' as const }],
      updatedAt: '2026-07-30T00:00:00.000Z',
    };

    expect(parsePlanResponse('Analysis first.\n\n## Plan:\n1. Persist state\n   Store it in a custom entry.\n2) Render review UI', existing)).toEqual([
      { id: 'persist', title: 'Persist state', detail: 'Store it in a custom entry.', status: 'pending' },
      { id: 'step-2', title: 'Render review UI', status: 'pending' },
    ]);
    expect(parsePlanResponse('A numbered list without the Plan header:\n1. Do not accept this', existing)).toEqual([]);
  });

  it('blocks write and unknown tools while preserving approved readers', () => {
    expect(isPlanToolAllowed('read', { path: 'src/app/controller.ts' })).toBe(true);
    expect(isPlanToolAllowed('grep', { pattern: 'Plan' })).toBe(true);
    expect(isPlanToolAllowed('bash', { command: 'pwd' })).toBe(true);
    expect(isPlanToolAllowed('bash', { command: 'Set-Content x y' })).toBe(false);
    expect(isPlanToolAllowed('edit', { path: 'src/app/controller.ts' })).toBe(false);
    expect(isPlanToolAllowed('write', { path: 'notes.md' })).toBe(false);
    expect(isPlanToolAllowed('custom_mutator', {})).toBe(false);
  });

  it('does not enable custom tools that impersonate built-in readers', () => {
    expect(builtinPlanToolNames([
      { name: 'read', sourceInfo: { source: 'builtin' } },
      { name: 'grep', sourceInfo: { source: 'extension' } },
      { name: 'bash', sourceInfo: { source: 'builtin' } },
      { name: 'write', sourceInfo: { source: 'builtin' } },
      { name: 'ls', sourceInfo: { source: 'sdk' } },
    ])).toEqual(['read', 'bash']);
  });

  it('pauses on blockers without regressing completed work or advancing later steps', () => {
    const executing = {
      phase: 'executing' as const,
      goal: 'Ship the workflow',
      steps: [
        { id: 'one', title: 'Persist state', status: 'in_progress' as const },
        { id: 'two', title: 'Render UI', status: 'pending' as const },
        { id: 'three', title: 'Verify', status: 'complete' as const },
      ],
      updatedAt: '2026-07-30T00:00:00.000Z',
    };

    expect(applyPlanExecutionMarkers(executing, new Set([0]), new Set([1]))).toMatchObject({
      phase: 'review',
      steps: [
        { status: 'complete' },
        { status: 'blocked' },
        { status: 'complete' },
      ],
    });
    expect(applyPlanExecutionMarkers(executing, new Set([0]), new Set([0]))).toMatchObject({
      phase: 'executing',
      steps: [
        { status: 'complete' },
        { status: 'in_progress' },
        { status: 'complete' },
      ],
    });
    const lateBlocked = applyPlanExecutionMarkers({
      ...executing,
      steps: [{ ...executing.steps[0]!, status: 'complete' as const }, { ...executing.steps[1]!, status: 'in_progress' as const }, executing.steps[2]!],
    }, new Set(), new Set([0]));
    expect(lateBlocked.steps[0]).toMatchObject({ status: 'complete' });
  });
});

describe('permission allowance scoping', () => {
  it('keys bash allowances on the command family, not just the tool', () => {
    expect(bashScope('git status --short')).toBe('bash:git status');
    expect(bashScope('git push origin main')).toBe('bash:git push');
    expect(bashScope('rm -rf build')).toBe('bash:rm');
    expect(bashScope('C:\Windows\System32\where.EXE node')).not.toBe(bashScope('rm -rf build'));
  });

  it('scopes allowances to the session so a reused Pi process cannot leak them', () => {
    const input = { command: 'git status' };
    expect(allowanceScope('session-a', 'bash', input)).not.toBe(allowanceScope('session-b', 'bash', input));
    expect(allowanceScope('s', 'bash', { command: 'git status' }))
      .not.toBe(allowanceScope('s', 'bash', { command: 'git push' }));
    expect(allowanceScope('s', 'write', { path: 'a.ts' }))
      .not.toBe(allowanceScope('s', 'write', { path: 'b.ts' }));
  });

  it('reads the session id from the session entry', () => {
    expect(sessionIdOf([{ type: 'session', id: 'abc' }, { type: 'message' }])).toBe('abc');
    expect(sessionIdOf([{ type: 'message' }])).toBe('');
  });
});

describe('hostile git configuration', () => {
  it('flags configs that make git run external programs', () => {
    expect(gitConfigIsHostile('[diff]\n\texternal = payload.sh\n')).toBe(true);
    expect(gitConfigIsHostile('[core]\n\tfsmonitor = payload.sh\n')).toBe(true);
    expect(gitConfigIsHostile('[diff "x"]\n\ttextconv = payload.sh\n')).toBe(true);
    expect(gitConfigIsHostile('[alias]\n\tst = status\n')).toBe(true);
    expect(gitConfigIsHostile('[core]\n\tbare = false\n\trepositoryformatversion = 0\n')).toBe(false);
  });

  it('rejects git invocations that can inject configuration inline', () => {
    expect(isSafePlanBash('git -c diff.external=payload.sh diff')).toBe(false);
    expect(isSafePlanBash('git --exec-path=/tmp/evil status')).toBe(false);
    expect(isSafePlanBash('git --git-dir=/tmp/evil/.git log')).toBe(false);
    expect(isSafePlanBash('git status --short')).toBe(true);
  });
});

describe('plan progress markers', () => {
  it('accepts the shapes models actually emit', () => {
    expect([...planMarkers('done [DONE:1]', 'DONE')]).toEqual([0]);
    expect([...planMarkers('[DONE: 2]', 'DONE')]).toEqual([1]);
    expect([...planMarkers('[DONE:1,3]', 'DONE')]).toEqual([0, 2]);
    expect([...planMarkers('【DONE：4】', 'DONE')]).toEqual([3]);
    expect([...planMarkers('[blocked:2]', 'BLOCKED')]).toEqual([1]);
  });

  it('does not confuse the two markers or invent steps', () => {
    expect([...planMarkers('[BLOCKED:2]', 'DONE')]).toEqual([]);
    expect([...planMarkers('[DONE:0]', 'DONE')]).toEqual([]);
    expect([...planMarkers('no markers here', 'DONE')]).toEqual([]);
  });
});

describe('structured plan progress', () => {
  const executing = {
    phase: 'executing' as const,
    goal: 'ship',
    steps: [
      { id: '1', title: 'a', status: 'in_progress' as const },
      { id: '2', title: 'b', status: 'pending' as const },
    ],
    updatedAt: '2026-09-03T00:00:00.000Z',
  };

  it('marks a step complete and advances to the next one', () => {
    const next = applyPlanProgress(executing, 1, 'complete');
    expect(next.steps.map((step) => step.status)).toEqual(['complete', 'in_progress']);
  });

  it('blocking a step pauses the plan for review', () => {
    const next = applyPlanProgress(executing, 2, 'blocked');
    expect(next.phase).toBe('review');
    expect(next.steps[1]?.status).toBe('blocked');
  });

  it('ignores reports that do not refer to a real step of a running plan', () => {
    expect(applyPlanProgress(executing, 0, 'complete')).toBe(executing);
    expect(applyPlanProgress(executing, 9, 'complete')).toBe(executing);
    // A plan that is not executing cannot receive progress.
    expect(applyPlanProgress({ ...executing, phase: 'plan' }, 1, 'complete'))
      .toMatchObject({ phase: 'plan' });
  });

  it('never exposes the progress tool to read-only plan phases', () => {
    // Plan mode activates only Pi's builtin read-only tools, so a custom tool
    // cannot be reached while planning.
    expect(builtinPlanToolNames([
      { name: PLAN_PROGRESS_TOOL, sourceInfo: { source: 'extension' } },
      { name: 'read', sourceInfo: { source: 'builtin' } },
    ])).toEqual(['read']);
  });
});
