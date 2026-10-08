import { useState, useEffect, useCallback } from 'react';
import { getWikiSchema, testEmbeddingConnection, updateWikiSchema } from '@/services/api';
import type { WikiCategory } from '@/types';
import type { WikiSchema } from '@/services/api/wiki';

interface WikiPanelProps {
  wikiPath: string;
  setWikiPath: (value: string) => void;
  wikiSearchMode: 'keyword' | 'hybrid';
  setWikiSearchMode: (value: 'keyword' | 'hybrid') => void;
  embeddingApiUrl: string;
  setEmbeddingApiUrl: (value: string) => void;
  embeddingModel: string;
  setEmbeddingModel: (value: string) => void;
  embeddingDimensions: number;
  setEmbeddingDimensions: (value: number) => void;
  onToast?: (type: 'success' | 'error', message: string) => void;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 110-2h6V5a1 1 0 011-1z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M10 2a1 1 0 00-1 1v1H5a1 1 0 000 2h14a1 1 0 100-2h-4V3a1 1 0 00-1-1h-4zm-3 6a1 1 0 00-1 1v10a2 2 0 002 2h8a2 2 0 002-2V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H14V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H8V9a1 1 0 00-1-1z" />
    </svg>
  );
}

const emptyCategory = (): WikiCategory => ({
  name: '',
  description: '',
  include: [],
  exclude: [],
});

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(value: string[]): string {
  return value.join(', ');
}

export default function WikiPanel({
  wikiPath,
  setWikiPath,
  wikiSearchMode,
  setWikiSearchMode,
  embeddingApiUrl,
  setEmbeddingApiUrl,
  embeddingModel,
  setEmbeddingModel,
  embeddingDimensions,
  setEmbeddingDimensions,
  onToast,
}: WikiPanelProps) {
  const [schema, setSchema] = useState<WikiSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [embeddingTest, setEmbeddingTest] = useState<'idle' | 'testing' | 'success' | 'error'>(
    'idle',
  );
  const [embeddingTestMessage, setEmbeddingTestMessage] = useState('');

  const fetchSchema = useCallback(async () => {
    if (!wikiPath) {
      setLoading(false);
      setSchema(null);
      return;
    }
    setLoading(true);
    try {
      setSchema(await getWikiSchema());
    } catch {
      setSchema(null);
    } finally {
      setLoading(false);
    }
  }, [wikiPath]);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  const updateCategory = (index: number, patch: Partial<WikiCategory>) => {
    setSchema((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: prev.categories.map((category, categoryIndex) =>
          categoryIndex === index ? { ...category, ...patch } : category,
        ),
      };
    });
  };

  const handleAddCategory = () => {
    const name = newCategory.trim();
    if (!name || !schema) return;
    if (schema.categories.some((category) => category.name === name)) {
      onToast?.('error', `分类 "${name}" 已存在`);
      return;
    }
    setSchema({ ...schema, categories: [...schema.categories, { ...emptyCategory(), name }] });
    setNewCategory('');
  };

  const handleRemoveCategory = (index: number) => {
    const category = schema?.categories[index];
    if (!schema || !category) return;
    if (!window.confirm(`确定删除分类 "${category.name || '未命名分类'}"？`)) return;
    setSchema({
      ...schema,
      categories: schema.categories.filter((_, categoryIndex) => categoryIndex !== index),
    });
  };

  const handleSave = async () => {
    if (!schema) return;
    const categories = schema.categories.map((category) => ({
      ...category,
      name: category.name.trim(),
      description: category.description.trim(),
      include: category.include.map((item) => item.trim()).filter(Boolean),
      exclude: category.exclude.map((item) => item.trim()).filter(Boolean),
    }));
    if (categories.some((category) => !category.name)) {
      onToast?.('error', '分类名称不能为空');
      return;
    }
    if (new Set(categories.map((category) => category.name)).size !== categories.length) {
      onToast?.('error', '分类名称不能重复');
      return;
    }

    setSaving(true);
    try {
      const saved = await updateWikiSchema({ ...schema, categories });
      setSchema(saved);
      onToast?.('success', '知识库 Schema 已保存');
    } catch (err) {
      onToast?.('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const categories = schema?.categories || [];

  const handleEmbeddingTest = async () => {
    setEmbeddingTest('testing');
    setEmbeddingTestMessage('正在测试连接...');
    try {
      const result = await testEmbeddingConnection({
        apiUrl: embeddingApiUrl,
        model: embeddingModel,
        dimensions: embeddingDimensions,
      });
      if (!result.success) throw new Error(result.message || 'Embedding 服务连接失败');
      setEmbeddingTest('success');
      setEmbeddingTestMessage(`${result.message || '连接成功'}（${result.dimensions} 维）`);
    } catch (error) {
      setEmbeddingTest('error');
      setEmbeddingTestMessage((error as Error).message);
    }
  };

  return (
    <div className="wiki-panel">
      <div className="form-group">
        <label htmlFor="wikiPath">Wiki 知识库路径</label>
        <input
          id="wikiPath"
          type="text"
          value={wikiPath}
          onChange={(e) => setWikiPath(e.target.value)}
          placeholder="/Users/me/my-wiki"
        />
        <p className="form-help">
          Agent 将在此目录下创建和维护知识页面。支持绝对路径，留空禁用 Wiki 功能。
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="wikiSearchMode">搜索模式</label>
        <div
          id="wikiSearchMode"
          className="wiki-search-mode-options"
          role="group"
          aria-label="搜索模式"
        >
          <button
            type="button"
            className={wikiSearchMode === 'keyword' ? 'active' : ''}
            aria-pressed={wikiSearchMode === 'keyword'}
            onClick={() => setWikiSearchMode('keyword')}
          >
            关键词（FTS5）
          </button>
          <button
            type="button"
            className={wikiSearchMode === 'hybrid' ? 'active' : ''}
            aria-pressed={wikiSearchMode === 'hybrid'}
            onClick={() => setWikiSearchMode('hybrid')}
          >
            向量融合（FTS5 + BGE-M3）
          </button>
        </div>
        <p className="form-help">向量服务不可用时会自动回退到关键词搜索。</p>
      </div>

      {wikiSearchMode === 'hybrid' && (
        <div className="wiki-embedding-settings">
          <div className="form-group">
            <label htmlFor="embeddingApiUrl">Embedding 服务 URL</label>
            <div className="connection-test-row">
              <input
                id="embeddingApiUrl"
                type="url"
                value={embeddingApiUrl}
                onChange={(event) => {
                  setEmbeddingApiUrl(event.target.value);
                  setEmbeddingTest('idle');
                }}
                placeholder="http://127.0.0.1:11434/v1"
              />
              <button
                type="button"
                className="btn-secondary connection-test-button"
                onClick={handleEmbeddingTest}
                disabled={embeddingTest === 'testing'}
              >
                {embeddingTest === 'testing' ? '测试中...' : '测试连接'}
              </button>
            </div>
            {embeddingTest !== 'idle' && (
              <p className={`connection-test-result ${embeddingTest}`} role="status">
                {embeddingTestMessage}
              </p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="embeddingModel">Embedding 模型</label>
            <input
              id="embeddingModel"
              type="text"
              value={embeddingModel}
              onChange={(event) => setEmbeddingModel(event.target.value)}
              placeholder="bge-m3"
            />
          </div>
          <div className="form-group">
            <label htmlFor="embeddingDimensions">向量维度</label>
            <input
              id="embeddingDimensions"
              type="number"
              min="1024"
              max="1024"
              value={embeddingDimensions}
              onChange={(event) => setEmbeddingDimensions(Number(event.target.value))}
            />
            <p className="form-help">
              当前 sqlite-vec 索引固定为 1024 维，BGE-M3 默认输出 1024 维。
            </p>
          </div>
        </div>
      )}

      <hr className="settings-divider" />
      <div className="wiki-schema-heading">
        <div>
          <h4 className="settings-subheading">知识库 Schema</h4>
          <p className="form-help">
            维护分类的定义、包含范围和排除范围，AI 编译知识时会以这里的规则为准。
          </p>
        </div>
        <button className="wiki-schema-save" onClick={handleSave} disabled={!schema || saving}>
          {saving ? '保存中...' : '保存 Schema'}
        </button>
      </div>

      {!wikiPath ? (
        <div className="wiki-categories-empty">请先配置知识库路径</div>
      ) : loading ? (
        <div className="panel-loading">加载中...</div>
      ) : (
        <>
          <div className="wiki-category-list">
            {categories.length === 0 ? (
              <div className="wiki-categories-empty">暂无分类，添加一个分类开始</div>
            ) : (
              categories.map((category, index) => (
                <div key={`${category.name}-${index}`} className="wiki-category-editor">
                  <div className="wiki-category-editor-header">
                    <input
                      className="wiki-category-name-input"
                      value={category.name}
                      onChange={(e) => updateCategory(index, { name: e.target.value })}
                      placeholder="分类名称"
                      aria-label="分类名称"
                    />
                    <button
                      className="wiki-category-remove"
                      onClick={() => handleRemoveCategory(index)}
                      title="删除分类"
                      aria-label="删除分类"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <textarea
                    value={category.description}
                    onChange={(e) => updateCategory(index, { description: e.target.value })}
                    placeholder="分类标准，例如：可复用的方法、流程和工程框架"
                    aria-label={`${category.name || '分类'}定义`}
                    rows={2}
                  />
                  <input
                    value={formatList(category.include)}
                    onChange={(e) => updateCategory(index, { include: parseList(e.target.value) })}
                    placeholder="包含：方法, 流程, 框架"
                    aria-label={`${category.name || '分类'}包含范围`}
                  />
                  <input
                    value={formatList(category.exclude)}
                    onChange={(e) => updateCategory(index, { exclude: parseList(e.target.value) })}
                    placeholder="排除：单个项目案例"
                    aria-label={`${category.name || '分类'}排除范围`}
                  />
                </div>
              ))
            )}
          </div>
          <div className="wiki-category-add">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              placeholder="输入新分类名"
            />
            <button
              className="wiki-category-add-btn"
              onClick={handleAddCategory}
              disabled={!newCategory.trim()}
              title="添加分类"
              aria-label="添加分类"
            >
              <PlusIcon />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
