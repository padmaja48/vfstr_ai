import React from 'react';
import { ADMIN_COLORS } from '@/admin/lib/adminAuth';
import { getScoreColor } from '@/admin/lib/getScoreColor';

/**
 * Interview readiness gauge — cobalt arc on mist track.
 * @param {{ score: number, label?: string, size?: number, className?: string, useScoreColor?: boolean }} props
 */
export const FluentReadinessGauge = ({
  score,
  label = 'Interview readiness',
  size = 200,
  className = '',
  useScoreColor = false,
}) => {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const stroke = 14;
  const padding = stroke / 2 + 2;
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = Math.PI;
  const endAngle = 0;
  const valueAngle = startAngle - (clamped / 100) * Math.PI;

  const polar = (angle) => ({
    x: cx + r * Math.cos(angle),
    y: cy - r * Math.sin(angle),
  });

  const describeArc = (from, to) => {
    if (to >= from) return '';
    const s = polar(from);
    const e = polar(to);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
  };

  const trackPath = describeArc(startAngle, endAngle);
  const valuePath = clamped <= 0 ? '' : describeArc(startAngle, valueAngle);
  const arcColor = useScoreColor ? getScoreColor(clamped) : ADMIN_COLORS.tealAccent;
  const svgHeight = cy + padding;

  return (
    <div className={`admin-gauge ${className}`.trim()} style={{ width: size }}>
      <svg
        width={size}
        height={svgHeight}
        viewBox={`0 0 ${size} ${svgHeight}`}
        role="img"
        aria-label={`${label}: ${clamped}`}
      >
        <path
          d={trackPath}
          fill="none"
          stroke="var(--cream-alt)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {valuePath ? (
          <path
            d={valuePath}
            fill="none"
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <div className="admin-gauge-center">
        <strong style={{ color: arcColor }}>{Math.round(clamped)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
};

export default FluentReadinessGauge;
