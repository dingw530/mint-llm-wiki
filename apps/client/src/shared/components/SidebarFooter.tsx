import { useState, useCallback } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 2a1 1 0 00-1 1v1H5a1 1 0 000 2h14a1 1 0 100-2h-4V3a1 1 0 00-1-1h-4zm-3 6a1 1 0 00-1 1v10a2 2 0 002 2h8a2 2 0 002-2V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H14V9a1 1 0 10-2 0v10h-.5V9a1 1 0 10-2 0v10H8V9a1 1 0 00-1-1z" />
    </svg>
  );
}

interface SidebarFooterProps {
  showClear?: boolean;
  onClearAll?: () => void;
}

export default function SidebarFooter({ showClear, onClearAll }: SidebarFooterProps) {
  const [confirmDialog, setConfirmDialog] = useState<{
    variant: 'danger' | 'accent';
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const showConfirm = useCallback((opts: {
    variant: 'danger' | 'accent';
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }) => {
    setConfirmDialog(opts);
  }, []);

  return (
    <>
      <div className="sidebar-footer">
        {showClear && onClearAll && (
          <button
            className="sidebar-clear-btn"
            onClick={() => {
              showConfirm({
                variant: 'danger',
                title: '清空全部对话',
                message: '确定要清空所有对话记录吗？',
                confirmLabel: '清空全部',
                onConfirm: onClearAll,
              });
            }}
          >
            <TrashIcon />
            清空全部
          </button>
        )}
      </div>
      {confirmDialog && (
        <ConfirmDialog
          open={!!confirmDialog}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </>
  );
}
