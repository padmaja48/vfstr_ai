import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Search } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { DataTable } from '../components/shared/DataTable';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { ScoreRing } from '../components/shared/ScoreRing';
import { useAdminResumes } from '../hooks';
import { getScoreColor } from '@/admin/lib/getScoreColor';

const SCORE_RANGES = [
  { id: 'all', label: 'All scores' },
  { id: '80+', label: '80+' },
  { id: '50-79', label: '50–79' },
  { id: '0-49', label: 'Under 50' },
];

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const matchesScoreRange = (score, rangeId) => {
  if (rangeId === 'all') return true;
  if (rangeId === '80+') return score >= 80;
  if (rangeId === '50-79') return score >= 50 && score < 80;
  if (rangeId === '0-49') return score < 50;
  return true;
};

export const AdminResumeAnalysis = () => {
  const navigate = useNavigate();
  const { resumes, loading, error, refetch } = useAdminResumes();
  const [search, setSearch] = useState('');
  const [scoreRange, setScoreRange] = useState('all');
  const [skillFilter, setSkillFilter] = useState('all');

  const allMissingSkills = useMemo(() => {
    const set = new Set();
    resumes.forEach((r) => (r.missingSkills || []).forEach((s) => set.add(s)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [resumes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resumes.filter((row) => {
      if (!matchesScoreRange(row.resumeScore, scoreRange)) return false;
      if (skillFilter !== 'all' && !(row.missingSkills || []).includes(skillFilter)) return false;
      if (!q) return true;
      return (
        row.studentName.toLowerCase().includes(q)
        || row.studentEmail.toLowerCase().includes(q)
        || row.fileName.toLowerCase().includes(q)
      );
    });
  }, [resumes, search, scoreRange, skillFilter]);

  const columns = useMemo(() => [
    {
      id: 'studentName',
      header: 'Student',
      sortable: true,
      cell: (row) => (
        <div className="admin-user-cell">
          <strong>{row.studentName}</strong>
          <span>{row.studentEmail}</span>
        </div>
      ),
    },
    {
      id: 'fileName',
      header: 'File name',
      sortable: true,
      cell: (row) => <span className="admin-file-name">{row.fileName}</span>,
    },
    {
      id: 'uploadedAt',
      header: 'Uploaded',
      sortable: true,
      accessor: (row) => new Date(row.uploadedAt).getTime(),
      cell: (row) => <span className="admin-table-muted">{formatDate(row.uploadedAt)}</span>,
    },
    {
      id: 'resumeScore',
      header: 'ATS Score',
      sortable: true,
      cell: (row) => (
        <ScoreRing score={row.resumeScore} forceColor="var(--teal-accent)" />
      ),
    },
    {
      id: 'jdMatchScore',
      header: 'JD Match',
      sortable: true,
      accessor: (row) => row.jdMatchScore ?? -1,
      cell: (row) => (
        row.jdMatchScore == null
          ? <span className="admin-table-muted" title="JD match pending backend support">—</span>
          : (
            <span className="admin-score-inline" style={{ color: getScoreColor(row.jdMatchScore) }}>
              {row.jdMatchScore}
            </span>
          )
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/admin/resume-analysis/${row.id}`);
          }}
        >
          <Eye size={14} />
          View detail
        </button>
      ),
    },
  ], [navigate]);

  if (loading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="admin-page admin-resume-page">
        <PageHeader title="Resume Analysis" description="Review uploaded resumes and skill gaps." />
        <AdminQueryError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="admin-page admin-resume-page">
      <PageHeader
        title="Resume Analysis"
        description="Review uploaded resumes, ATS compatibility, and skill gaps."
      />

      <div className="admin-card admin-filter-bar admin-filter-bar--resumes">
        <label className="admin-search" htmlFor="resume-search">
          <Search size={16} aria-hidden="true" />
          <input
            id="resume-search"
            type="search"
            placeholder="Search by student or file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="admin-filter-field">
          <span>Score range</span>
          <select value={scoreRange} onChange={(e) => setScoreRange(e.target.value)}>
            {SCORE_RANGES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-field">
          <span>Missing skill</span>
          <select value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)}>
            <option value="all">Any / none</option>
            {allMissingSkills.map((skill) => (
              <option key={skill} value={skill}>{skill}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-card admin-table-card">
        <DataTable
          columns={columns}
          rows={filtered}
          loading={false}
          pageSize={8}
          emptyMessage="No resumes uploaded yet."
          onRowClick={(row) => navigate(`/admin/resume-analysis/${row.id}`)}
        />
      </div>
    </div>
  );
};

export default AdminResumeAnalysis;
