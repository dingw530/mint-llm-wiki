import { useState, useCallback, KeyboardEvent } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { Conversation } from '@/types';
import { groupConversationsByDate } from '@/shared/utils/conversationGroups';

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.232 3.41a2.5 2.5 0 113.536 3.536L7.09 18.624a2.5 2.5 0 01-1.11.66l-3.064.766a.5.5 0 01-.612-.612l.766-3.064a2.5 2.5 0 01.66-1.11L15.232 3.41z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 2a1 1 0 00-1 1v1H5a1 1 0 000 2h14a1 1 0 100-2h-4V3a1 1 0 00-1-1h-4zm-3 6a1 1 0 00-1 1v10a2 2 0 002 2h8a2 2 0 002-2V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H14V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H8V9a1 1 0 00-1-1z" />
    </svg>
  );
}

interface ChatSidebarProps {
  conversations: Conversation[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export default function ChatSidebar({
  conversations,
  loading,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: ChatSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{
    variant: 'danger' | 'accent';
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const showConfirm = useCallback(
    (opts: {
      variant: 'danger' | 'accent';
      title: string;
      message: string;
      confirmLabel?: string;
      onConfirm: () => void;
    }) => {
      setConfirmDialog(opts);
    },
    [],
  );

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const submitRename = () => {
    const title = editTitle.trim();
    if (title) onRename(editingId!, title);
    setEditingId(null);
    setEditTitle('');
  };

  const handleRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submitRename();
    else if (e.key === 'Escape') {
      setEditingId(null);
      setEditTitle('');
    }
  };

  const conversationGroups = groupConversationsByDate(conversations);

  return (
    <div className="sidebar-chat-content">
      <div className="conversation-list">
        {loading ? (
          <div className="conversation-list-skeleton">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-sidebar-item">
                <div className="skeleton skeleton-icon" />
                <div className="skeleton skeleton-title" />
              </div>
            ))}
          </div>
        ) : (
          conversations.length === 0 && (
            <div className="empty-state">暂无对话，点击上方按钮新建</div>
          )
        )}
        {conversationGroups.map((group) => (
          <section className="conversation-group" key={group.label}>
            <h3 className="conversation-group-title">{group.label}</h3>
            {group.conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item${conv.id === activeId ? ' active' : ''}`}
                onClick={() => onSelect(conv.id)}
              >
                {editingId === conv.id ? (
                  <input
                    className="title-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={handleRenameKeyDown}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="conv-icon">
                      <ChatIcon />
                    </div>
                    <span className="title">{conv.title}</span>
                    <span className="actions">
                      <button
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(conv);
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          showConfirm({
                            variant: 'danger',
                            title: '删除对话',
                            message: `确定要删除"${conv.title}"吗？`,
                            confirmLabel: '删除',
                            onConfirm: () => onDelete(conv.id),
                          });
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
      {confirmDialog && (
        <ConfirmDialog
          open={!!confirmDialog}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
