import { useEffect, useState } from 'react';
import AppIcon from '@/shared/components/AppIcon';

type UpdateStatus = {
  tone: 'info' | 'success' | 'error';
  message: string;
};

export default function AboutPanel() {
  const [version, setVersion] = useState('读取中…');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setVersion('浏览器预览');
      setStatus({ tone: 'info', message: '更新检查仅支持 Mint 桌面版。' });
      return;
    }

    void electronAPI
      .getAppVersion()
      .then(setVersion)
      .catch(() => setVersion('未知'));
  }, []);

  const checkForUpdates = async (): Promise<void> => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      setStatus({ tone: 'info', message: '更新检查仅支持 Mint 桌面版。' });
      return;
    }

    setChecking(true);
    setStatus({ tone: 'info', message: '正在检查更新…' });
    try {
      const result = await electronAPI.checkForUpdates();
      if (result.status === 'current') {
        setStatus({ tone: 'success', message: '当前已是最新版本。' });
      } else if (result.status === 'available') {
        setStatus({
          tone: 'success',
          message: `发现新版本 ${result.availableVersion || '新版本'}，正在后台下载；下载完成后会显示更新提示。`,
        });
      } else if (result.status === 'disabled') {
        setStatus({ tone: 'info', message: result.message || '当前环境未启用更新源。' });
      } else {
        setStatus({ tone: 'error', message: `检查更新失败：${result.message || '未知错误'}` });
      }
    } catch (error) {
      setStatus({
        tone: 'error',
        message: `检查更新失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="about-panel">
      <div className="about-brand">
        <AppIcon size={48} />
        <div>
          <h3>Mint</h3>
          <p>个人 AI 工作空间</p>
        </div>
      </div>
      <div className="about-version-row">
        <span>当前版本</span>
        <strong>{version}</strong>
      </div>
      <div className="about-update-row">
        <div>
          <h4>软件更新</h4>
          <p>检查可用更新。新版本会在后台下载。</p>
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={() => void checkForUpdates()}
          disabled={checking || !window.electronAPI}
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
      </div>
      {status && (
        <p className={`about-update-status ${status.tone}`} role="status" aria-live="polite">
          {status.message}
        </p>
      )}
    </section>
  );
}
