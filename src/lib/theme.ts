import type { ThemeId } from './types';
import { isDesktop } from './desktop';

export const themes: Record<ThemeId, { name: string; dark: boolean; colors: string[] }> = {
  dark: {
    name: '深色',
    dark: true,
    // Swatches mirror the actual :root tokens in workbench.css so the
    // settings preview matches what the theme really looks like.
    colors: ['#0c0e12', '#161a22', '#8793f8', '#43d39e'],
  },
  light: {
    name: '浅色',
    dark: false,
    colors: ['#f4f4f1', '#ffffff', '#5968d7', '#43d39e'],
  },
};

const legacyThemeMap: Record<string, ThemeId> = {
  night: 'dark',
  dawn: 'dark',
  midnight: 'dark',
  clean: 'light',
  terracotta: 'light',
  sage: 'light',
};

function normalizeTheme(value: string | null): ThemeId | null {
  if (!value) return null;
  if (value === 'dark' || value === 'light') return value;
  return legacyThemeMap[value] || null;
}

export function getCurrentTheme(): ThemeId {
  const saved = localStorage.getItem('tau-theme');
  const normalized = normalizeTheme(saved);
  if (normalized) return normalized;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function syncNativeTheme(theme: ThemeId): void {
  if (!isDesktop) return;
  // Keep Windows title bar / menu bar in sync with the app chrome.
  void import('@tauri-apps/api/app')
    .then(({ setTheme }) => setTheme(theme))
    .catch(() => undefined);
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
    .catch(() => undefined);
}

export function applyTheme(theme: ThemeId, persist = true): ThemeId {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'light' ? '#f4f4f1' : '#0c0e12',
  );
  if (persist) localStorage.setItem('tau-theme', theme);
  syncNativeTheme(theme);
  return theme;
}
