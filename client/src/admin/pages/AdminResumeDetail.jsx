import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Lightbulb, TriangleAlert } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { StatCard } from '../components/shared/StatCard';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { ScoreRing } from '../components/shared/ScoreRing';
import { useAdminResume } from '../hooks';
import { getScoreColor, getScoreTone } from '@/admin/lib/getScoreColor';

const buildSuggestions = (resume) => {
  const tips = [];
  (resume.missingSkills || []).forEach((skill) => {
    tips.push(`Add a concrete proof point for “${skill}” (project, coursework, or internship bullet).`);
  });
  (resume.strengths || []).slice(0, 2).forEach((s) => {
    tips.push(`Keep highlighting: ${s}`);
  });
  (resume.suggestedQuestions || []).slice(0, 2).forEach((q) => {
    tips.push(`Practice answering: ${q}`);
  });
  if (resume.atsScore < 70) {
    tips.push('Use a single-column layout, standard headings, and avoid tables/graphics for ATS.');
  }
  if (!tips.length) {
    tips.push('Resume looks strong — keep a tailored version per company and refresh metrics quarterly.');
  }
  return tips.slice(0, 8);
};

export const AdminResumeDetail = () => {
  const { id } = useParams();
  const { data: resume, loading, error, refetch } = useAdminResume(id);

  const suggestions = useMemo(
    () => (resume ? buildSuggestions(resume) : []),
    [resume],
  );

  if (loading) return <PageSkeleton variant="form" />;
  if (error) {
    return (
      <div className="admin-page">
        <AdminQueryError error={error} onRetry={refetch} title="Could not load resume" />
      </div>
    );
  }
  if (!resume) {
    return (
      <div className="admin-page">
        <EmptyState
          icon={FileText}
          title="Resume not found"
          description="That resume id was not found on the server."
          action={(
            <Link to="/admin/resume-analysis" className="admin-btn admin-btn--primary">
              Back to resumes
            </Link>
          )}
        />
      </div>
    );
  }

  return (
    <div className="admin-page admin-resume-detail">
      <div className="admin-detail-top">
        <Link to="/admin/resume-analysis" className="admin-text-link admin-back-link">
          <ArrowLeft size={16} />
          Back to resumes
        </Link>
      </div>

      <PageHeader
        title={resume.studentName || 'Resume detail'}
        description={`${resume.fileName} · uploaded ${resume.uploadedAt ? new Date(resume.uploadedAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }) : '—'}`}
      />

      <div className="admin-stat-row admin-stat-row--3 admin-resume-score-row">
        <section className="admin-card admin-resume-score-card">
          <p className="admin-resume-score-label">Resume Score</p>
          <div className="admin-resume-score-body">
            <ScoreRing score={resume.resumeScore} size={72} stroke={6} />
            <div>
              <strong style={{ color: getScoreColor(resume.resumeScore) }}>{resume.resumeScore}/100</strong>
              <span className="admin-muted">Overall resume quality</span>
            </div>
          </div>
        </section>
        <StatCard
          title="ATS Compatibility"
          value={(
            <span className={`admin-score-badge admin-score-badge--${getScoreTone(resume.atsScore)}`}>
              {resume.atsScore}
            </span>
          )}
          trend={{ value: 'From resume analysis score', direction: 'flat' }}
        />
        <StatCard
          title="JD Match"
          value={(
            resume.jdMatchScore == null
              ? '—'
              : (
                <span style={{ color: getScoreColor(resume.jdMatchScore) }}>
                  {resume.jdMatchScore}
                </span>
              )
          )}
          trend={{ value: 'Pending dedicated JD-match field', direction: 'flat' }}
        />
      </div>

      {resume.summary ? (
        <section className="admin-card">
          <h3 className="admin-section-title">Summary</h3>
          <p>{resume.summary}</p>
        </section>
      ) : null}

      <div className="admin-resume-detail-grid">
        <section className="admin-card">
          <h3 className="admin-section-title">Skills</h3>
          {(resume.skills || []).length === 0 ? (
            <p className="admin-muted">No skills extracted.</p>
          ) : (
            <div className="admin-chip-row">
              {resume.skills.map((skill) => (
                <span key={skill} className="admin-chip">{skill}</span>
              ))}
            </div>
          )}
        </section>

        <section className="admin-card">
          <h3 className="admin-section-title">
            <TriangleAlert size={16} />
            Gaps / weak areas
          </h3>
          {(resume.missingSkills || []).length === 0 ? (
            <p className="admin-muted">No critical skill gaps flagged.</p>
          ) : (
            <div className="admin-chip-row">
              {resume.missingSkills.map((skill) => (
                <span key={skill} className="admin-chip admin-chip--amber">{skill}</span>
              ))}
            </div>
          )}
        </section>

        <section className="admin-card admin-resume-detail-span">
          <h3 className="admin-section-title">
            <Lightbulb size={16} />
            Suggested improvements
          </h3>
          <ol className="admin-improve-list">
            {suggestions.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
};

export default AdminResumeDetail;
