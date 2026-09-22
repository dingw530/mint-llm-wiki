import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { isElectron } from '@/services/api/_base';
import { openWikiInObsidian, readWiki } from '@/services/api';
import MarkdownRenderer from '@/shared/components/MarkdownRenderer';
import { parseMintWikiLink } from '@/shared/utils/wikiLinks';
import WikiVectorHealthCard from './WikiVectorHealthCard';
const WikiGraphPanel = lazy(() => import('./WikiGraphPanel'));
const WikiHeatPanel = lazy(() => import('./WikiHeatPanel'));

type WikiFrontmatter = {
  title?: string;
  tags?: string[];
  created?: string;
  source?: string;
};

type WikiDocument = {
  title: string;
  fileName: string;
  fileDir: string;
  fileExt: string;
  frontmatter: WikiFrontmatter;
  body: string;
};

export function isExternalWikiLink(href: string): boolean {
  return /^(https?:|mailto:|tel:|\/\/)/i.test(href);
}

export function resolveWikiLinkPath(currentPath: string, href: string): string | null {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.startsWith('#')) return null;
  const protocolPath = parseMintWikiLink(trimmedHref);
  if (protocolPath) return protocolPath;
  if (isExternalWikiLink(trimmedHref)) return null;

  const [pathPart] = trimmedHref.split(/[?#]/, 1);
  // URL-decode the path: AI-generated links may contain percent-encoded Chinese characters
  // (e.g., %E5%AE%9E for 实), which are already encoded once in the markdown href.
  // Without decoding here, buildUrlFromManifest's encodeURIComponent would double-encode them,
  // resulting in a filesystem path mismatch.  decodeURIComponent is a no-op for ASCII-only paths.
  let decodedPart = pathPart.replace(/\\/g, '/');
  try {
    decodedPart = decodeURIComponent(decodedPart);
  } catch {
    /* use raw path on malformed input */
  }
  const normalizedHref = decodedPart;
  const currentDirParts = currentPath.split('/').slice(0, -1).filter(Boolean);
  let parts: string[];

  if (normalizedHref.startsWith('/')) {
    const rootRelative = normalizedHref.slice(1);
    if (rootRelative.startsWith('_')) {
      parts = rootRelative.split('/');
    } else if (rootRelative.startsWith('pages/') || rootRelative.startsWith('sources/')) {
      parts = rootRelative.split('/');
    } else {
      parts = ['pages', ...rootRelative.split('/')];
    }
  } else if (normalizedHref.startsWith('pages/') || normalizedHref.startsWith('sources/')) {
    parts = normalizedHref.split('/');
  } else {
    parts = [...currentDirParts, ...normalizedHref.split('/')];
  }

  const resolvedParts: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  let resolvedPath = resolvedParts.join('/');
  if (!resolvedPath) return null;

  const lastSegment = resolvedParts[resolvedParts.length - 1] || '';
  if (!/\.[^.\/]+$/.test(lastSegment)) {
    resolvedPath += '.md';
  }

  return resolvedPath;
}

export function parseWikiDocument(filePath: string, content: string): WikiDocument {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter: WikiFrontmatter = {};
  let body = content;

  if (match) {
    const rawFrontmatter = match[1];
    body = content.slice(match[0].length);

    for (const line of rawFrontmatter.split('\n')) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) continue;

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      if (!key) continue;

      if (key === 'tags' && rawValue.startsWith('[') && rawValue.endsWith(']')) {
        frontmatter.tags = rawValue
          .slice(1, -1)
          .split(',')
          .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        continue;
      }

      const value = rawValue.replace(/^['"]|['"]$/g, '');
      if (key === 'title') frontmatter.title = value;
      if (key === 'created') frontmatter.created = value;
      if (key === 'source') frontmatter.source = value;
    }
  }

  const fileName = filePath.split('/').pop() || filePath;
  const fileDir = filePath.split('/').slice(0, -1).join('/');
  const fileExt = fileName.split('.').pop()?.toLowerCase() || 'md';

  return {
    title: frontmatter.title?.trim() || fileName,
    fileName,
    fileDir,
    fileExt,
    frontmatter,
    body,
  };
}

interface WikiPanelProps {
  filePath: string | null;
  viewMode: 'file' | 'graph' | 'heat';
  onAskQuestion?: (question: string) => void;
  onBack?: () => void;
  onFileSelect?: (path: string) => void;
}

export default function WikiPanel({
  filePath,
  viewMode,
  onAskQuestion,
  onBack,
  onFileSelect,
}: WikiPanelProps) {
  const unsupportedExts = new Set(['pdf', 'html', 'htm']);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [obsidianError, setObsidianError] = useState<string | null>(null);
  const [openingObsidian, setOpeningObsidian] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const document = filePath && content !== null ? parseWikiDocument(filePath, content) : null;
  const hasFrontmatterMeta = Boolean(
    document?.frontmatter.created ||
    document?.frontmatter.source ||
    document?.frontmatter.tags?.length,
  );

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setError(null);
      return;
    }
    setLoading(true);
    setContent(null);
    setError(null);
    readWiki(filePath)
      .then((data) => setContent(data.content))
      .catch((err) => setError((err as Error).message || '加载失败'))
      .finally(() => setLoading(false));
  }, [filePath]);

  useEffect(() => {
    if (!filePath && inputRef.current) {
      inputRef.current.focus();
    }
  }, [filePath]);

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed || !onAskQuestion) return;
    onAskQuestion(trimmed);
    setQuery('');
  };

  const handleOpenInObsidian = async () => {
    if (openingObsidian) return;
    setOpeningObsidian(true);
    setObsidianError(null);
    try {
      await openWikiInObsidian();
    } catch (err) {
      setObsidianError((err as Error).message || '无法打开 Obsidian');
    } finally {
      setOpeningObsidian(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleWikiLinkClick = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (!filePath) return;
    const nextPath = resolveWikiLinkPath(filePath, href);
    if (!nextPath) return;

    event.preventDefault();
    onFileSelect?.(nextPath);
  };

  return (
    <div className="wiki-content-area">
      <div className="wiki-content-header">
        {viewMode === 'file' && filePath ? (
          <div className="wiki-content-breadcrumb">
            <span className="wiki-content-breadcrumb-link" onClick={onBack}>
              知识库
            </span>
            {document?.fileDir && (
              <>
                <span className="wiki-content-breadcrumb-sep">/</span>
                <span>{document.fileDir}</span>
              </>
            )}
            <span className="wiki-content-breadcrumb-sep">/</span>
            <span className="wiki-content-breadcrumb-current">{document?.fileName || ''}</span>
          </div>
        ) : viewMode === 'file' ? (
          <span className="wiki-content-title">知识库</span>
        ) : null}
        {isElectron() && (
          <button
            className="wiki-open-obsidian-btn"
            type="button"
            onClick={handleOpenInObsidian}
            disabled={openingObsidian}
            title="在 Obsidian 中打开知识库根目录"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z" />
            </svg>
            {openingObsidian ? '正在打开…' : '在 Obsidian 中打开'}
          </button>
        )}
      </div>
      {obsidianError && <div className="wiki-obsidian-error">{obsidianError}</div>}
      {viewMode === 'graph' ? (
        <Suspense fallback={<div className="panel-loading">图谱加载中...</div>}>
          <WikiGraphPanel onOpenFile={onFileSelect} />
        </Suspense>
      ) : viewMode === 'heat' ? (
        <Suspense fallback={<div className="panel-loading">热度加载中...</div>}>
          <WikiHeatPanel onOpenFile={onFileSelect} />
        </Suspense>
      ) : (
        <div className="wiki-content-scroll">
          {loading && (
            <div className="skeleton-wiki-content">
              <div className="skeleton skeleton-title-block" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
            </div>
          )}
          {error && <div className="wiki-error">{error}</div>}
          {!filePath && !loading && (
            <div className="wiki-welcome">
              <div className="wiki-welcome-main">
                <div className="wiki-welcome-heading">
                  <span className="wiki-welcome-kicker">知识工作台</span>
                  <h2>知识库</h2>
                  <p>让每次提问都回到可追溯的页面与证据。</p>
                </div>
                <div className="wiki-search-container">
                  <div className="wiki-search-box">
                    <div className="wiki-search-icon">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-4-4" />
                      </svg>
                    </div>
                    <input
                      ref={inputRef}
                      type="text"
                      className="wiki-search-input"
                      placeholder="基于知识库提问..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                    <button
                      className="wiki-search-btn"
                      onClick={handleSubmit}
                      disabled={!query.trim()}
                      aria-label="提问"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <div className="wiki-search-hints">
                    <span className="wiki-search-hint">
                      <kbd>Enter</kbd> 发送
                    </span>
                    <span className="wiki-search-hint">支持关键词与语义检索</span>
                  </div>
                </div>
                <section className="wiki-welcome-status" aria-label="知识状态">
                  <div className="wiki-welcome-section-title">知识状态</div>
                  <WikiVectorHealthCard />
                </section>
                <section className="wiki-welcome-next" aria-label="下一步">
                  <div className="wiki-welcome-section-title">开始工作</div>
                  <div className="wiki-welcome-next-grid">
                    <div>
                      <strong>浏览文档</strong>
                      <span>从左侧文件树打开页面</span>
                    </div>
                    <div>
                      <strong>导入资料</strong>
                      <span>使用左侧上传或摄入任务</span>
                    </div>
                    <div>
                      <strong>继续研究</strong>
                      <span>提问后回到带引用的对话</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
          {!loading &&
            !error &&
            content !== null &&
            (() => {
              if (document && unsupportedExts.has(document.fileExt)) {
                return (
                  <div className="wiki-unsupported">
                    <div className="wiki-unsupported-icon">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                        <polyline points="13 2 13 9 20 9" />
                      </svg>
                    </div>
                    <p className="wiki-unsupported-text">暂不支持预览</p>
                    <p className="wiki-unsupported-hint">
                      该文件格式 ({document.fileExt.toUpperCase()}) 当前暂不支持在线预览
                    </p>
                  </div>
                );
              }
              return (
                <div className="wiki-document-shell">
                  <div className="wiki-document-hero">
                    <div className="wiki-document-hero-main">
                      <div className="wiki-document-kicker">知识库文档</div>
                      <h1 className="wiki-document-title">
                        {document?.title || document?.fileName || ''}
                      </h1>
                      <div className="wiki-document-path">
                        {document?.fileDir ? document.fileDir : '根目录'}
                      </div>
                      {hasFrontmatterMeta && document && (
                        <div className="wiki-document-meta">
                          {document.frontmatter.created && (
                            <span className="wiki-document-meta-item">
                              <span className="wiki-document-meta-label">创建</span>
                              <span>{document.frontmatter.created}</span>
                            </span>
                          )}
                          {document.frontmatter.source && (
                            <span className="wiki-document-meta-item">
                              <span className="wiki-document-meta-label">来源</span>
                              <span>{document.frontmatter.source}</span>
                            </span>
                          )}
                          {document.frontmatter.tags?.length ? (
                            <span className="wiki-document-meta-tags">
                              {document.frontmatter.tags.map((tag) => (
                                <span key={tag} className="wiki-document-tag">
                                  {tag}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <span className="wiki-document-badge">
                      {document?.fileExt.toUpperCase() || 'MD'}
                    </span>
                  </div>
                  <div className="wiki-document-body">
                    <MarkdownRenderer
                      content={document ? document.body : content || ''}
                      onLinkClick={handleWikiLinkClick}
                    />
                  </div>
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
