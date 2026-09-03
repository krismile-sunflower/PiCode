import { describe, expect, it } from 'vitest';
import hljs from './highlight';

describe('code highlighting', () => {
  it('registers the aliases people type in fences', () => {
    for (const alias of ['ts', 'tsx', 'js', 'py', 'rs', 'sh', 'yml', 'toml', 'ps1', 'html']) {
      expect(hljs.getLanguage(alias), alias).toBeTruthy();
    }
  });

  it('emits themeable token classes and escapes the source', () => {
    const html = hljs.highlight('const x = "<script>";', { language: 'ts' }).value;
    expect(html).toContain('hljs-keyword');
    // Nothing from the model may reach the DOM as live markup.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
