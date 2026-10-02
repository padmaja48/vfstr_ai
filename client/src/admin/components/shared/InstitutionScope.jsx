import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Multi-select checklist for assigning colleges to an admin account.
 */
export const InstitutionMultiSelect = ({
  institutions = [],
  value = [],
  onChange,
  disabled = false,
  label = 'Assigned colleges',
}) => {
  const [query, setQuery] = useState('');
  const selected = new Set((value || []).map(String));

  const sorted = useMemo(
    () => [...institutions].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [institutions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((inst) => String(inst.name).toLowerCase().includes(q));
  }, [sorted, query]);

  const toggle = (id) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange?.([...next]);
  };

  const selectAll = () => {
    if (disabled) return;
    onChange?.(sorted.map((inst) => String(inst.id)));
  };

  const clearAll = () => {
    if (disabled) return;
    onChange?.([]);
  };

  if (!institutions.length) {
    return (
      <div className="admin-institution-empty">
        <p className="admin-muted">No colleges yet. Super admins add them on the Institutions page.</p>
        <Link to="/admin/institutions" className="admin-btn admin-btn--primary admin-btn--sm">
          Go to Institutions → Add college
        </Link>
      </div>
    );
  }

  return (
    <fieldset className="admin-institution-multiselect" disabled={disabled}>
      <legend>{label} ({institutions.length} available)</legend>
      <p className="admin-muted admin-institution-multiselect__hint">
        Check every college this admin should access. Unchecked colleges stay hidden from their dashboard.
      </p>
      <div className="admin-institution-multiselect__toolbar">
        <input
          type="search"
          className="admin-institution-multiselect__search"
          placeholder="Search colleges…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search colleges"
        />
        <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={selectAll}>
          Select all
        </button>
        <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={clearAll}>
          Clear all
        </button>
      </div>
      <div className="admin-institution-multiselect__list">
        {filtered.length === 0 ? (
          <p className="admin-muted">No colleges match your search.</p>
        ) : filtered.map((inst) => {
          const id = String(inst.id);
          return (
            <label key={id} className="admin-institution-multiselect__item">
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => toggle(id)}
              />
              <span>{inst.name}</span>
            </label>
          );
        })}
      </div>
      <p className="admin-muted admin-institution-multiselect__count">
        {selected.size} of {institutions.length} selected
      </p>
    </fieldset>
  );
};

/**
 * College filter for college admins with multiple assignments.
 * value: 'all' | institution id string
 */
export const InstitutionScopeFilter = ({
  institutions = [],
  value = 'all',
  onChange,
  label = 'College',
  showAllOption = true,
  allLabel = 'All my colleges',
}) => {
  if (institutions.length <= 1) return null;

  return (
    <label className="admin-scope-filter">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange?.(e.target.value)}>
        {showAllOption ? <option value="all">{allLabel}</option> : null}
        {institutions.map((inst) => (
          <option key={inst.id} value={String(inst.id)}>{inst.name}</option>
        ))}
      </select>
    </label>
  );
};
