import { useMemo, useState } from 'react';

interface DiffLine {
  text: string;
  kind: 'add' | 'del' | 'hunk' | 'meta' | 'context';
  oldNumber: number | null;
  newNumber: number | null;
  /** Index of the hunk this line belongs to, or -1 for file headers. */
  hunk: number;
}

export interface HunkAction {
  label: string;
  title: string;
  run(patch: string): void;
}

/** Beyond this, we stop paying for per-line spans and show the raw patch. */
const MAX_DIFF_LINES = 4_000;

function classify(text: string): DiffLine['kind'] {
  if (text.startsWith('@@')) return 'hunk';
  if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode|Binary files)/.test(text)) {
    return 'meta';
  }
  if (text.startsWith('+')) return 'add';
  if (text.startsWith('-')) return 'del';
  return 'context';
}

/** Parse a unified diff into lines carrying their original/new line numbers. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.replace(/\n$/, '').split('\n');
  const parsed: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  for (const text of lines) {
    const kind = classify(text);
    if (kind === 'hunk') {
      const match = text.match(/^@@+\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?/);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      hunk += 1;
      parsed.push({ text, kind, oldNumber: null, newNumber: null, hunk });
      continue;
    }
    if (kind === 'meta') {
      parsed.push({ text, kind, oldNumber: null, newNumber: null, hunk: -1 });
      continue;
    }
    if (kind === 'add') {
      parsed.push({ text, kind, oldNumber: null, newNumber: newLine, hunk });
      newLine += 1;
      continue;
    }
    if (kind === 'del') {
      parsed.push({ text, kind, oldNumber: oldLine, newNumber: null, hunk });
      oldLine += 1;
      continue;
    }
    parsed.push({ text, kind, oldNumber: oldLine, newNumber: newLine, hunk });
    oldLine += 1;
    newLine += 1;
  }
  return parsed;
}

/**
 * Rebuild a standalone patch containing a single hunk.
 *
 * `git apply` needs the file headers, so the extracted hunk is re-attached to
 * the `diff --git`/`---`/`+++` preamble of the original patch.
 */
export function hunkPatch(diff: string, hunkIndex: number): string {
  const lines = parseUnifiedDiff(diff);
  const header = lines.filter((line) => line.kind === 'meta').map((line) => line.text);
  const body = lines.filter((line) => line.hunk === hunkIndex && line.kind !== 'meta').map((line) => line.text);
  if (!body.length) return '';
  return `${[...header, ...body].join('\n')}\n`;
}

interface DiffViewProps {
  diff: string;
  className?: string;
  /** Per-hunk buttons (stage / unstage / revert). */
  hunkActions?: HunkAction[];
  /** Called when the user attaches a review note to a line. */
  onComment?(line: { line: number; side: 'old' | 'new'; code: string }, text: string): void;
}

/**
 * Colorized unified diff with old/new line numbers, per-hunk actions and
 * inline review notes.
 *
 * A diff is the single most-read artifact in this app; rendering it as one
 * undifferentiated gray block made reviewing changes harder than reading the
 * chat that produced them.
 */
export function DiffView({ diff, className = 'changes-diff', hunkActions = [], onComment }: DiffViewProps) {
  const [commenting, setCommenting] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const lines = useMemo(() => {
    if (!diff) return [];
    const count = diff.split('\n').length;
    return count > MAX_DIFF_LINES ? null : parseUnifiedDiff(diff);
  }, [diff]);

  if (!lines) return <pre className={className}>{diff}</pre>;

  const submitComment = (index: number) => {
    const line = lines[index];
    if (!line || !draft.trim() || !onComment) return;
    onComment(
      {
        line: line.newNumber ?? line.oldNumber ?? 0,
        side: line.newNumber == null ? 'old' : 'new',
        code: line.text.slice(1),
      },
      draft.trim(),
    );
    setDraft('');
    setCommenting(null);
  };

  return (
    <div className={`${className} diff-view`}>
      {lines.map((line, index) => (
        <div className={`diff-line diff-${line.kind}`} key={`${index}-${line.text.slice(0, 12)}`}>
          <span className="diff-gutter" aria-hidden="true">{line.oldNumber ?? ''}</span>
          <span className="diff-gutter" aria-hidden="true">{line.newNumber ?? ''}</span>
          {onComment && line.kind !== 'meta' && line.kind !== 'hunk' ? (
            <button
              className="diff-comment-btn"
              type="button"
              title="对这一行添加审阅意见"
              aria-label={`对第 ${line.newNumber ?? line.oldNumber ?? 0} 行添加审阅意见`}
              onClick={() => { setCommenting(commenting === index ? null : index); setDraft(''); }}
            >
              +
            </button>
          ) : null}
          <code className="diff-text">{line.text || ' '}</code>
          {line.kind === 'hunk' && hunkActions.length ? (
            <span className="diff-hunk-actions">
              {hunkActions.map((action) => (
                <button
                  className="diff-hunk-action"
                  type="button"
                  key={action.label}
                  title={action.title}
                  onClick={() => {
                    const patch = hunkPatch(diff, line.hunk);
                    if (patch) action.run(patch);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </span>
          ) : null}
          {commenting === index ? (
            <div className="diff-comment-editor">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                placeholder="写下对这一行的意见，稍后一并发给 Pi"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { setCommenting(null); setDraft(''); }
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitComment(index);
                }}
              />
              <div className="diff-comment-actions">
                <button type="button" onClick={() => { setCommenting(null); setDraft(''); }}>取消</button>
                <button type="button" disabled={!draft.trim()} onClick={() => submitComment(index)}>添加（⌘⏎）</button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
