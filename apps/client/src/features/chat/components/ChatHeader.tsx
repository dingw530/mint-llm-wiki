interface ChatHeaderProps {
  title: string;
  activeTab?: 'conversation' | 'trajectory';
  onTabChange?: (tab: 'conversation' | 'trajectory') => void;
}

export default function ChatHeader({
  title,
  activeTab = 'conversation',
  onTabChange = () => undefined,
}: ChatHeaderProps) {
  return (
    <header className="main-header main-header--tabs">
      <h2>{title}</h2>
      <div aria-label="对话视图" className="chat-view-tabs" role="tablist">
        <button
          aria-selected={activeTab === 'conversation'}
          className={activeTab === 'conversation' ? 'is-active' : ''}
          onClick={() => onTabChange('conversation')}
          role="tab"
          type="button"
        >
          对话
        </button>
        <button
          aria-selected={activeTab === 'trajectory'}
          className={activeTab === 'trajectory' ? 'is-active' : ''}
          onClick={() => onTabChange('trajectory')}
          role="tab"
          type="button"
        >
          轨迹
        </button>
      </div>
    </header>
  );
}
