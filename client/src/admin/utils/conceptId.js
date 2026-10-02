/** Resolve Mongo ObjectId string from API rows that may expose `id` or `_id`. */
export const resolveConceptId = (row) => {
  if (!row) return '';
  const raw = row.id ?? row._id;
  if (raw == null || raw === '') return '';
  return String(raw);
};

export const isValidConceptId = (id) => /^[a-f\d]{24}$/i.test(String(id || ''));
