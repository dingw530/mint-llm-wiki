import { useState, useCallback, type ReactNode } from 'react';

export function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  const el = node as { props?: { children?: ReactNode } } | null;
  if (el?.props?.children) return extractText(el.props.children);
  return '';
}

interface CodeBlockProps {
  children: ReactNode;
  className?: string;
}

export default function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const codeText = extractText(children);
  const hasLangClass = className && (className.includes('language-') || className.includes('hljs'));
  const isBlock = hasLangClass || codeText.includes('\n');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = codeText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [codeText]);

  if (!isBlock) {
    return <code className="inline-code">{children}</code>;
  }

  const lang = className
    ? className.replace('language-', '').split(' ')[0]
    : '';

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{lang}</span>
        <button className="copy-btn" onClick={handleCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="code-block-content">
        <code>{children}</code>
      </pre>
    </div>
  );
}
