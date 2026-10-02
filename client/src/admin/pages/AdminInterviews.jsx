import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Eye, Radio } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { interviewAPI } from '@/services/api';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../components/shared/PageHeader';
import { DataTable } from '../components/shared/DataTable';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { useAdminInterviews } from '../hooks';
import { getScoreTone } from '@/admin/lib/getScoreColor';
import { ADMIN_COLORS } from '@/admin/lib/adminAuth';

const TABS = [
  { id: 'live', label: 'Live' },
  { id: 'completed', label: 'Completed' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'terminated', label: 'Terminated' },
  { id: 'all', label: 'All History' },
];

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const exportInterviewPdf = (row) => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  let y = margin;
  const line = (text, opts = {}) => {
    const size = opts.size || 11;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(String(text || '—'), 500);
    doc.text(lines, margin, y);
    y += lines.length * (size * 1.35) + (opts.gap || 8);
  };

  doc.setFillColor(ADMIN_COLORS.tealAccent);
  doc.rect(0, 0, 595, 72, 'F');
  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('VFSTR.AI Interview Export', margin, 40);
  doc.setTextColor('#111827');
  y = 100;
  line(`${row.studentName} · ${row.targetCompany}`, { size: 14, bold: true });
  line(`Type: ${row.type} · Score: ${row.score} · Duration: ${row.duration}m · Status: ${row.status}`);
  line(`Date: ${row.date ? formatDate(row.date) : '—'}`);
  line('Questions asked', { size: 13, bold: true, gap: 10 });
  (row.questionsAsked || []).forEach((q, i) => line(`${i + 1}. ${q}`));
  line('Transcript excerpt', { size: 13, bold: true, gap: 10 });
  line(row.transcriptExcerpt);
  line('Strengths', { size: 13, bold: true, gap: 10 });
  (row.aiFeedback?.strengths || ['—']).forEach((s) => line(`• ${s}`));
  line('Improvements', { size: 13, bold: true, gap: 10 });
  (row.aiFeedback?.improvements || ['—']).forEach((s) => line(`• ${s}`));
  doc.save(`VFSTR_AI_${String(row.studentName).replace(/\s+/g, '-')}-${row.id}.pdf`);
};

const elapsedLabel = (row) => {
  const mins = Math.max(1, Number(row.duration) || 1);
  const started = row.date ? new Date(row.date).getTime() : Date.now();
  const elapsedMin = Math.max(0, Math.floor((Date.now() - started) / 60000));
  const show = Math.min(mins, elapsedMin || mins);
  return `${show}:00`;
};

const downloadAdminReportPdf = async (row, toast) => {
  try {
    const res = await interviewAPI.adminReportPdf(row.id);
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `VFSTR_AI_${String(row.studentName).replace(/\s+/g, '-')}-interview-report.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    toast?.success?.('Report PDF downloaded.', { className: 'app-toast--teal' });
  } catch (err) {
    if (row.status === 'completed') {
      exportInterviewPdf(row);
      toast?.info?.('Used summary export — full report PDF was not available.', { duration: 5000 });
      return;
    }
    toast?.error?.(err?.response?.data?.message || err?.message || 'Could not download report PDF.');
  }
};

export const AdminInterviews = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { interviews: rows, loading, error, refetch } = useAdminInterviews();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.type).filter(Boolean))).sort(),
    [rows],
  );

  const companies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.targetCompany).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab === 'live' && row.status !== 'live') return false;
      if (tab === 'completed' && row.status !== 'completed') return false;
      if (tab === 'flagged' && row.status !== 'flagged') return false;
      if (tab === 'terminated' && row.status !== 'terminated') return false;

      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      if (companyFilter !== 'all' && row.targetCompany !== companyFilter) return false;

      if (scoreMin !== '' && Number(row.score) < Number(scoreMin)) return false;
      if (scoreMax !== '' && Number(row.score) > Number(scoreMax)) return false;

      const day = row.date ? String(row.date).slice(0, 10) : '';
      if (dateFrom && day && day < dateFrom) return false;
      if (dateTo && day && day > dateTo) return false;

      if (!q) return true;
      return (
        row.studentName.toLowerCase().includes(q)
        || row.targetCompany.toLowerCase().includes(q)
        || row.type.toLowerCase().includes(q)
      );
    });
  }, [rows, tab, search, typeFilter, companyFilter, scoreMin, scoreMax, dateFrom, dateTo]);

  const liveRows = useMemo(
    () => filtered.filter((r) => r.status === 'live'),
    [filtered],
  );

  const tableRows = useMemo(() => {
    if (tab === 'live') return [];
    return filtered;
  }, [filtered, tab]);

  const columns = [
    {
      id: 'studentName',
      header: 'Student',
      sortable: true,
      cell: (row) => <strong>{row.studentName}</strong>,
    },
    { id: 'targetCompany', header: 'Company', sortable: true },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      cell: (row) => <span className="admin-pill admin-pill--type">{row.type}</span>,
    },
    {
      id: 'score',
      header: 'Score',
      sortable: true,
      cell: (row) => (
        <span className={`admin-score-badge admin-score-badge--${getScoreTone(row.score)}`}>
          {row.score}
        </span>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      sortable: true,
      cell: (row) => `${row.duration}m`,
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <span className={`admin-status-badge admin-status-badge--${row.status}`}>
          {row.status}
        </span>
      ),
    },
    {
      id: 'date',
      header: 'Date',
      sortable: true,
      accessor: (row) => row.date,
      cell: (row) => <span className="admin-table-muted">{row.date ? formatDate(row.date) : '—'}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="admin-row-actions">
          <button
            type="button"
            className="admin-icon-btn"
            title="View detail"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/admin/interviews/${row.id}`);
            }}
          >
            <Eye size={15} />
          </button>
          <button
            type="button"
            className="admin-icon-btn"
            title="Export PDF"
            onClick={(e) => {
              e.stopPropagation();
              if (row.status === 'completed') {
                downloadAdminReportPdf(row, toast);
              } else {
                exportInterviewPdf(row);
              }
            }}
          >
            <Download size={15} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="admin-page admin-interviews-page">
        <PageHeader title="Interviews" description="Monitor live VFSTR.AI sessions and review completed interviews." />
        <AdminQueryError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="admin-page admin-interviews-page">
      <PageHeader
        title="Interviews"
        description="Monitor live sessions and review completed, flagged, terminated, and historical interviews."
      />

      <div className="admin-tabs" role="tablist" aria-label="Interview status">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'live' ? (
              <em className="admin-tab-count">{rows.filter((r) => r.status === 'live').length}</em>
            ) : null}
          </button>
        ))}
      </div>

      <div className="admin-filter-bar admin-card admin-filter-bar--interviews">
        <label className="admin-filter-field admin-filter-field--grow">
          <span>Search</span>
          <input
            type="search"
            placeholder="Student, company, type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="admin-filter-field">
          <span>Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="admin-filter-field">
          <span>Company</span>
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
            <option value="all">All companies</option>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="admin-filter-field">
          <span>Score min</span>
          <input type="number" min="0" max="100" placeholder="0" value={scoreMin} onChange={(e) => setScoreMin(e.target.value)} />
        </label>
        <label className="admin-filter-field">
          <span>Score max</span>
          <input type="number" min="0" max="100" placeholder="100" value={scoreMax} onChange={(e) => setScoreMax(e.target.value)} />
        </label>
        <label className="admin-filter-field">
          <span>From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="admin-filter-field">
          <span>To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {tab === 'live' ? (
        <div className="admin-live-grid">
          {liveRows.length === 0 ? (
            <EmptyState
              compact
              title="No live interviews"
              description="Nothing in progress right now. Completed and flagged sessions are on the other tabs."
            />
          ) : (
            liveRows.map((row) => {
              const qNum = Math.max(1, (row.currentQuestionIndex ?? 0) + 1);
              const totalQ = Math.max(qNum, row.questionsAsked?.length || 5);
              return (
                <button
                  key={row.id}
                  type="button"
                  className="admin-live-card"
                  onClick={() => navigate(`/admin/interviews/${row.id}`)}
                >
                  <div className="admin-live-card-top">
                    <span className="admin-live-indicator">
                      <span className="admin-live-dot" aria-hidden="true" />
                      Live
                    </span>
                    <span className="admin-pill admin-pill--type">{row.type}</span>
                  </div>
                  <h3>{row.studentName}</h3>
                  <p className="admin-live-company">{row.targetCompany}</p>
                  <div className="admin-live-meta">
                    <span><Radio size={14} /> {elapsedLabel(row)} elapsed</span>
                    <span>Q{qNum} of {totalQ}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <div className="admin-card admin-table-card">
          <DataTable
            columns={columns}
            rows={tableRows}
            loading={false}
            onRowClick={(row) => navigate(`/admin/interviews/${row.id}`)}
            emptyMessage="No interviews match these filters."
          />
        </div>
      )}

      {tab !== 'live' && (
        <p className="admin-muted">
          Tip: click a row to open detail · PDF export available from Actions.
          {' '}
          <button type="button" className="admin-text-link" onClick={() => refetch()}>Refresh list</button>
          {' · '}
          <Link className="admin-text-link" to="/admin/interviews">All interviews</Link>
        </p>
      )}
    </div>
  );
};

export default AdminInterviews;
