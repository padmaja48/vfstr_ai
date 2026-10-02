import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Clock, Filter, Search, X } from 'lucide-react';
import {
  COMPANY_TIER_LABELS,
  COMPANY_TIER_ORDER,
  NO_SPECIFIC_COMPANY_OPTION,
} from '../../lib/companyOptions';

const MAX_RECENT_COMPANIES = 6;
const OPEN_ANIMATION_MS = 150;

const normalizeQuery = (value) => String(value || '').trim().toLowerCase();

const dedupeRecentValues = (values = []) => Array.from(new Set(values.filter(Boolean))).slice(0, MAX_RECENT_COMPANIES);

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const highlightLabel = (label, query) => {
  const term = normalizeQuery(query);
  if (!term) return label;

  const matcher = new RegExp(`(${escapeRegex(term)})`, 'ig');
  const segments = String(label).split(matcher);

  return segments.map((segment, index) => {
    if (!segment) return null;
    const isMatch = segment.toLowerCase() === term;
    return isMatch ? (
      <mark key={`${segment}-${index}`} className="iv-company-selector__match">
        {segment}
      </mark>
    ) : (
      <span key={`${segment}-${index}`}>{segment}</span>
    );
  });
};

const CompanyRow = ({ option, selected, active, query, onSelect, itemKey }) => (
  <button
    type="button"
    className={[
      'iv-company-selector__row',
      selected ? 'iv-company-selector__row--selected' : '',
      active ? 'iv-company-selector__row--active' : '',
    ].join(' ').trim()}
    data-company-key={itemKey}
    onClick={() => onSelect(option)}
  >
    <span className="iv-company-selector__row-main">
      <span className="iv-company-selector__row-label">{highlightLabel(option.label, query)}</span>
    </span>
    {selected ? <Check size={16} strokeWidth={2.5} /> : null}
  </button>
);

const CompanySelectorDropdown = ({
  id = 'target-company',
  label = 'Target Company',
  value = '',
  onChange,
  options = [],
  recentValues = [],
  onRecentValuesChange,
  onOpenChange,
  disabled = false,
  placeholder = 'No specific company',
}) => {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const closeTimerRef = useRef(null);

  const optionMap = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const selectedOption = optionMap.get(value) || NO_SPECIFIC_COMPANY_OPTION;
  const recentOptions = useMemo(
    () => dedupeRecentValues(recentValues)
      .map((recentValue) => optionMap.get(recentValue))
      .filter((option) => option && (tierFilter === 'all' || option.tier === tierFilter)),
    [recentValues, optionMap, tierFilter],
  );

  const filteredOptions = useMemo(() => {
    const term = normalizeQuery(query);
    return options.filter((option) => {
      const matchesQuery = !term || option.label.toLowerCase().includes(term);
      const matchesTier = tierFilter === 'all' || option.tier === tierFilter;
      return matchesQuery && matchesTier;
    });
  }, [options, query, tierFilter]);

  const tierFilters = useMemo(
    () => [
      { value: 'all', label: 'All companies', shortLabel: 'All', count: options.length },
      ...COMPANY_TIER_ORDER.map((tier) => ({
        value: tier,
        label: COMPANY_TIER_LABELS[tier],
        shortLabel: COMPANY_TIER_LABELS[tier].replace('PRODUCT BASED', 'PRODUCT'),
        count: options.filter((option) => option.tier === tier).length,
      })),
    ],
    [options],
  );

  const groupedOptions = useMemo(
    () => COMPANY_TIER_ORDER
      .map((tier) => ({
        tier,
        options: filteredOptions.filter((option) => option.tier === tier),
      }))
      .filter((group) => group.options.length > 0),
    [filteredOptions],
  );

  const showGroupedSections = tierFilter === 'all';

  const showDefaultRow = normalizeQuery(query).length === 0;
  const showRecents = showDefaultRow && recentOptions.length > 0;
  const displayItems = useMemo(() => {
    const items = [];
    if (showDefaultRow) {
      items.push({ key: '', type: 'default', option: NO_SPECIFIC_COMPANY_OPTION });
    }
    if (showRecents) {
      recentOptions.forEach((option) => {
        items.push({ key: `recent:${option.value}`, type: 'recent', option });
      });
    }
    if (showGroupedSections) {
      groupedOptions.forEach((group) => {
        items.push({ key: `header:${group.tier}`, type: 'header', tier: group.tier });
        group.options.forEach((option) => {
          items.push({ key: option.value, type: 'option', option, tier: group.tier });
        });
      });
    } else {
      filteredOptions.forEach((option) => {
        items.push({ key: option.value, type: 'option', option, tier: option.tier });
      });
    }
    return items;
  }, [filteredOptions, groupedOptions, recentOptions, showDefaultRow, showGroupedSections, showRecents]);

  const selectableItems = useMemo(
    () => displayItems.filter((item) => item.type === 'default' || item.type === 'recent' || item.type === 'option'),
    [displayItems],
  );

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      const clickedInside = rootRef.current?.contains(event.target);
      if (!clickedInside) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      window.requestAnimationFrame(() => setVisible(true));
      onOpenChange?.(true);
      return;
    }

    setVisible(false);
    onOpenChange?.(false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      setQuery('');
      setTierFilter('all');
      setActiveIndex(0);
    }, OPEN_ANIMATION_MS);
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex((currentIndex) => {
      const selectedIndex = selectableItems.findIndex((item) => item.option.value === value);
      if (selectedIndex >= 0) return selectedIndex;
      return Math.min(currentIndex, Math.max(0, selectableItems.length - 1));
    });
  }, [open, query, selectableItems, value]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    });
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
  };

  const handleSelect = (option) => {
    onChange?.(option?.value || '', option || NO_SPECIFIC_COMPANY_OPTION);
    if (option?.value) {
      const nextRecentValues = [option.value, ...recentValues.filter((item) => item !== option.value)]
        .slice(0, MAX_RECENT_COMPANIES);
      onRecentValuesChange?.(nextRecentValues);
    }
    closeMenu();
  };

  const handleClearRecents = () => {
    onRecentValuesChange?.([]);
  };

  const handleKeyDown = (event) => {
    if (!selectableItems.length) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        inputRef.current?.blur();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % selectableItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + selectableItems.length) % selectableItems.length);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(selectableItems.length - 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const currentItem = selectableItems[activeIndex] || selectableItems[0];
      if (currentItem?.option) handleSelect(currentItem.option);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      inputRef.current?.blur();
    }
  };

  const syncScrollFades = (element) => {
    if (!element) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    setFadeTop(scrollTop > 6);
    setFadeBottom(scrollHeight - clientHeight - scrollTop > 6);
  };

  useEffect(() => {
    if (!open) return;
    const element = resultsRef.current;
    if (!element) return;

    syncScrollFades(element);
    const activeItem = selectableItems[activeIndex];
    const activeRow = activeItem?.key
      ? Array.from(element.querySelectorAll('[data-company-key]')).find(
        (row) => row.getAttribute('data-company-key') === activeItem.key,
      )
      : null;
    activeRow?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open, selectableItems]);

  useEffect(() => {
    if (!open) return;
    const element = resultsRef.current;
    if (!element) return;

    const handleScroll = () => syncScrollFades(element);
    handleScroll();
    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => element.removeEventListener('scroll', handleScroll);
  }, [open, query, groupedOptions, showRecents]);

  const emptyQuery = normalizeQuery(query);
  const hasMatches = displayItems.some((item) => item.type !== 'header');

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const panel = mounted ? (
    <div
      className={`iv-company-selector__panel${visible ? ' iv-company-selector__panel--visible' : ''}`}
      id={`${id}-panel`}
      role="dialog"
      aria-labelledby={`${id}-label`}
    >
      <div className="iv-company-selector__search-shell">
        <Search size={16} className="iv-company-selector__search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="iv-company-selector__search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search companies"
          aria-label="Search companies"
        />
        {query ? (
          <button
            type="button"
            className="iv-company-selector__clear-search"
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="iv-company-selector__filters" role="group" aria-label="Filter companies by category">
        <div className="iv-company-selector__filters-label">
          <Filter size={14} aria-hidden="true" />
          <span>Filter</span>
        </div>
        <div className="iv-company-selector__filter-list" role="radiogroup" aria-label="Company category">
          {tierFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="radio"
              aria-checked={tierFilter === filter.value}
              className={`iv-company-selector__filter${tierFilter === filter.value ? ' iv-company-selector__filter--active' : ''}`}
              onClick={() => {
                setTierFilter(filter.value);
                setActiveIndex(0);
              }}
              aria-label={`${filter.label}: ${filter.count} companies`}
              title={`${filter.label} (${filter.count})`}
            >
              <span>{filter.shortLabel}</span>
              <span className="iv-company-selector__filter-count">{filter.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div ref={resultsRef} className={`iv-company-selector__results${fadeTop ? ' iv-company-selector__results--fade-top' : ''}${fadeBottom ? ' iv-company-selector__results--fade-bottom' : ''}`} role="listbox" aria-label="Company options">
        {showDefaultRow ? (
          <>
            <CompanyRow
              option={NO_SPECIFIC_COMPANY_OPTION}
              selected={value === ''}
              active={selectableItems[activeIndex]?.key === ''}
              query={query}
              itemKey=""
              onSelect={handleSelect}
            />
            <div className="iv-company-selector__divider" />
          </>
        ) : null}

        {showRecents ? (
          <section className="iv-company-selector__section">
            <div className="iv-company-selector__section-head iv-company-selector__section-head--sticky">
              <div className="iv-company-selector__section-title">
                <Clock size={14} />
                <span>Recent searches</span>
              </div>
              <button type="button" className="iv-company-selector__clear-recents" onClick={handleClearRecents}>
                Clear
              </button>
            </div>
            <div className="iv-company-selector__section-list">
              {recentOptions.map((option) => {
                const itemKey = `recent:${option.value}`;
                return (
                  <CompanyRow
                    key={option.value}
                    option={option}
                    selected={option.value === value}
                    active={selectableItems[activeIndex]?.key === itemKey}
                    query={query}
                    itemKey={itemKey}
                    onSelect={handleSelect}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        {showGroupedSections && groupedOptions.length > 0 ? (
          groupedOptions.map((group) => (
            <section key={group.tier} className="iv-company-selector__section">
              <div className="iv-company-selector__section-head iv-company-selector__section-head--sticky iv-company-selector__section-title--tier">
                <span>{COMPANY_TIER_LABELS[group.tier]}</span>
              </div>
              <div className="iv-company-selector__section-list">
                {group.options.map((option) => {
                  const itemKey = option.value;
                  return (
                    <CompanyRow
                      key={option.value}
                      option={option}
                      selected={option.value === value}
                      active={selectableItems[activeIndex]?.key === itemKey}
                      query={query}
                      itemKey={itemKey}
                      onSelect={handleSelect}
                    />
                  );
                })}
              </div>
            </section>
          ))
        ) : null}

        {!showGroupedSections && filteredOptions.length > 0 ? (
          <section className="iv-company-selector__section">
            <div className="iv-company-selector__section-list">
              {filteredOptions.map((option) => {
                const itemKey = option.value;
                return (
                  <CompanyRow
                    key={option.value}
                    option={option}
                    selected={option.value === value}
                    active={selectableItems[activeIndex]?.key === itemKey}
                    query={query}
                    itemKey={itemKey}
                    onSelect={handleSelect}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        {!hasMatches ? (
          <div className="iv-company-selector__empty">
            {emptyQuery
              ? `No companies in ${COMPANY_TIER_LABELS[tierFilter] || 'this category'}.`
              : `No companies match '${query.trim()}'.`}
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={`iv-company-selector${open ? ' iv-company-selector--open' : ''}`} ref={rootRef}>
      <span className="iv-label" id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={buttonRef}
        id={id}
        className={`iv-company-selector__control${open ? ' iv-company-selector__control--open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={`${id}-label ${id}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="iv-company-selector__control-value">{selectedOption.label || placeholder}</span>
        <ChevronDown size={16} className={`iv-company-selector__chevron${open ? ' iv-company-selector__chevron--open' : ''}`} />
      </button>
      {panel}
    </div>
  );
};

export default CompanySelectorDropdown;
