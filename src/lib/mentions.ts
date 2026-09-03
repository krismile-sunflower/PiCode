import { apiJson } from './desktop';

export interface MentionMatch {
  /** Index of the `@` in the text. */
  start: number;
  end: number;
  query: string;
}

interface FileContentPayload {
  kind: 'text' | 'image' | 'unsupported';
  content?: string;
  truncated?: boolean;
  reason?: string;
  language?: string;
}

/** Per-file cap when a mention is expanded into the outgoing prompt. */
const MENTION_FILE_LIMIT = 40_000;
/** Total cap across all mentions in one message. */
const MENTION_TOTAL_LIMIT = 120_000;

/**
 * Find an in-progress `@mention` at the caret.
 *
 * Only a run without whitespace counts, and the `@` must start a word so that
 * emails and decorators in pasted code do not open the picker.
 */
export function matchMention(text: string, caret: number): MentionMatch | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  const before = at === 0 ? '' : upto[at - 1] || '';
  if (before && !/[\s(\[{,;:]/.test(before)) return null;
  const query = upto.slice(at + 1);
  if (/[\s]/.test(query)) return null;
  return { start: at, end: caret, query };
}

/** Replace the in-progress mention with the chosen path. */
export function applyMention(text: string, match: MentionMatch, relativePath: string): { text: string; caret: number } {
  const inserted = `@${relativePath} `;
  const next = `${text.slice(0, match.start)}${inserted}${text.slice(match.end)}`;
  return { text: next, caret: match.start + inserted.length };
}

/** Workspace-relative form of an absolute path, for use as a mention token. */
export function relativeMention(filePath: string, root: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normalized = filePath.replace(/\\/g, '/');
  if (normalizedRoot && normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

/** Every `@path` token in a finished message. */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:^|[\s(\[{,;:])@([\w./\\-]+)/g)) {
    const value = match[1];
    if (value && /[./\\]/.test(value)) found.add(value);
  }
  return [...found];
}

/**
 * Turn `@path` mentions into actual file content.
 *
 * Inserting the path alone (what the file sidebar used to do) hands the model
 * a string, not the code — it then has to spend a tool call re-reading a file
 * the user already pointed at. Reads are capped so a stray `@` on a huge file
 * cannot blow up the context window.
 */
export async function expandMentions(text: string, root: string): Promise<string> {
  const mentions = extractMentions(text);
  if (!mentions.length) return text;

  const blocks: string[] = [];
  let budget = MENTION_TOTAL_LIMIT;
  for (const mention of mentions) {
    if (budget <= 0) break;
    const absolute = /^([a-zA-Z]:[\\/]|\/)/.test(mention)
      ? mention
      : `${root.replace(/[\\/]$/, '')}/${mention}`.replace(/\\/g, '/');
    try {
      const payload = await apiJson<FileContentPayload>(`/api/file/content?path=${encodeURIComponent(absolute)}`);
      if (payload.kind !== 'text' || !payload.content) continue;
      const slice = payload.content.slice(0, Math.min(MENTION_FILE_LIMIT, budget));
      budget -= slice.length;
      const truncated = payload.truncated || slice.length < payload.content.length;
      blocks.push(
        `\`\`\`${payload.language || ''} ${mention}\n${slice}${truncated ? '\n… (内容已截断)' : ''}\n\`\`\``,
      );
    } catch {
      // A mention that cannot be read stays as plain text in the message.
    }
  }
  if (!blocks.length) return text;
  return `${text}\n\n<!-- 引用的文件内容 -->\n${blocks.join('\n\n')}`;
}
