import * as Select from '@radix-ui/react-select';
import type { Agent } from '@/types';

function AgentIcon({ id }: { id: string }) {
  const icons: Record<string, React.ReactNode> = {
    general: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
        <circle cx="12" cy="11" r="1.5" />
      </svg>
    ),
  };
  const svg = icons[id] || (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2l1.5 6.5L20 9l-5 4.5 1.5 6.5L12 16l-6.5 4L8 13.5 3 9l6.5-.5L12 2z" />
    </svg>
  );
  return <span className="agent-icon">{svg}</span>;
}

interface AgentBarProps {
  agents: Agent[];
  activeAgent: string;
  autoRoutedAgent: string | null;
  lockedAgent: string | null;
  routingMode: string;
  onSelectAgent: (agentId: string) => void;
  onUnlock: () => void;
}

export default function AgentBar({
  agents,
  activeAgent,
  autoRoutedAgent,
  lockedAgent,
  routingMode,
  onSelectAgent,
  onUnlock,
}: AgentBarProps) {
  const availableAgents = agents.filter((agent) => agent.available !== false);
  const selectedAgent = lockedAgent || activeAgent || availableAgents[0]?.id || '';
  const selectedAgentInfo = availableAgents.find((agent) => agent.id === selectedAgent);
  const isAutoRouted = autoRoutedAgent === selectedAgent && !lockedAgent && routingMode === 'auto';

  return (
    <div className="agent-selector">
      <Select.Root
        value={selectedAgent}
        onValueChange={onSelectAgent}
        disabled={Boolean(lockedAgent) || availableAgents.length === 0}
      >
        <div className={`agent-dropdown${lockedAgent ? ' is-locked' : ''}`}>
          <AgentIcon id={selectedAgent} />
          <Select.Trigger
            className="agent-select-trigger"
            aria-label="选择 Agent"
            title={selectedAgentInfo?.description || selectedAgentInfo?.name || selectedAgent}
          >
            <Select.Value>{selectedAgentInfo?.label || selectedAgentInfo?.name || selectedAgent}</Select.Value>
            <Select.Icon className="agent-select-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Select.Icon>
          </Select.Trigger>
          {isAutoRouted && <span className="agent-auto-badge">自动</span>}
          {lockedAgent && (
            <button className="agent-unlock" type="button" onClick={onUnlock} aria-label="解锁 Agent" title="解锁 Agent">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 11V7a4 4 0 017.2-2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <Select.Portal>
          <Select.Content className="agent-select-content" position="popper" sideOffset={6}>
            <Select.Viewport className="agent-select-viewport">
              {availableAgents.map((agent) => (
                <Select.Item key={agent.id} value={agent.id} className="agent-select-item">
                  <Select.ItemText>{agent.label || agent.name || agent.id}</Select.ItemText>
                  <Select.ItemIndicator className="agent-select-indicator">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
