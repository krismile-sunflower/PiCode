const DRAFT_STORAGE_PREFIX = 'picode:composer-draft:';
const HISTORY_STORAGE_KEY = 'picode:composer-history';
const HISTORY_LIMIT = 50;

function draftKey(sessionFile: string | null): string {
  return `${DRAFT_STORAGE_PREFIX}${sessionFile || '__no_session__'}`;
}

/** Composer text is stored per session so switching does not discard it. */
export function readDraft(sessionFile: string | null): string {
  try {
    return window.localStorage.getItem(draftKey(sessionFile)) || '';
  } catch {
    return '';
  }
}

export function writeDraft(sessionFile: string | null, value: string): void {
  try {
    if (value.trim()) window.localStorage.setItem(draftKey(sessionFile), value);
    else window.localStorage.removeItem(draftKey(sessionFile));
  } catch {
    // Private mode or a full quota: a lost draft must not break sending.
  }
}

export function readInputHistory(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function writeInputHistory(history: readonly string[]): void {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // History is a convenience; losing it must not fail the send.
  }
}

/** Newest first, de-duplicated, capped — the shape the ArrowUp key walks through. */
export function pushInputHistory(history: readonly string[], entry: string): string[] {
  const value = entry.trim();
  if (!value) return [...history];
  return [value, ...history.filter((item) => item !== value)].slice(0, HISTORY_LIMIT);
}
