import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { createWikiNavigationTool } from '@/services/tools/wikiNavigationTool';

const Settings = lazy(() => import('@/features/settings/components/Settings'));

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

export default function AppProvider() {
  const navigate = useNavigate();
  const wikiNavigationTool = useMemo(() => createWikiNavigationTool(navigate), [navigate]);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    const handleWikiPageRequest = (event: Event): void => {
      const filePath = getWikiPageRequest(event);
      if (filePath) wikiNavigationTool.openPage(filePath);
    };
    window.addEventListener('mint:open-wiki-page', handleWikiPageRequest);
    return () => window.removeEventListener('mint:open-wiki-page', handleWikiPageRequest);
  }, [wikiNavigationTool]);

  useEffect(() => {
    document.documentElement.classList.remove('theme-mint', 'theme-snow', 'theme-anthropic', 'theme-reddot');
    document.documentElement.classList.add(`theme-${theme}`);
    try {
      localStorage.setItem('mint-theme', theme);
    } catch { /* ignore */ }
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
      <Outlet context={{ onOpenSettings: () => setShowSettings(true), openWikiPage: wikiNavigationTool.openPage }} />
      {showSettings && (
        <Suspense fallback={null}>
          <Settings
            onClose={() => { setShowSettings(false); }}
            theme={theme}
            onThemeChange={setTheme}
          />
        </Suspense>
      )}
    </div>
  );
}
