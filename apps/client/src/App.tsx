import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { createWikiNavigationTool } from '@/services/tools/wikiNavigationTool';

const Settings = lazy(() => import('@/features/settings/components/Settings'));
type ElectronUpdateNotice = {
  version: string;
  mode: 'local-test' | 'packaged';
};

function getInitialTheme(): string {
  try {
    return localStorage.getItem('mint-theme') || 'mint';
  } catch {
    return 'mint';
  }
}

/** 从来源卡片事件中读取经过校验的 Wiki 路径。 */
function getWikiPageRequest(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== 'object' || !('filePath' in detail)) return null;
  return typeof detail.filePath === 'string' ? detail.filePath : null;
}

/** Read and validate an update notice dispatched by an Electron or browser test event.
 * @param event Browser event carrying an update version.
 * @returns Valid update details, or null when the event payload is invalid.
 */
function getDownloadedUpdate(event: Event): ElectronUpdateNotice | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== 'object' || !('version' in detail)) return null;
  if (typeof detail.version !== 'string') return null;
  return {
    version: detail.version,
    mode: 'mode' in detail && detail.mode === 'local-test' ? 'local-test' : 'packaged',
  };
}

/** Get the storage key for one update source's ignored-version setting.
 * @param update Downloaded update details.
 * @returns A source-specific local storage key.
 */
function getIgnoredUpdateKey(update: ElectronUpdateNotice): string {
  return update.mode === 'local-test'
    ? 'mint-ignored-local-test-update-version'
    : 'mint-ignored-update-version';
}

export default function AppProvider() {
  const navigate = useNavigate();
  const wikiNavigationTool = useMemo(() => createWikiNavigationTool(navigate), [navigate]);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [availableUpdate, setAvailableUpdate] = useState<ElectronUpdateNotice | null>(null);

  useEffect(() => {
    const showUpdate = (update: ElectronUpdateNotice): void => {
      try {
        if (localStorage.getItem(getIgnoredUpdateKey(update)) === update.version) return;
      } catch {
        // Show the prompt for this session when persistent storage is unavailable.
      }
      setAvailableUpdate(update);
    };
    const unsubscribe = window.electronAPI?.onUpdateDownloaded(showUpdate);
    const handleTestUpdateEvent = (event: Event): void => {
      const update = getDownloadedUpdate(event);
      if (update) showUpdate(update);
    };
    window.addEventListener('mint:update-downloaded', handleTestUpdateEvent);
    return () => {
      unsubscribe?.();
      window.removeEventListener('mint:update-downloaded', handleTestUpdateEvent);
    };
  }, []);

  const ignoreUpdate = () => {
    if (!availableUpdate) return;
    try {
      localStorage.setItem(getIgnoredUpdateKey(availableUpdate), availableUpdate.version);
    } catch {
      // The current prompt still closes if persistent storage is unavailable.
    }
    setAvailableUpdate(null);
  };

  const installUpdate = () => {
    if (availableUpdate?.mode === 'local-test') return;
    void window.electronAPI?.installDownloadedUpdate().then((result) => {
      if (result.success) setAvailableUpdate(null);
    });
  };

  useEffect(() => {
    const handleWikiPageRequest = (event: Event): void => {
      const filePath = getWikiPageRequest(event);
      if (filePath) wikiNavigationTool.openPage(filePath);
    };
    window.addEventListener('mint:open-wiki-page', handleWikiPageRequest);
    return () => window.removeEventListener('mint:open-wiki-page', handleWikiPageRequest);
  }, [wikiNavigationTool]);

  useEffect(() => {
    document.documentElement.classList.remove(
      'theme-mint',
      'theme-snow',
      'theme-anthropic',
      'theme-reddot',
    );
    document.documentElement.classList.add(`theme-${theme}`);
    try {
      localStorage.setItem('mint-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (showSettings) {
      prevFocusRef.current = document.activeElement as HTMLElement;
    } else {
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    }
  }, [showSettings]);

  return (
    <div className="app-container">
      {availableUpdate && (
        <div className="update-toast" role="status" aria-live="polite">
          <div className="update-toast__copy">
            <strong>
              Mint {availableUpdate.version}
              {availableUpdate.mode === 'local-test' ? ' 本地测试更新已下载' : ' 更新已下载'}
            </strong>
            <span>
              {availableUpdate.mode === 'local-test'
                ? '开发模式用于调试更新提示，不会安装更新。'
                : '重启应用即可完成更新。'}
            </span>
          </div>
          <div className="update-toast__actions">
            <button
              type="button"
              className="update-toast__install"
              onClick={installUpdate}
              disabled={availableUpdate.mode === 'local-test'}
            >
              {availableUpdate.mode === 'local-test' ? '仅测试提示' : '现在重启'}
            </button>
            <button type="button" className="update-toast__ignore" onClick={ignoreUpdate}>
              忽略此版本
            </button>
          </div>
        </div>
      )}
      <Outlet
        context={{
          onOpenSettings: () => setShowSettings(true),
          openWikiPage: wikiNavigationTool.openPage,
        }}
      />
      {showSettings && (
        <Suspense fallback={null}>
          <Settings
            onClose={() => {
              setShowSettings(false);
            }}
            theme={theme}
            onThemeChange={setTheme}
          />
        </Suspense>
      )}
    </div>
  );
}
