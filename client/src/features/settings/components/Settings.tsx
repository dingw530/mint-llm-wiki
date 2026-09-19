import { useState, useEffect, useCallback, useRef } from 'react';
import { getSettings, saveSettings } from '@/services/api';
import GeneralTab from './GeneralTab';
import McpServersPanel from './McpServersPanel';
import AgentsPanel from './AgentsPanel';
import MemoriesPanel from './MemoriesPanel';
import EndpointsPanel from './EndpointsPanel';
import SkillsPanel from './SkillsPanel';
import WikiPanel from './WikiPanel';
import BashSecurityPanel from './BashSecurityPanel';
import ExperimentalPanel from './ExperimentalPanel';
import { createEmptyJevFormState, createJevFormState, toJevSettingsInput } from './jevForm';
import type { JevFormState } from './jevForm';
import type { VisibleSettings } from '@/types';

function Toast({ toast }: { toast: { type: string; message: string } | null }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type}`}>{toast.message}</div>;
}

interface SettingsProps {
  onClose: () => void;
  theme: string;
  onThemeChange: (theme: string) => void;
}

export default function Settings({ onClose, theme, onThemeChange }: SettingsProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [thinkingMode, setThinkingMode] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [routingMode, setRoutingMode] = useState('auto');
  const [localTheme, setLocalTheme] = useState(theme || 'mint');
  const [reactMaxIterations, setReactMaxIterations] = useState(5);
  const [toolMaxRetries, setToolMaxRetries] = useState(5);
  const [showReactSteps, setShowReactSteps] = useState(true);
  const [wikiPath, setWikiPath] = useState('');
  const [wikiSearchMode, setWikiSearchMode] = useState<'keyword' | 'hybrid'>('keyword');
  const [embeddingApiUrl, setEmbeddingApiUrl] = useState('http://127.0.0.1:11434/v1');
  const [embeddingModel, setEmbeddingModel] = useState('bge-m3');
  const [embeddingDimensions, setEmbeddingDimensions] = useState(1024);
  const [vectorStore, setVectorStore] = useState<'sqlite' | 'chroma'>('sqlite');
  const [chromaUrl, setChromaUrl] = useState('http://127.0.0.1:8000');
  const [chromaApiKey, setChromaApiKey] = useState('');
  const [chromaApiKeyMasked, setChromaApiKeyMasked] = useState('');
  const [jev, setJev] = useState<JevFormState>(createEmptyJevFormState);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  useEffect(() => {
    getSettings()
      .then((data: VisibleSettings) => {
        setSystemPrompt(data.systemPrompt || '');
        setThinkingMode(data.thinkingMode || false);
        setMemoryEnabled(data.memoryEnabled || false);
        setRoutingMode(data.routingMode || 'auto');
        setReactMaxIterations(data.reactMaxIterations ?? 5);
        setToolMaxRetries(data.toolMaxRetries ?? 5);
        setShowReactSteps(data.showReactSteps !== false);
        setWikiPath(data.wikiPath || '');
        setWikiSearchMode(data.wikiSearchMode || 'keyword');
        setEmbeddingApiUrl(data.embeddingApiUrl || 'http://127.0.0.1:11434/v1');
        setEmbeddingModel(data.embeddingModel || 'bge-m3');
        setEmbeddingDimensions(data.embeddingDimensions || 1024);
        setVectorStore(data.vectorStore || 'sqlite');
        setChromaUrl(data.chromaUrl || 'http://127.0.0.1:8000');
        setChromaApiKeyMasked(data.chromaApiKeyMasked || '');
        setJev(createJevFormState(data));
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
      });
  }, []);

  useEffect(() => {
    if (localTheme !== theme) {
      onThemeChange(localTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTheme]);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    // Focus first element on open
    requestAnimationFrame(() => {
      const first = modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    });
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const showToast = useCallback((type: string, message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 10000);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        systemPrompt: systemPrompt.trim(),
        thinkingMode,
        memoryEnabled,
        routingMode,
        reactMaxIterations,
        toolMaxRetries,
        showReactSteps,
        wikiPath: wikiPath.trim(),
        wikiSearchMode,
        embeddingApiUrl: embeddingApiUrl.trim(),
        embeddingModel: embeddingModel.trim(),
        embeddingDimensions,
        vectorStore,
        chromaUrl: chromaUrl.trim(),
        ...(chromaApiKey ? { chromaApiKey } : {}),
        ...toJevSettingsInput(jev),
      });
      showToast('success', '设置已保存');
    } catch (err) {
      showToast('error', `Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: '通用设置', icon: 'gear' as const },
    { id: 'endpoints', label: '模型端点', icon: 'server' as const },
    { id: 'mcp', label: 'MCP 服务', icon: 'plugin' as const },
    { id: 'agents', label: 'Agent 管理', icon: 'agent' as const },
    { id: 'skills', label: '技能', icon: 'skill' as const },
    { id: 'bash', label: 'Bash 安全', icon: 'bash' as const },
    { id: 'memories', label: '记忆', icon: 'memory' as const },
    { id: 'wiki', label: '知识库', icon: 'wiki' as const },
    { id: 'experimental', label: '实验性功能', icon: 'flask' as const },
  ];

  const tabIcon: Record<string, React.ReactNode> = {
    gear: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z" />
      </svg>
    ),
    server: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3h16a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zm1 2v4h14V5H5zm-1 8h16a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6a1 1 0 011-1zm1 2v4h14v-4H5z" />
        <circle cx="7" cy="7" r="1" />
        <circle cx="7" cy="17" r="1" />
      </svg>
    ),
    plugin: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 8h-1V6c0-2.76-2.24-5-5-5S8 3.24 8 6v2H6c-1.66 0-3 1.34-3 3v8c0 1.66 1.34 3 3 3h12c1.66 0 3-1.34 3-3v-8c0-1.66-1.34-3-3-3zm-8-2c0-1.1.9-2 2-2s2 .9 2 2v2h-4V6zm8 13c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1v-8c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v8z" />
      </svg>
    ),
    agent: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
      </svg>
    ),
    memory: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z" />
      </svg>
    ),
    skill: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2L12 16.8 6 21.2l2.4-7.2-6-4.8h7.6z" />
      </svg>
    ),
    bash: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3H3v18h1V3zm3 0v18h1V3H7zm4 0v18h1V3h-1zm4 0v18h2V3h-2zm5 0v18h1V3h-1z" />
      </svg>
    ),
    wiki: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6H2v14a2 2 0 002 2h14v-2H4V6zm16-4H8a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm0 14H8V4h12v12zM10 9h8v2h-8V9zm0 4h6v2h-6v2H8v-2h2v-2z" />
      </svg>
    ),
    flask: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 2h6v2h-1v5.17l4.53 7.55A3.5 3.5 0 0115.53 22H8.47a3.5 3.5 0 01-3-5.28L10 9.17V4H9V2zm3 8.28l-4.81 8.01A1.5 1.5 0 008.47 20h7.06a1.5 1.5 0 001.28-2.27L12 10.28zM8.8 16h6.4l1.2 2H7.6l1.2-2z" />
      </svg>
    ),
  };

  return (
    <div className="modal-overlay">
      <Toast toast={toast} />
      <div
        className="modal modal-wide"
        role="dialog"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        <div className="modal-header">
          <h2>设置</h2>
          <button className="modal-close-btn" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-icon">{tabIcon[tab.icon]}</span>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="settings-tab-content">
            {activeTab === 'general' && (
              <GeneralTab
                systemPrompt={systemPrompt}
                setSystemPrompt={setSystemPrompt}
                thinkingMode={thinkingMode}
                setThinkingMode={setThinkingMode}
                memoryEnabled={memoryEnabled}
                setMemoryEnabled={setMemoryEnabled}
                routingMode={routingMode}
                setRoutingMode={setRoutingMode}
                theme={localTheme}
                setTheme={setLocalTheme}
                reactMaxIterations={reactMaxIterations}
                setReactMaxIterations={setReactMaxIterations}
                toolMaxRetries={toolMaxRetries}
                setToolMaxRetries={setToolMaxRetries}
                showReactSteps={showReactSteps}
                setShowReactSteps={setShowReactSteps}
              />
            )}
            {activeTab === 'mcp' && <McpServersPanel onToast={showToast} />}
            {activeTab === 'agents' && <AgentsPanel onToast={showToast} />}
            {activeTab === 'skills' && <SkillsPanel onToast={showToast} />}
            {activeTab === 'bash' && <BashSecurityPanel onToast={showToast} />}
            {activeTab === 'memories' && <MemoriesPanel onToast={showToast} />}
            {activeTab === 'wiki' && (
              <WikiPanel
                wikiPath={wikiPath}
                setWikiPath={setWikiPath}
                wikiSearchMode={wikiSearchMode}
                setWikiSearchMode={setWikiSearchMode}
                embeddingApiUrl={embeddingApiUrl}
                setEmbeddingApiUrl={setEmbeddingApiUrl}
                embeddingModel={embeddingModel}
                setEmbeddingModel={setEmbeddingModel}
                embeddingDimensions={embeddingDimensions}
                setEmbeddingDimensions={setEmbeddingDimensions}
                onToast={showToast}
              />
            )}
            {activeTab === 'endpoints' && <EndpointsPanel onToast={showToast} />}
            {activeTab === 'experimental' && (
              <ExperimentalPanel
                vectorStore={vectorStore}
                setVectorStore={setVectorStore}
                chromaUrl={chromaUrl}
                setChromaUrl={setChromaUrl}
                chromaApiKey={chromaApiKey}
                setChromaApiKey={setChromaApiKey}
                chromaApiKeyMasked={chromaApiKeyMasked}
                jev={jev}
                onJevChange={(patch) => setJev((prev) => ({ ...prev, ...patch }))}
              />
            )}
          </div>
        </div>
        {activeTab !== 'endpoints' &&
          activeTab !== 'mcp' &&
          activeTab !== 'agents' &&
          activeTab !== 'skills' &&
          activeTab !== 'bash' &&
          activeTab !== 'memories' && (
            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>
                取消
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          )}
      </div>
    </div>
  );
}
