import { useCallback, useState } from 'react';
import { useToast } from '../../context/ToastContext';

/**
 * Shared loading + toast wrapper for PDF report generation.
 */
export const useReportDownload = () => {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);

  const runReport = useCallback(async (fn, { successMessage = 'Report downloaded.' } = {}) => {
    if (generating) return;
    setGenerating(true);
    try {
      await Promise.resolve(fn());
      // Allow the browser a tick to start the download dialog
      await new Promise((r) => setTimeout(r, 120));
      toast.success(successMessage, { className: 'app-toast--teal' });
    } catch (err) {
      const message = err?.code === 'REPORT_MISSING_DATA'
        ? (err.message || 'Not enough real data to build this report.')
        : (err?.message || 'Report generation failed.');
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }, [generating, toast]);

  return { generating, runReport };
};

export default useReportDownload;
