import { isValidElement, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import hljs from './highlight';
import { Check, Copy } from 'lucide-react';

/** Above this size, highlighting costs more than it is worth on every render. */
const MAX_HIGHLIGHT_CHARS = 100_000;

/**
 * Highlight `code` and return HTML, or null when we cannot do it safely.
 *
 * highlight.js escapes the source it emits, which is what makes the
 * `dangerouslySetInnerHTML` below safe: model output never reaches the DOM as
 * live markup. Any failure falls back to the plain text node.
 */
function highlight(code: string, language: string): string | null {
  if (!code || code.length > MAX_HIGHLIGHT_CHARS) return null;
  try {
    const normalized = language.trim().toLowerCase();
    if (normalized && hljs.getLanguage(normalized)) {
      return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
    }
    // Auto-detection is only worth it once there is enough text to judge.
    if (!normalized && code.length > 40) return hljs.highlightAuto(code).value;
  } catch {
    // Fall through to the unhighlighted rendering.
  }
  return null;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => highlight(code, language), [code, language]);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative my-2 overflow-hidden rounded-[11px] border border-line bg-[var(--code-bg)]">
      <div className="flex min-h-[34px] items-center justify-between border-b border-[var(--code-chrome-border)] bg-[var(--code-chrome-bg)] px-2.5 text-[9px] leading-none tracking-[0.04em] uppercase text-[var(--code-chrome-text)] [font-family:var(--app-font-mono)]">
        <span>{language || 'code'}</span>
        <button className={`rounded-md border-0 bg-transparent px-[7px] py-1 text-inherit [font:inherit] cursor-pointer hover:bg-[var(--code-chrome-hover)] hover:text-[var(--code-chrome-text-hover)]${copied ? ' text-success' : ''}`} type="button" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto px-3.5 py-[13px] text-[12px] leading-[1.62] text-[var(--code-fg)] [font-family:var(--app-font-mono)] [tab-size:2]">
        {highlighted === null ? (
          <code className="[font:inherit]">{code}</code>
        ) : (
          <code className="hljs [font:inherit]" dangerouslySetInnerHTML={{ __html: highlighted }} />
        )}
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ alt, ...props }) => <img {...props} alt={alt || ''} className="inline-image mt-1.5 mb-1.5 max-w-full rounded-[10px] border border-line" />,
  pre: ({ children }) => {
    if (isValidElement(children)) {
      const element = children as ReactElement<{ className?: string; children?: ReactNode }>;
      const language = element.props.className?.replace(/^language-/, '') || '';
      const code = String(element.props.children || '').replace(/\n$/, '');
      return <CodeBlock code={code} language={language} />;
    }
    return <pre>{children}</pre>;
  },
  code: ({ children, ...props }) => <code {...props}>{children}</code>,
  table: ({ children }) => (
    <div className="table-wrapper mt-3 mb-3.5 max-w-full overflow-x-auto rounded-xl border border-line-hover bg-elevated shadow-sm">
      <table>{children}</table>
    </div>
  ),
  input: (props) => <input {...props} disabled />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {children}
    </ReactMarkdown>
  );
}

export function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`mt-px inline-flex h-[22px] w-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-dim opacity-100 cursor-pointer transition-[opacity,color,background-color] duration-[var(--duration-fast)] hover:bg-glass-hover hover:text-primary group-hover:text-secondary focus-visible:text-secondary${copied ? ' text-success' : ''}`}
      type="button"
      aria-label="复制消息"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
