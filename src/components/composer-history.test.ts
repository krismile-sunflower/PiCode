import { describe, expect, it } from 'vitest';
import { pushInputHistory } from '../lib/composer-history';

describe('composer input history', () => {
  it('keeps the newest entry first and drops duplicates', () => {
    const history = pushInputHistory(pushInputHistory([], 'first'), 'second');
    expect(history).toEqual(['second', 'first']);
    expect(pushInputHistory(history, 'first')).toEqual(['first', 'second']);
  });

  it('ignores blank submissions and caps the list at 50', () => {
    expect(pushInputHistory(['a'], '   ')).toEqual(['a']);
    const long = Array.from({ length: 60 }, (_, index) => `entry-${index}`);
    const capped = pushInputHistory(long, 'newest');
    expect(capped).toHaveLength(50);
    expect(capped[0]).toBe('newest');
  });
});
