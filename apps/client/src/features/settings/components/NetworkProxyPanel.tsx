interface NetworkProxyPanelProps {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  configured: boolean;
  proxyUrl: string;
  setProxyUrl: (proxyUrl: string) => void;
  noProxy: string;
  setNoProxy: (noProxy: string) => void;
  clearUrl: boolean;
  setClearUrl: (clearUrl: boolean) => void;
}

export default function NetworkProxyPanel({
  enabled,
  setEnabled,
  configured,
  proxyUrl,
  setProxyUrl,
  noProxy,
  setNoProxy,
  clearUrl,
  setClearUrl,
}: NetworkProxyPanelProps) {
  return (
    <div className="network-proxy-panel">
      <div className="settings-section-intro">
        <h3>网络代理</h3>
        <p>为 Mint 服务端的外部 HTTP 与 HTTPS 请求配置代理。</p>
      </div>
      <div className="form-group">
        <label className="network-proxy-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用服务端代理
        </label>
        <p className="form-help">保存后立即生效。关闭时服务端使用直连。</p>
      </div>
      <div className="form-group">
        <label htmlFor="networkProxyUrl">代理地址</label>
        <input
          id="networkProxyUrl"
          type="text"
          autoComplete="new-password"
          value={proxyUrl}
          onChange={(event) => {
            setProxyUrl(event.target.value);
            setClearUrl(false);
          }}
          placeholder={configured ? '已保存代理地址；输入新地址可替换' : 'http://127.0.0.1:7890'}
        />
        <p className="form-help">
          支持 http/https 代理 URL。地址以明文保存在 Mint 本地设置中，并会在此处显示。
        </p>
      </div>
      {configured && (
        <div className="form-group">
          <label className="network-proxy-toggle">
            <input
              type="checkbox"
              checked={clearUrl}
              onChange={(event) => setClearUrl(event.target.checked)}
            />
            清除已保存的代理地址
          </label>
        </div>
      )}
      <div className="form-group">
        <label htmlFor="networkProxyNoProxy">绕过代理的主机</label>
        <input
          id="networkProxyNoProxy"
          type="text"
          value={noProxy}
          onChange={(event) => setNoProxy(event.target.value)}
          placeholder="localhost,127.0.0.1,::1"
        />
        <p className="form-help">
          用逗号分隔。localhost、127.0.0.1 和 ::1 始终直连，避免本地服务请求绕到代理。
        </p>
      </div>
    </div>
  );
}
