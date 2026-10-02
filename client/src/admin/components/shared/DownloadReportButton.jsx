import React from 'react';
import { Download, Loader2 } from 'lucide-react';

/**
 * Shared download button with in-button loading spinner.
 */
export const DownloadReportButton = ({
  onClick,
  loading = false,
  disabled = false,
  label = 'Download Report',
  loadingLabel = 'Generating…',
  variant = 'primary',
  className = '',
}) => (
  <button
    type="button"
    className={`admin-btn admin-btn--${variant} ${className}`.trim()}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading}
  >
    {loading ? <Loader2 size={15} className="admin-icon-spin" /> : <Download size={15} />}
    {loading ? loadingLabel : label}
  </button>
);

export default DownloadReportButton;
