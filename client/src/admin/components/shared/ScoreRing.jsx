import React from 'react';
import { getScoreColor } from '@/admin/lib/getScoreColor';

/** Circular score indicator used in resume tables and detail summaries. */
export const ScoreRing = ({ score, size = 44, stroke = 4, forceColor }) => {
  const color = forceColor || getScoreColor(score);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const offset = c - (clamped / 100) * c;

  return (
    <div
      className="admin-score-ring"
      style={{ width: size, height: size }}
      title={`${clamped}`}
      aria-label={`Score ${clamped}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="admin-score-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="admin-score-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="admin-score-ring-label" style={{ color }}>{clamped}</span>
    </div>
  );
};

export default ScoreRing;
