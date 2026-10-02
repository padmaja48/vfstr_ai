import React, { useState, useEffect, useCallback } from 'react';
import { interviewAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import { InterviewReportPanel } from './InterviewReportPanel';
import '../styles/Results.css';

const OPEN_REPORT_KEY = 'fluentai_open_report';

export const Results = ({ setCurrentView }) => {
  const toast = useToast();
  const [interviews, setInterviews] = useState([]);
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [interviewReport, setInterviewReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [autoOpenError, setAutoOpenError] = useState('');
  const [lastTriedId, setLastTriedId] = useState('');

  const loadReport = useCallback(async (id, { retries = 0 } = {}) => {
    if (!id) return;
    setLastTriedId(id);
    setReportLoading(true);
    setAutoOpenError('');
    try {
      const res = await interviewAPI.getReport(id);
      setSelectedInterview(res.data.interview);
      setInterviewReport(res.data.report);
      if (!res.data.report && retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return loadReport(id, { retries: retries - 1 });
      }
      if (!res.data.report) {
        const msg = 'Report is still generating. Click Retry in a moment.';
        setAutoOpenError(msg);
        toast.info(msg);
      }
    } catch (err) {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return loadReport(id, { retries: retries - 1 });
      }
      console.error('Failed to load interview report:', err);
      setSelectedInterview(null);
      setInterviewReport(null);
      const msg = err?.response?.data?.message || 'Report is still generating. Click Retry in a moment.';
      setAutoOpenError(msg);
      toast.warning(msg);
    } finally {
      setReportLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await interviewAPI.getUserInterviews();
        if (cancelled) return;
        const list = res.data || [];
        setInterviews(list);

        const openId = localStorage.getItem(OPEN_REPORT_KEY);
        if (openId) {
          localStorage.removeItem(OPEN_REPORT_KEY);
          await loadReport(openId, { retries: 4 });
        } else if (list.length > 0) {
          // Default: open the most recent interview report
          const latest = [...list].sort((a, b) => {
            const aTime = new Date(a.completedAt || a.createdAt || 0).getTime();
            const bTime = new Date(b.completedAt || b.createdAt || 0).getTime();
            return bTime - aTime;
          })[0];
          if (latest?._id) {
            await loadReport(latest._id, { retries: 2 });
          }
        }
      } catch {
        if (!cancelled) setInterviews([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadReport]);

  const handleSelect = useCallback((id) => {
    loadReport(id, { retries: 2 });
  }, [loadReport]);

  if (loading) {
    return (
      <div className="results-page results-page--loading">
        <div className="results-loading-card">
          <span className="results-loading-spinner" aria-hidden="true" />
          <p>Loading your interview reports…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="results-page results-page--pro">
      <header className="results-page-head">
        <p className="results-page-kicker">Performance</p>
        <h1>Interview reports</h1>
        <p>Review scored feedback and practice recommendations from completed sessions.</p>
      </header>
      {autoOpenError && (
        <div className="results-alert" role="status">
          <p>{autoOpenError}</p>
          {lastTriedId ? (
            <button
              type="button"
              className="iv-btn iv-btn--ghost iv-btn--compact"
              onClick={() => loadReport(lastTriedId, { retries: 3 })}
              disabled={reportLoading}
            >
              {reportLoading ? 'Retrying…' : 'Retry'}
            </button>
          ) : null}
        </div>
      )}

      <InterviewReportPanel
        interviews={interviews}
        selectedInterview={selectedInterview}
        report={interviewReport}
        onSelect={handleSelect}
        loading={reportLoading}
        onStartInterview={() => setCurrentView?.('interview')}
      />
    </div>
  );
};
