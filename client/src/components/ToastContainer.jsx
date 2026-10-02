import React from 'react';
import '../styles/Toast.css';

const ICONS = {
  success: '✓',
  error: '!',
  warning: '!',
  info: 'i',
};

export const ToastContainer = ({ toasts = [], onDismiss }) => {
  if (!toasts.length) return null;

  return (
    <div className="app-toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => {
        const type = toast.type || 'info';
        return (
          <div
            key={toast.id}
            className={`app-toast app-toast--${type}${toast.className ? ` ${toast.className}` : ''}`}
            role={type === 'error' || type === 'warning' ? 'alert' : 'status'}
          >
            <span className="app-toast-icon" aria-hidden="true">
              {ICONS[type] || ICONS.info}
            </span>
            <p className="app-toast-message">{toast.message}</p>
            <button
              type="button"
              className="app-toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => onDismiss?.(toast.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ToastContainer;
