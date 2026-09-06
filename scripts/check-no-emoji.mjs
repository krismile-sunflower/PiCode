// Scans frontend sources for emoji code points. The UI must not render
// emoji as icons or decorations; use lucide-react components instead.
// Keyboard glyphs and typographic punctuation (arrows in kbd hints, ·, —,
// …, •) are intentionally allowed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src'];
const EXTS = new Set(['.ts', '.tsx', '.css', '.html', '.md']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target']);

// Emoji and symbol ranges that must never appear in the UI.
const EMOJI_RANGES = [
  [0x1f000, 0x1faff], // main emoji planes
  [0xfe0f, 0xfe0f], // variation selector-16
  [0x2700, 0x27bf], // dingbats (✂ ✅ ❌ …)
  [0x2600, 0x26ff], // misc symbols (★ ☀ ⚠ …)
  [0x2b00, 0x2bff], // arrows and stars (⭐ ⬆ …)
  [0x2190, 0x21ff], // arrows (↑ ↓ → ↗) — icon-like glyphs
  [0x25a0, 0x25ff], // geometric shapes (▲ ► ▱ …)
  [0x2300, 0x23ff], // misc technical (⌘ ⏎ ⌃ ⌄)
  [0x276c, 0x276f],
  [0x203a, 0x203a], // › used as icon
  [0x25b8, 0x25b8], // ▸
  [0x25b1, 0x25b1], // ▱
  [0x2713, 0x2713], // ✓
];

function isEmoji(code) {
  return EMOJI_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

const offenders = [];

function scanFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const ch of line) {
      if (isEmoji(ch.codePointAt(0))) {
        offenders.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
        break;
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (EXTS.has(entry.slice(entry.lastIndexOf('.')))) scanFile(full);
  }
}

for (const root of ROOTS) walk(root);

if (offenders.length) {
  console.error('Emoji/symbol glyphs found — replace with lucide-react icons:\n');
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log('check-no-emoji: OK');
