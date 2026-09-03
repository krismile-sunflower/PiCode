import { describe, expect, it } from 'vitest';
import { hunkPatch, parseUnifiedDiff } from './DiffView';

describe('parseUnifiedDiff', () => {
  const diff = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -10,4 +10,5 @@ export function run() {',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
    ' return a;',
  ].join('\n');

  it('classifies every line of a unified patch', () => {
    const lines = parseUnifiedDiff(diff);
    expect(lines.map((line) => line.kind)).toEqual([
      'meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'del', 'add', 'add', 'context',
    ]);
  });

  it('numbers old and new sides independently from the hunk header', () => {
    const lines = parseUnifiedDiff(diff);
    const context = lines[5];
    const removed = lines[6];
    const added = lines[7];
    const trailing = lines[9];

    expect([context?.oldNumber, context?.newNumber]).toEqual([10, 10]);
    expect([removed?.oldNumber, removed?.newNumber]).toEqual([11, null]);
    expect([added?.oldNumber, added?.newNumber]).toEqual([null, 11]);
    // One line removed and two added: the two sides must not drift together.
    expect([trailing?.oldNumber, trailing?.newNumber]).toEqual([12, 13]);
  });

  it('does not mistake the +++/--- file headers for added or removed lines', () => {
    expect(parseUnifiedDiff('--- a/x\n+++ b/x').every((line) => line.kind === 'meta')).toBe(true);
  });
});

describe('hunkPatch', () => {
  const twoHunks = [
    'diff --git a/x.ts b/x.ts',
    'index aaa..bbb 100644',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-two',
    '+TWO',
    '@@ -20,3 +20,3 @@',
    ' twenty',
    '-x',
    '+X',
  ].join('\n');

  it('rebuilds a standalone patch for a single hunk', () => {
    const patch = hunkPatch(twoHunks, 1);
    expect(patch).toContain('diff --git a/x.ts b/x.ts');
    expect(patch).toContain('@@ -20,3 +20,3 @@');
    // The other hunk must not travel with it, or applying stages both.
    expect(patch).not.toContain('@@ -1,3 +1,3 @@');
    expect(patch).not.toContain('-two');
    expect(patch.endsWith('\n')).toBe(true);
  });

  it('returns nothing for a hunk that does not exist', () => {
    expect(hunkPatch(twoHunks, 7)).toBe('');
  });
});
