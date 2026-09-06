import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

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
export function DiffView({ diff, className = '', hunkActions = [], onComment }: DiffViewProps) {
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
    <div className={`${className} flex flex-col py-2 font-mono text-[12px] leading-[1.6] whitespace-normal`}>
      {lines.map((line, index) => (
        <div
          className={`group relative flex flex-wrap items-start min-h-[19px]${line.kind === 'add' ? ' bg-[color-mix(in_srgb,var(--success)_13%,transparent)]' : line.kind === 'del' ? ' bg-[color-mix(in_srgb,var(--error)_12%,transparent)]' : line.kind === 'hunk' ? ' bg-glass' : ''}`}
          key={`${index}-${line.text.slice(0, 12)}`}
        >
          <span className="w-10 shrink-0 select-none pr-2 text-right text-[11px] text-ghost" aria-hidden="true">{line.oldNumber ?? ''}</span>
          <span className="w-10 shrink-0 select-none pr-2 text-right text-[11px] text-ghost" aria-hidden="true">{line.newNumber ?? ''}</span>
          {onComment && line.kind !== 'meta' && line.kind !== 'hunk' ? (
            <button
              className="absolute left-[76px] hidden h-[15px] w-[15px] items-center justify-center rounded-[4px] border-0 bg-accent p-0 leading-none text-white group-hover:flex"
              type="button"
              title="对这一行添加审阅意见"
              aria-label={`对第 ${line.newNumber ?? line.oldNumber ?? 0} 行添加审阅意见`}
              onClick={() => { setCommenting(commenting === index ? null : index); setDraft(''); }}
            >
              <Plus size={10} />
            </button>
          ) : null}
          <code
            className={`min-w-0 flex-1 pr-3 [font:inherit] whitespace-pre-wrap break-words${line.kind === 'add' ? ' text-[var(--code-added)]' : line.kind === 'del' ? ' text-[var(--code-deleted)]' : line.kind === 'hunk' ? ' text-accent-text' : line.kind === 'meta' ? ' text-dim' : ' text-secondary'}`}
          >
            {line.text || ' '}
          </code>
          {line.kind === 'hunk' && hunkActions.length ? (
            <span className="ml-auto inline-flex gap-1 pr-2">
              {hunkActions.map((action) => (
                <button
                  className="rounded-[var(--radius-pill)] border border-line bg-glass px-[7px] py-px text-[10px] text-dim hover:border-accent hover:text-accent-text"
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
            <div className="mt-1.5 mb-2 ml-[88px] flex w-full flex-col gap-1.5 pr-3">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                placeholder="写下对这一行的意见，稍后一并发给 Pi"
                className="w-full resize-y rounded-[8px] border border-line bg-panel p-2 text-xs text-primary outline-0 [font-family:inherit]"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { setCommenting(null); setDraft(''); }
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitComment(index);
                }}
              />
              <div className="flex justify-end gap-2">
                <button className="rounded-[7px] border border-line bg-glass px-2.5 py-[3px] text-[11px] text-secondary" type="button" onClick={() => { setCommenting(null); setDraft(''); }}>取消</button>
                <button className="rounded-[7px] border border-accent bg-glass px-2.5 py-[3px] text-[11px] text-accent-text" type="button" disabled={!draft.trim()} onClick={() => submitComment(index)}>添加（Ctrl+Enter）</button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
