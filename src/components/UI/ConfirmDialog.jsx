import React, { useCallback, memo } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import Modal from './Modal';

// PERFORMANCE: Wrap in React.memo to prevent unnecessary re-renders
const ConfirmDialog = memo(function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
}) {
  // PERFORMANCE: Memoize handler to avoid recreating on every render
  const handleConfirm = useCallback(() => {
    onConfirm();
    onClose();
  }, [onConfirm, onClose]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div className="confirm-dialog">
        <div className={`confirm-icon ${variant}`}>
          {variant === 'danger' ? (
            <Trash2 size={28} strokeWidth={1.5} />
          ) : (
            <AlertTriangle size={28} strokeWidth={1.5} />
          )}
        </div>
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            {cancelText}
          </button>
          <button
            className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
});

export default ConfirmDialog;
