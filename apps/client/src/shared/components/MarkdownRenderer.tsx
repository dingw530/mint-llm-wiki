import { memo, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema } from 'hast-util-sanitize';
import CodeBlock from './CodeBlock';
import type { Components } from 'react-markdown';
import type { MouseEvent } from 'react';

type LinkClickHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), 'mint-wiki'],
  },
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span || []), 'className'],
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    pre: [...(defaultSchema.attributes?.pre || []), 'className'],
    th: [...(defaultSchema.attributes?.th || []), 'align'],
    td: [...(defaultSchema.attributes?.td || []), 'align'],
  },
};

interface MarkdownAstNode {
  type: string;
  value?: string;
  children?: MarkdownAstNode[];
}

/** 将正文中的 Wiki 引用编号转换为可单独设置样式的 HTML 标记。 */
function remarkCitationMarkers() {
  return (tree: MarkdownAstNode) => {
    transformCitationMarkers(tree);
  };
}

/** 递归处理 Markdown 文本节点，并保留行内代码和代码块中的原始内容。 */
function transformCitationMarkers(node: MarkdownAstNode): void {
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      transformCitationMarkers(child);
      return [child];
    }

    const parts = child.value.split(/(\[C\d+\])/g);
    if (parts.length === 1) return [child];

    return parts
      .filter(Boolean)
      .map((part): MarkdownAstNode =>
        /^\[C\d+\]$/.test(part)
          ? { type: 'html', value: `<span class="citation-marker">${part}</span>` }
          : { type: 'text', value: part },
      );
  });
}

const codeComponent: Components['code'] = ({ children, className }) => (
  <CodeBlock className={className}>{children}</CodeBlock>
);

const STREAMING_MARKDOWN_SMALL_BLOCK_LIMIT = 2_000;
const STREAMING_MARKDOWN_LARGE_BLOCK_LIMIT = 8_000;
const STREAMING_MARKDOWN_MEDIUM_INTERVAL_MS = 60;
const STREAMING_MARKDOWN_LARGE_INTERVAL_MS = 120;

/** 根据当前 pending block 大小决定 Markdown 重解析间隔。 */
function getStreamingMarkdownInterval(blockSize: number): number {
  if (blockSize <= STREAMING_MARKDOWN_SMALL_BLOCK_LIMIT) return 0;
  if (blockSize <= STREAMING_MARKDOWN_LARGE_BLOCK_LIMIT)
    return STREAMING_MARKDOWN_MEDIUM_INTERVAL_MS;
  return STREAMING_MARKDOWN_LARGE_INTERVAL_MS;
}

/** 返回 Markdown fenced code block 的起始标记。 */
function getFenceMarker(line: string): string | null {
  return line.match(/^\s{0,3}(`{3,}|~{3,})(?:\S.*)?$/)?.[1] || null;
}

/** 判断一行是否结束当前 fenced code block。 */
function isClosingFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= marker.length &&
    trimmed[0] === marker[0] &&
    /^(`+|~+)$/.test(trimmed) &&
    trimmed.length >= marker.length
  );
}

/** 判断一行是否是 Markdown 列表项。 */
function isListItem(line: string): boolean {
  return /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line);
}

/** 判断一行是否属于 Markdown 引用块。 */
function isBlockquote(line: string): boolean {
  return /^\s{0,3}>/.test(line);
}

/** 保留列表和引用内部的空行，避免增量切块破坏 Markdown 结构。 */
function shouldKeepBlankLine(lines: string[], nextLine: string): boolean {
  const meaningfulLines = lines.filter((line) => line.trim());
  if (meaningfulLines.length === 0) return false;

  const hasList = meaningfulLines.some(isListItem);
  const hasBlockquote = meaningfulLines.some(isBlockquote);
  if (hasList && (isListItem(nextLine) || /^\s{2,}\S/.test(nextLine))) return true;
  if (hasBlockquote && isBlockquote(nextLine)) return true;
  return false;
}

/** 按稳定的 Markdown block 切分内容，让已完成 block 可以复用。 */
export function splitMarkdownBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let activeFence: string | null = null;

  for (const line of lines) {
    if (activeFence) {
      current.push(line);
      if (isClosingFence(line, activeFence)) {
        blocks.push(current.join('\n'));
        current = [];
        activeFence = null;
      }
      continue;
    }

    if (!line.trim()) {
      current.push(line);
      continue;
    }

    if (current.length > 0 && current.every((item) => !item.trim())) current = [];
    const hasTrailingBlank = current.length > 0 && !current[current.length - 1].trim();
    if (hasTrailingBlank && !shouldKeepBlankLine(current, line)) {
      blocks.push(current.join('\n'));
      current = [];
    }

    current.push(line);
    const marker = getFenceMarker(line);
    if (marker) activeFence = marker;
  }

  if (current.some((line) => line.trim())) blocks.push(current.join('\n'));
  return blocks;
}

export interface MarkdownRendererProps {
  content: string;
  linkTarget?: '_blank' | '_self';
  onLinkClick?: LinkClickHandler;
  /** 流式阶段节流 Markdown 解析，避免每个 token 都重建整棵 DOM 树。 */
  isStreaming?: boolean;
}

interface MarkdownBlockProps {
  content: string;
  linkTarget: '_blank' | '_self';
  onLinkClick?: LinkClickHandler;
  isStreaming: boolean;
}

/** 渲染单个 Markdown block；稳定 block 不会因后续 block 增长而重新解析。 */
const MarkdownBlock = memo(function MarkdownBlock({
  content,
  linkTarget,
  onLinkClick,
  isStreaming,
}: MarkdownBlockProps) {
  const components = useMemo<Partial<Components>>(
    () => ({
      pre: ({ children }) => <>{children}</>,
      code: codeComponent,
      table: ({ children }) => (
        <div className="table-wrapper">
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }) => {
        if (!href || href.startsWith('javascript:')) {
          return <span>{children}</span>;
        }
        return (
          <a
            className={href.startsWith('mint-wiki:') ? 'wiki-link' : undefined}
            href={href}
            target={linkTarget}
            rel={linkTarget === '_blank' ? 'noopener noreferrer' : undefined}
            onClick={(event) => {
              onLinkClick?.(href, event);
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [linkTarget, onLinkClick],
  );

  return (
    <ReactMarkdown
      rehypePlugins={[
        rehypeRaw,
        ...(isStreaming ? [] : [rehypeHighlight]),
        [rehypeSanitize, sanitizeSchema],
      ]}
      remarkPlugins={[remarkGfm, remarkCitationMarkers]}
      urlTransform={(url) => (url.startsWith('mint-wiki:') ? url : defaultUrlTransform(url))}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});

function MarkdownRenderer({
  content,
  linkTarget = '_blank',
  onLinkClick,
  isStreaming = false,
}: MarkdownRendererProps) {
  const [renderedContent, setRenderedContent] = useState(content);
  const pendingContentRef = useRef(content);
  const lastRenderAtRef = useRef(0);
  const renderTimerRef = useRef<number | null>(null);
  const incomingBlocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  const pendingBlockSize =
    incomingBlocks.length > 0 ? incomingBlocks[incomingBlocks.length - 1].length : 0;

  useEffect(() => {
    pendingContentRef.current = content;

    if (!isStreaming) {
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      lastRenderAtRef.current = Date.now();
      setRenderedContent(content);
      return;
    }

    if (renderTimerRef.current !== null) return;

    const elapsed = Date.now() - lastRenderAtRef.current;
    const interval = getStreamingMarkdownInterval(pendingBlockSize);
    const delay = Math.max(0, interval - elapsed);
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = null;
      lastRenderAtRef.current = Date.now();
      setRenderedContent(pendingContentRef.current);
    }, delay);
  }, [content, isStreaming, pendingBlockSize]);

  useEffect(
    () => () => {
      if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current);
    },
    [],
  );

  return useMemo(() => {
    const displayContent = isStreaming ? renderedContent : content;
    if (!displayContent) return null;
    const blocks = splitMarkdownBlocks(displayContent);

    return (
      <div
        className={`markdown-body${isStreaming ? ' markdown-body-streaming' : ''}`}
        aria-busy={isStreaming || undefined}
      >
        {blocks.map((block, index) => (
          <MarkdownBlock
            key={index}
            content={block}
            linkTarget={linkTarget}
            onLinkClick={onLinkClick}
            isStreaming={isStreaming}
          />
        ))}
      </div>
    );
  }, [content, isStreaming, linkTarget, onLinkClick, renderedContent]);
}

export default memo(MarkdownRenderer);
