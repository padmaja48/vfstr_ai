import { ADMIN_COLORS } from './adminAuth';

/**
 * Score → color mapping (consistent across admin panel).
 * 80+ → teal-accent, 50–79 → warn (amber), under 50 → danger (red).
 */
export const getScoreColor = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return ADMIN_COLORS.inkMuted;
  if (n >= 80) return ADMIN_COLORS.tealAccent;
  if (n >= 50) return ADMIN_COLORS.warn;
  return ADMIN_COLORS.danger;
};

/**
 * Score → badge tone class suffix for `.admin-score-badge--{tone}`.
 * Matches getScoreColor thresholds: high / mid / low.
 */
export const getScoreTone = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 80) return 'high';
  if (n >= 50) return 'mid';
  return 'low';
};

export default getScoreColor;
