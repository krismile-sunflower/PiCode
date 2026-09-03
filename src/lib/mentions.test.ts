import { describe, expect, it } from 'vitest';
import { applyMention, extractMentions, matchMention, relativeMention } from './mentions';

describe('composer file mentions', () => {
  it('opens only on a word-initial @', () => {
    expect(matchMention('看看 @src/app', 12)?.query).toBe('src/app');
    expect(matchMention('@a', 2)?.query).toBe('a');
    // An email or a decorator inside pasted code must not trigger the picker.
    expect(matchMention('mail me@example.com', 19)).toBeNull();
    // A completed mention is no longer in progress once a space follows.
    expect(matchMention('@src/app.ts 然后', 15)).toBeNull();
  });

  it('replaces the in-progress token and leaves the caret after it', () => {
    const match = matchMention('看 @ctrl', 7);
    expect(match).not.toBeNull();
    const applied = applyMention('看 @ctrl', match!, 'src/app/controller.ts');
    expect(applied.text).toBe('看 @src/app/controller.ts ');
    expect(applied.caret).toBe(applied.text.length);
  });

  it('extracts path-like mentions only', () => {
    expect(extractMentions('比较 @src/a.ts 和 @docs/b.md，忽略 @todo')).toEqual(['src/a.ts', 'docs/b.md']);
  });

  it('makes workspace paths relative regardless of separator', () => {
    expect(relativeMention(String.raw`D:\work\pi\src\a.ts`, 'D:/work/pi')).toBe('src/a.ts');
    expect(relativeMention('/home/x/pi/src/a.ts', '/home/x/pi/')).toBe('src/a.ts');
    expect(relativeMention('/elsewhere/a.ts', '/home/x/pi')).toBe('/elsewhere/a.ts');
  });
});
