import ReactDOM from 'react-dom/client';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './styles/index.css';

/**
 * Apply the platform marker used by macOS Electron-only surfaces.
 *
 * @param rootElement Document root receiving the platform class.
 * @param electronApi Electron preload capability exposed to the renderer.
 */
export function applyPlatformClass(
  rootElement: HTMLElement,
  electronApi: Pick<NonNullable<Window['electronAPI']>, 'isElectron' | 'platform'> | undefined,
): void {
  const isDarwinElectron = electronApi?.isElectron === true && electronApi.platform === 'darwin';
  rootElement.classList.toggle('platform-darwin-electron', isDarwinElectron);
}

applyPlatformClass(document.documentElement, window.electronAPI);

function BootSplashRemover() {
  useEffect(() => {
    const splash = document.getElementById('boot-splash');
    if (!splash) return;

    splash.classList.add('is-fading');
    const timer = window.setTimeout(() => {
      splash.remove();
    }, 200);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <BootSplashRemover />
    <RouterProvider router={router} />
  </>,
);
