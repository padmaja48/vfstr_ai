import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export const AdminDialog = ({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="admin-overlay" role="presentation" onClick={onClose}>
      <div
        className={`admin-dialog${wide ? ' admin-dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-dialog-head">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="admin-dialog-body">{children}</div>
        {footer ? <div className="admin-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

export const AdminSheet = ({ open, title, subtitle, onClose, children }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="admin-overlay admin-overlay--sheet" role="presentation" onClick={onClose}>
      <aside
        className="admin-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-sheet-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="admin-sheet-body">{children}</div>
      </aside>
    </div>
  );
};

export default AdminDialog;
