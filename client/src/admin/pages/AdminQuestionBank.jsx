import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Pencil, Plus, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { DataTable } from '../components/shared/DataTable';
import { AdminDialog } from '../components/shared/AdminDialog';
import { PageSkeleton } from '../components/shared/PageSkeleton';
import { EmptyState } from '../components/shared/EmptyState';
import { AdminQueryError } from '../components/shared/PendingBackendState';
import { adminQuestionsService } from '../services/adminApi';
import { AdminQuestionConceptsPanel } from './AdminQuestionConceptsPanel';
import { AdminConceptGenerationPanel } from './AdminConceptGenerationPanel';
import { useToast } from '../../context/ToastContext';

const CATEGORIES = [
  'Company-specific',
  'Technical',
  'HR',
  'Coding',
  'Aptitude',
  'Behavioral',
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const CREATED_BY = ['admin', 'ai', 'migrated'];
const STATUSES = ['active', 'archived'];

const emptyForm = () => ({
  text: '',
  category: 'Technical',
  difficulty: 'Medium',
  company: '',
  tags: '',
});

const truncate = (value, max = 120) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const AdminQuestionBank = () => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('questions');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState([]);
  const [difficulty, setDifficulty] = useState('all');
  const [createdBy, setCreatedBy] = useState('all');
  const [status, setStatus] = useState('active');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState(null);
  const [editorForm, setEditorForm] = useState(emptyForm());
  const [editorHistory, setEditorHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    roleTopic: '',
    company: '',
    category: 'Technical',
    difficulty: 'Medium',
    count: 5,
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState([]);
  const [selectedGenerated, setSelectedGenerated] = useState(new Set());
  const [savingGenerated, setSavingGenerated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminQuestionsService.list({
        page,
        limit: 20,
        search: search || undefined,
        category: categories.length === 1 ? categories[0] : undefined,
        difficulty: difficulty !== 'all' ? difficulty : undefined,
        createdBy: createdBy !== 'all' ? createdBy : undefined,
        status: status !== 'all' ? status : 'all',
      });
      setQuestions(payload.questions || []);
      setPagination(payload.pagination || null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, categories, difficulty, createdBy, status]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (categories.length <= 1) return questions;
    return questions.filter((row) => categories.includes(row.category));
  }, [questions, categories]);

  const toggleCategory = (category) => {
    setCategories((prev) => (
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    ));
    setPage(1);
  };

  const openCreate = () => {
    setEditorTarget(null);
    setEditorForm(emptyForm());
    setEditorHistory([]);
    setEditorOpen(true);
  };

  const openEdit = async (row) => {
    setEditorTarget(row);
    setEditorForm({
      text: row.text,
      category: row.category,
      difficulty: row.difficulty,
      company: row.company || '',
      tags: (row.tags || []).join(', '),
    });
    setEditorHistory([]);
    setEditorOpen(true);
    try {
      const detail = await adminQuestionsService.get(row.id);
      setEditorHistory(detail.editHistory || []);
    } catch {
      // History is optional in the dialog.
    }
  };

  const submitEditor = async () => {
    if (!editorForm.text.trim() || editorForm.text.trim().length < 8) {
      toast.error('Question text must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        text: editorForm.text.trim(),
        category: editorForm.category,
        difficulty: editorForm.difficulty,
        company: editorForm.company.trim() || undefined,
        tags: editorForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      };
      if (editorTarget) {
        const result = await adminQuestionsService.update(editorTarget.id, payload);
        if (result.duplicateWarnings?.length) {
          toast.warn('Updated, but a similar question already exists in the bank.');
        } else {
          toast.success('Question updated.', { className: 'app-toast--teal' });
        }
      } else {
        const result = await adminQuestionsService.create(payload);
        if (result.duplicateWarnings?.length) {
          toast.warn('Created, but a similar question already exists in the bank.');
        } else {
          toast.success('Question created.', { className: 'app-toast--teal' });
        }
      }
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not save question.');
    } finally {
      setSaving(false);
    }
  };

  const archiveQuestion = async (row) => {
    try {
      await adminQuestionsService.archive(row.id);
      toast.success('Question archived.');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not archive question.');
    }
  };

  const runGenerate = async () => {
    if (!generateForm.roleTopic.trim()) {
      toast.error('Role/topic is required for AI generation.');
      return;
    }
    setGenerating(true);
    setGenerated([]);
    setSelectedGenerated(new Set());
    try {
      const payload = await adminQuestionsService.generate({
        roleTopic: generateForm.roleTopic.trim(),
        company: generateForm.company.trim() || undefined,
        category: generateForm.category,
        difficulty: generateForm.difficulty,
        count: generateForm.count,
      });
      setGenerated(payload.questions || []);
      setSelectedGenerated(new Set((payload.questions || []).map((_, index) => index)));
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'AI generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const saveGenerated = async () => {
    const selected = generated.filter((_, index) => selectedGenerated.has(index));
    if (!selected.length) {
      toast.error('Select at least one generated question to save.');
      return;
    }
    setSavingGenerated(true);
    try {
      const result = await adminQuestionsService.bulkCreate({
        questions: selected.map((item) => ({
          text: item.text,
          category: item.category || generateForm.category,
          difficulty: item.difficulty || generateForm.difficulty,
          company: item.company || generateForm.company || undefined,
          tags: item.tags || [],
          createdBy: 'ai',
        })),
      });
      if (result.warnings?.length) {
        toast.warn(`Saved ${result.created?.length || 0} questions with duplicate warnings.`);
      } else {
        toast.success(`Saved ${result.created?.length || 0} questions.`, { className: 'app-toast--teal' });
      }
      setGenerateOpen(false);
      setGenerated([]);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not save generated questions.');
    } finally {
      setSavingGenerated(false);
    }
  };

  const columns = useMemo(() => [
    {
      id: 'text',
      header: 'Question',
      accessor: (row) => row.text,
      cell: (row) => <span title={row.text}>{truncate(row.text)}</span>,
    },
    {
      id: 'category',
      header: 'Category',
      cell: (row) => <span className="admin-pill">{row.category}</span>,
    },
    {
      id: 'difficulty',
      header: 'Difficulty',
      cell: (row) => <span className="admin-pill admin-pill--muted">{row.difficulty}</span>,
    },
    {
      id: 'company',
      header: 'Company',
      accessor: (row) => row.company || '—',
    },
    {
      id: 'usageCount',
      header: 'Usage',
      sortable: true,
    },
    {
      id: 'createdBy',
      header: 'Created by',
      cell: (row) => row.createdBy,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span className={`admin-pill admin-pill-status--${row.status === 'active' ? 'active' : 'deactivated'}`}>
          {row.status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="admin-row-actions">
          <button type="button" className="admin-icon-btn" title="Edit" onClick={() => openEdit(row)}>
            <Pencil size={15} />
          </button>
          {row.status === 'active' ? (
            <button type="button" className="admin-icon-btn admin-icon-btn--danger" title="Archive" onClick={() => archiveQuestion(row)}>
              <Archive size={15} />
            </button>
          ) : null}
        </div>
      ),
    },
  ], []);

  if (loading && !questions.length) return <PageSkeleton rows={8} />;
  if (error) {
    return (
      <div className="admin-page">
        <PageHeader title="Question Bank" description="Curate company and role-specific interview questions." />
        <AdminQueryError error={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="admin-page admin-question-bank-page">
      <PageHeader
        title="Question Bank"
        description="Manage full-text questions and company concept pools. Concepts are topic labels — AI generates fresh wording when students interview."
        actions={activeTab === 'questions' ? (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGenerateOpen(true)}>
              <Sparkles size={15} /> Generate with AI
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
              <Plus size={15} /> Add Question
            </button>
          </>
        ) : null}
      />

      <div className="admin-tabs admin-tabs--inline" role="tablist">
        <button
          type="button"
          role="tab"
          className={`admin-tab${activeTab === 'questions' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('questions')}
        >
          Full-text questions
        </button>
        <button
          type="button"
          role="tab"
          className={`admin-tab${activeTab === 'concepts' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('concepts')}
        >
          Company concepts
        </button>
        <button
          type="button"
          role="tab"
          className={`admin-tab${activeTab === 'generation' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('generation')}
        >
          Starter generation
        </button>
      </div>

      {activeTab === 'generation' ? <AdminConceptGenerationPanel /> : activeTab === 'concepts' ? <AdminQuestionConceptsPanel /> : (
      <div className="admin-qb-layout">
        <aside className="admin-card admin-qb-filters">
          <h3>Filters</h3>
          <label className="admin-filter-field admin-filter-field--grow">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search question text…"
            />
          </label>

          <div className="admin-qb-filter-group">
            <strong>Category</strong>
            {CATEGORIES.map((category) => (
              <label key={category} className="admin-check-row">
                <input
                  type="checkbox"
                  checked={categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                />
                <span>{category}</span>
              </label>
            ))}
          </div>

          <label className="admin-filter-field">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              {DIFFICULTIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Created by</span>
            <select value={createdBy} onChange={(e) => { setCreatedBy(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              {CREATED_BY.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label className="admin-filter-field">
            <span>Status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              <option value="all">all</option>
            </select>
          </label>
        </aside>

        <div className="admin-card admin-table-card admin-qb-table">
          {filteredRows.length === 0 ? (
            <EmptyState title="No questions found" description="Adjust filters or add questions to populate the bank." />
          ) : (
            <>
              <DataTable columns={columns} rows={filteredRows} emptyMessage="No questions found." />
              {pagination ? (
                <div className="admin-pagination" style={{ padding: '0 1.25rem 1.25rem' }}>
                  <button type="button" className="admin-btn admin-btn--ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <span className="admin-muted">Page {pagination.page} of {pagination.totalPages} · {pagination.total} questions</span>
                  <button type="button" className="admin-btn admin-btn--ghost" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      )}

      <AdminDialog
        open={editorOpen}
        title={editorTarget ? 'Edit question' : 'Add question'}
        description="Questions saved here are used by the live interview flow."
        wide
        onClose={() => setEditorOpen(false)}
        footer={(
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setEditorOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={saving} onClick={submitEditor}>
              {saving ? 'Saving…' : editorTarget ? 'Save changes' : 'Create question'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label className="admin-form-span">
            <span>Question text</span>
            <textarea rows={5} value={editorForm.text} onChange={(e) => setEditorForm((prev) => ({ ...prev, text: e.target.value }))} />
          </label>
          <label>
            <span>Category</span>
            <select value={editorForm.category} onChange={(e) => setEditorForm((prev) => ({ ...prev, category: e.target.value }))}>
              {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Difficulty</span>
            <select value={editorForm.difficulty} onChange={(e) => setEditorForm((prev) => ({ ...prev, difficulty: e.target.value }))}>
              {DIFFICULTIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Company (optional)</span>
            <input value={editorForm.company} onChange={(e) => setEditorForm((prev) => ({ ...prev, company: e.target.value }))} />
          </label>
          <label className="admin-form-span">
            <span>Tags (comma-separated)</span>
            <input value={editorForm.tags} onChange={(e) => setEditorForm((prev) => ({ ...prev, tags: e.target.value }))} />
          </label>
        </div>
        {editorHistory.length > 0 ? (
          <div className="admin-qb-history">
            <h4>Edit history</h4>
            <ul>
              {editorHistory.map((entry, index) => (
                <li key={index}>
                  <strong>{entry.editedAt ? new Date(entry.editedAt).toLocaleString() : 'Previous version'}</strong>
                  <p>{entry.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </AdminDialog>

      <AdminDialog
        open={generateOpen}
        title="Generate with AI"
        description="Preview questions from the platform AI provider. Nothing is saved until you confirm."
        wide
        onClose={() => setGenerateOpen(false)}
        footer={generated.length ? (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGenerateOpen(false)}>Close</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={savingGenerated} onClick={saveGenerated}>
              {savingGenerated ? 'Saving…' : 'Save selected'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="admin-btn admin-btn--ghost" onClick={() => setGenerateOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn admin-btn--primary" disabled={generating} onClick={runGenerate}>
              {generating ? 'Generating…' : 'Generate preview'}
            </button>
          </>
        )}
      >
        <div className="admin-form-grid">
          <label className="admin-form-span">
            <span>Role / topic</span>
            <input value={generateForm.roleTopic} onChange={(e) => setGenerateForm((prev) => ({ ...prev, roleTopic: e.target.value }))} placeholder="Software Engineer — data structures" />
          </label>
          <label>
            <span>Company (optional)</span>
            <input value={generateForm.company} onChange={(e) => setGenerateForm((prev) => ({ ...prev, company: e.target.value }))} />
          </label>
          <label>
            <span>Category</span>
            <select value={generateForm.category} onChange={(e) => setGenerateForm((prev) => ({ ...prev, category: e.target.value }))}>
              {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Difficulty</span>
            <select value={generateForm.difficulty} onChange={(e) => setGenerateForm((prev) => ({ ...prev, difficulty: e.target.value }))}>
              {DIFFICULTIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="admin-form-span">
            <span>Count ({generateForm.count})</span>
            <input
              type="range"
              min={1}
              max={10}
              value={generateForm.count}
              onChange={(e) => setGenerateForm((prev) => ({ ...prev, count: Number(e.target.value) }))}
            />
          </label>
        </div>

        {generated.length > 0 ? (
          <div className="admin-qb-generated">
            <h4>Generated preview</h4>
            {generated.map((item, index) => (
              <label key={index} className="admin-qb-generated-item">
                <input
                  type="checkbox"
                  checked={selectedGenerated.has(index)}
                  onChange={(e) => {
                    setSelectedGenerated((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(index);
                      else next.delete(index);
                      return next;
                    });
                  }}
                />
                <div>
                  <p>{item.text}</p>
                  {item.duplicateWarnings?.length ? (
                    <em className="admin-qb-dup-warn">
                      Similar to existing: {item.duplicateWarnings.map((dup) => truncate(dup.text, 60)).join('; ')}
                    </em>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
        ) : null}
      </AdminDialog>
    </div>
  );
};

export default AdminQuestionBank;
