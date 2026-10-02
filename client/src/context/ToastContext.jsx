import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { ToastContainer } from '../components/ToastContainer';

const ToastContext = createContext(null);

let toastSeq = 0;

const noopApi = {
  push: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
  dismiss: () => {},
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, type = 'info', options = {}) => {
    const text = String(message || '').trim();
    if (!text) return null;

    const id = ++toastSeq;
    const duration = options.duration ?? (type === 'error' ? 5600 : 4200);

    setToasts((prev) => {
      // Dedupe identical toasts (StrictMode / double events).
      if (prev.some((toast) => toast.message === text && toast.type === type)) {
        return prev;
      }
      const next = [...prev, { id, message: text, type, className: options.className || '' }];
      return next.slice(-5);
    });

    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration);
    }

    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    push,
    success: (message, options) => push(message, 'success', options),
    error: (message, options) => push(message, 'error', options),
    info: (message, options) => push(message, 'info', options),
    warning: (message, options) => push(message, 'warning', options),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext) || noopApi;

export default ToastContext;
