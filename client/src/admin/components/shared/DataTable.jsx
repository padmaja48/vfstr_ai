import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Reusable admin DataTable — sortable, paginated, skeleton-ready.
 * @param {{
 *  columns: Array<{ id: string, header: string, sortable?: boolean, className?: string, accessor?: (row:any)=>any, cell?: (row:any)=>React.ReactNode }>,
 *  rows: any[],
 *  rowKey?: (row:any)=>string,
 *  pageSize?: number,
 *  loading?: boolean,
 *  onRowClick?: (row:any)=>void,
 *  selectable?: boolean,
 *  selectedRowIds?: Set<string>,
 *  onSelectionChange?: (ids:Set<string>)=>void,
 *  serverPagination?: { page:number, totalPages:number, totalCount:number, onPageChange:(page:number)=>void },
 *  emptyMessage?: string,
 * }} props
 */
export const DataTable = ({
  columns,
  rows,
  rowKey = (row) => row.id,
  pageSize = 8,
  loading = false,
  onRowClick,
  selectable = false,
  selectedRowIds = new Set(),
  onSelectionChange,
  serverPagination,
  emptyMessage = 'No rows to show.',
}) => {
  const [sort, setSort] = useState({ id: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const sortedRows = useMemo(() => {
    if (!sort.id) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col) return rows;
    const getVal = (row) => {
      if (col.accessor) return col.accessor(row);
      return row[col.id];
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [rows, sort, columns]);

  const totalPages = serverPagination?.totalPages || Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = serverPagination?.page || Math.min(page, totalPages);
  const pageRows = serverPagination ? sortedRows : sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = selectedRowIds instanceof Set ? selectedRowIds : new Set(selectedRowIds || []);
  const pageIds = pageRows.map((row) => String(rowKey(row)));
  const allPageSelected = selectable && pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleRow = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange?.(next);
  };

  const toggleAll = (checked) => {
    const next = new Set(selected);
    pageIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    onSelectionChange?.(next);
  };

  const toggleSort = (col) => {
    if (!col.sortable) return;
    setPage(1);
    serverPagination?.onPageChange?.(1);
    setSort((prev) => {
      if (prev.id !== col.id) return { id: col.id, dir: 'asc' };
      if (prev.dir === 'asc') return { id: col.id, dir: 'desc' };
      return { id: null, dir: 'asc' };
    });
  };

  if (loading) {
    return (
      <div className="admin-dt admin-dt--loading" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="admin-skel admin-skel--row" />
        ))}
      </div>
    );
  }

  return (
    <div className="admin-dt">
      <div className="admin-table-wrap">
        <table className="admin-table admin-dt-table">
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort.id === col.id;
                const Icon = !col.sortable
                  ? null
                  : active
                    ? (sort.dir === 'asc' ? ArrowUp : ArrowDown)
                    : ArrowUpDown;
                return (
                <th key={col.id} className={col.className}>
                    {col.sortable ? (
                      <button
                        type="button"
                        className={`admin-dt-sort${active ? ' is-active' : ''}`}
                        onClick={() => toggleSort(col)}
                      >
                        <span>{col.header}</span>
                        {Icon ? <Icon size={14} strokeWidth={2.25} aria-hidden="true" /> : null}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {selectable ? (
                <th className="admin-dt-select-cell">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="Select all rows on this page"
                  />
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="admin-dt-empty">{emptyMessage}</td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={onRowClick ? 'is-clickable' : undefined}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={col.id} className={col.className} onClick={(e) => {
                      if (col.id === 'actions') e.stopPropagation();
                    }}>
                      {col.cell ? col.cell(row) : (col.accessor ? col.accessor(row) : row[col.id])}
                    </td>
                  ))}
                  {selectable ? (
                    <td className="admin-dt-select-cell" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(String(rowKey(row)))}
                        onChange={(e) => toggleRow(String(rowKey(row)), e.target.checked)}
                        aria-label={`Select ${row.name || row.email || 'row'}`}
                      />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-dt-footer">
        <span>
          {(serverPagination?.totalCount ?? sortedRows.length) === 0
            ? '0 results'
            : `${(currentPage - 1) * (serverPagination?.limit || pageSize) + 1}–${Math.min(currentPage * (serverPagination?.limit || pageSize), serverPagination?.totalCount ?? sortedRows.length)} of ${serverPagination?.totalCount ?? sortedRows.length}`}
        </span>
        <div className="admin-dt-pager">
          <button
            type="button"
            className="admin-icon-btn"
            disabled={currentPage <= 1}
             onClick={() => serverPagination?.onPageChange?.(Math.max(1, currentPage - 1)) || setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <span>{currentPage} / {totalPages}</span>
          <button
            type="button"
            className="admin-icon-btn"
            disabled={currentPage >= totalPages}
             onClick={() => serverPagination?.onPageChange?.(Math.min(totalPages, currentPage + 1)) || setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataTable;
