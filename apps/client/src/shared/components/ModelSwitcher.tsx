import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { activateEndpoint } from '@/services/api';
import type { EndpointOutput } from '@/types';

interface ModelSwitcherProps {
  activeEndpoint: EndpointOutput | null;
  endpoints: EndpointOutput[];
  onEndpointChange: () => Promise<void>;
}

export default function ModelSwitcher({
  activeEndpoint,
  endpoints,
  onEndpointChange,
}: ModelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<Record<string, string | number>>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        right: window.innerWidth - rect.right,
        zIndex: 1000,
      });
    }
  }, [open]);

  const handleSelect = (ep: EndpointOutput) => {
    if (switching) return;
    if (ep.id === activeEndpoint?.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    activateEndpoint(ep.id)
      .then(() => onEndpointChange())
      .then(() => {
        setOpen(false);
      })
      .catch((err) => {
        console.error('Failed to activate endpoint:', err);
      })
      .finally(() => {
        setSwitching(false);
      });
  };

  if (!endpoints || endpoints.length === 0) return null;

  const textEndpoints = endpoints;

  if (textEndpoints.length === 0) return null;

  const displayName = activeEndpoint ? activeEndpoint.name : textEndpoints[0]?.name || '选择模型';

  return (
    <div className="model-switcher">
      <button
        ref={btnRef}
        type="button"
        className="model-switcher-btn"
        onClick={() => setOpen(!open)}
        title={activeEndpoint?.modelId || ''}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 2l1.5 6.5L20 9l-5 4.5 1.5 6.5L12 16l-6.5 4L8 13.5 3 9l6.5-.5L12 2z" />
        </svg>
        <span className="model-switcher-name">{displayName}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="currentColor"
          className={`model-switcher-arrow ${open ? 'open' : ''}`}
        >
          <path d="M6 8L1 3h10z" />
        </svg>
      </button>
      {open &&
        createPortal(
          <>
            <div className="model-switcher-backdrop" onMouseDown={() => setOpen(false)} />
            <div className="model-switcher-dropdown" style={dropdownStyle}>
              {switching && <div className="model-switcher-loading">切换中...</div>}
              {textEndpoints.map((ep) => (
                <button
                  key={ep.id}
                  className={`model-switcher-item ${ep.id === activeEndpoint?.id ? 'active' : ''} ${switching ? 'disabled' : ''}`}
                  onMouseDown={() => {
                    if (!switching) handleSelect(ep);
                  }}
                  disabled={switching}
                  type="button"
                >
                  <span className="model-switcher-check">
                    {ep.id === activeEndpoint?.id ? '✓' : ''}
                  </span>
                  <div className="model-switcher-item-info">
                    <span className="model-switcher-item-name">{ep.name}</span>
                    <span className="model-switcher-item-model">{ep.modelId}</span>
                  </div>
                  {ep.apiType && ep.apiType !== 'openai-chat' && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'var(--accent-subtle)',
                        color: 'var(--accent)',
                        marginLeft: 8,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {ep.apiType === 'anthropic'
                        ? 'Anthropic'
                        : ep.apiType === 'openai-responses'
                          ? 'Responses'
                          : ep.apiType}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
