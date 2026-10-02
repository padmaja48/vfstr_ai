import { ADMIN_COLORS } from './adminAuth';
import { getScoreColor } from './getScoreColor';

/** Shared Recharts tooltip chrome — cream surface, teal accents. */
export const adminChartTooltipStyle = {
  background: ADMIN_COLORS.surface,
  border: `1px solid ${ADMIN_COLORS.creamBorder}`,
  borderRadius: 10,
  boxShadow: '0 8px 20px rgba(31, 42, 39, 0.08)',
  color: ADMIN_COLORS.ink,
  fontSize: 12,
};

export const adminChartAxisTick = {
  fill: ADMIN_COLORS.inkMuted,
  fontSize: 11,
};

export const adminChartGridStroke = ADMIN_COLORS.creamBorder;

export const ADMIN_CHART = {
  primary: ADMIN_COLORS.tealAccent,
  primarySoft: ADMIN_COLORS.tealAccentLight,
  secondary: ADMIN_COLORS.warn,
  muted: ADMIN_COLORS.creamBorder,
  dangerSoft: '#FECACA',
  inkMuted: ADMIN_COLORS.inkMuted,
};

/** Histogram / distribution fill aligned with getScoreColor thresholds. */
export const getScoreBucketFill = (minOrScore) => {
  const n = Number(minOrScore);
  if (!Number.isFinite(n)) return ADMIN_CHART.muted;
  if (n >= 80) return ADMIN_CHART.primary;
  if (n >= 50) return ADMIN_CHART.secondary;
  return ADMIN_CHART.dangerSoft;
};

export { getScoreColor, ADMIN_COLORS };
