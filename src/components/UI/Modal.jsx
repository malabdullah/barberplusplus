import React, { useEffect, useRef, memo } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

// PERFORMANCE: Wrap in React.memo to prevent unnecessary re-renders
const Modal = memo(function Modal({ isOpen, onClose, title, children, size = 'default' }) {
  // PERFORMANCE: Use ref to avoid effect re-running when onClose changes
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]); // PERFORMANCE: Only depend on isOpen, use ref for onClose

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-container ${size} animate-scale-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        <div className="modal-content">
          {children}
        </div>
      </div>
    </div>
  );
});

export default Modal;