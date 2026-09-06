/**
 * The AI input-optimizer rewrites the composer draft with a one-off
 * completion. The instruction is the built-in default unless the user picks
 * one of their prompt templates flagged `optimize: true` in the frontmatter.
 * A template may embed `{{input}}`; without it the draft is appended in a
 * quoted block so plain instruction templates keep working.
 */
export const DEFAULT_OPTIMIZE_INSTRUCTION = [
  '你是提示词工程师。请优化下面这段将发送给 AI 编程助手的用户输入：保持原始意图与全部关键细节，补全缺失的约束与上下文，使表述更清晰、具体、结构化。',
  '只输出优化后的提示词正文，不要任何解释或前后缀。',
].join('\n');

const INPUT_PLACEHOLDER = /\{\{\s*input\s*\}\}/;
const INPUT_PLACEHOLDER_GLOBAL = /\{\{\s*input\s*\}\}/g;

export function buildOptimizePrompt(userInput: string, instruction?: string): string {
  const text = userInput.trim();
  const custom = instruction?.trim();
  if (!custom) {
    return [DEFAULT_OPTIMIZE_INSTRUCTION, '', '用户输入：', '"""', text, '"""'].join('\n');
  }
  if (INPUT_PLACEHOLDER.test(custom)) {
    return custom.replace(INPUT_PLACEHOLDER_GLOBAL, () => text);
  }
  return [custom, '', '用户输入：', '"""', text, '"""'].join('\n');
}

const OPTIMIZE_TEMPLATE_PREF_KEY = 'picode:composer-optimize-template';

/** Last picked optimizer template name; empty means the built-in instruction. */
export function readOptimizeTemplatePref(): string {
  try {
    return window.localStorage.getItem(OPTIMIZE_TEMPLATE_PREF_KEY) || '';
  } catch {
    return '';
  }
}

export function writeOptimizeTemplatePref(name: string): void {
  try {
    if (name) window.localStorage.setItem(OPTIMIZE_TEMPLATE_PREF_KEY, name);
    else window.localStorage.removeItem(OPTIMIZE_TEMPLATE_PREF_KEY);
  } catch {
    // The preference is a convenience; losing it must not break optimizing.
  }
}
