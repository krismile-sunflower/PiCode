import { isValidElement, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import hljs from './highlight';
import { Icon } from './Icon';

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
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span>{language || 'code'}</span>
        <button className={`copy-btn${copied ? ' copied' : ''}`} type="button" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        {highlighted === null ? (
          <code>{code}</code>
        ) : (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
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
  img: ({ alt, ...props }) => <img {...props} alt={alt || ''} className="inline-image" />,
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
    <div className="table-wrapper">
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
      className={`message-copy-btn${copied ? ' copied' : ''}`}
      type="button"
      aria-label="复制消息"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} width={12} height={12} />
    </button>
  );
}
