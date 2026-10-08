import { useState, useEffect } from 'react';
import { getElectronAPI } from '@/services/api/_base';

interface BashSecurityConfig {
  blockedCommands: string[];
  blockedDirs: string[];
}

const electronAPI = getElectronAPI();
const isElectron = !!electronAPI?.isElectron;

interface BashSecurityPanelProps {
  onToast: (type: string, message: string) => void;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 4a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H5a1 1 0 110-2h6V5a1 1 0 011-1z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M10 2a1 1 0 00-1 1v1H5a1 1 0 000 2h14a1 1 0 100-2h-4V3a1 1 0 00-1-1h-4zm-3 6a1 1 0 00-1 1v10a2 2 0 002 2h8a2 2 0 002-2V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H14V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H8V9a1 1 0 00-1-1z" />
    </svg>
  );
}

export default function BashSecurityPanel({ onToast }: BashSecurityPanelProps) {
  const [config, setConfig] = useState<BashSecurityConfig>({ blockedCommands: [], blockedDirs: [] });
  const [loading, setLoading] = useState(true);
  const [newCmd, setNewCmd] = useState('');
  const [newDir, setNewDir] = useState('');

  useEffect(() => {
    Promise.resolve(
      isElectron
        ? electronAPI.getBashSecurity()
        : fetch('/api/bash-security').then(r => r.json())
    ).then((data) => setConfig(data as BashSecurityConfig))
      .catch(() => onToast('error', '加载安全配置失败'))
      .finally(() => setLoading(false));
  }, [onToast]);

  const save = async (updated: BashSecurityConfig) => {
    try {
      if (isElectron) {
        await electronAPI.updateBashSecurity(updated);
      } else {
        await fetch('/api/bash-security', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
      }
      setConfig(updated);
    } catch {
      onToast('error', '保存失败');
    }
  };

  const addCommand = () => {
    const cmd = newCmd.trim();
    if (!cmd) return;
    if (config.blockedCommands.includes(cmd)) {
      onToast('error', '该命令已在黑名单中');
      return;
    }
    save({ ...config, blockedCommands: [...config.blockedCommands, cmd] });
    setNewCmd('');
  };

  const removeCommand = (idx: number) => {
    const updated = config.blockedCommands.filter((_, i) => i !== idx);
    save({ ...config, blockedCommands: updated });
  };

  const addDir = () => {
    const dir = newDir.trim();
    if (!dir) return;
    if (config.blockedDirs.includes(dir)) {
      onToast('error', '该目录已在黑名单中');
      return;
    }
    save({ ...config, blockedDirs: [...config.blockedDirs, dir] });
    setNewDir('');
  };

  const removeDir = (idx: number) => {
    const updated = config.blockedDirs.filter((_, i) => i !== idx);
    save({ ...config, blockedDirs: updated });
  };

  if (loading) {
    return <div className="bash-security-loading">加载中...</div>;
  }

  return (
    <div className="bash-security-panel">
      <div className="bash-security-section">
        <h4 className="settings-subheading">黑名单命令</h4>
        <p className="form-help">添加后，包含这些内容的命令将被禁止执行。支持子串匹配。</p>
        <div className="bash-security-list">
          {config.blockedCommands.length === 0 ? (
            <div className="bash-security-empty">暂无自定义黑名单命令</div>
          ) : (
            config.blockedCommands.map((cmd, i) => (
              <div key={i} className="bash-security-item">
                <code className="bash-security-code">{cmd}</code>
                <button className="bash-security-remove" onClick={() => removeCommand(i)} title="移除">
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="bash-security-add">
          <input
            type="text"
            value={newCmd}
            onChange={(e) => setNewCmd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCommand()}
            placeholder="输入命令关键字，如 rm -rf"
          />
          <button className="bash-security-add-btn" onClick={addCommand} disabled={!newCmd.trim()}>
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="bash-security-section">
        <h4 className="settings-subheading">黑名单目录</h4>
        <p className="form-help">添加后，涉及这些路径的命令将被禁止执行。使用绝对路径。</p>
        <div className="bash-security-list">
          {config.blockedDirs.length === 0 ? (
            <div className="bash-security-empty">暂无自定义黑名单目录</div>
          ) : (
            config.blockedDirs.map((dir, i) => (
              <div key={i} className="bash-security-item">
                <code className="bash-security-code">{dir}</code>
                <button className="bash-security-remove" onClick={() => removeDir(i)} title="移除">
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="bash-security-add">
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDir()}
            placeholder="输入绝对路径，如 /etc"
          />
          <button className="bash-security-add-btn" onClick={addDir} disabled={!newDir.trim()}>
            <PlusIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
