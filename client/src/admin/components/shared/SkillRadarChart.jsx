import React from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import { ADMIN_COLORS } from '@/admin/lib/adminAuth';

/**
 * Normalize skill breakdown (or fallback scores) into radar series rows.
 * @param {{ technical?: number, problemSolving?: number, communication?: number, confidence?: number, answerRelevance?: number } | null} breakdown
 * @param {number} [fallbackScore]
 */
export const toSkillRadarData = (breakdown, fallbackScore = 40) => {
  if (breakdown) {
    return [
      { skill: 'Technical', value: breakdown.technical },
      { skill: 'Problem Solving', value: breakdown.problemSolving },
      { skill: 'Communication', value: breakdown.communication },
      { skill: 'Confidence', value: breakdown.confidence },
      { skill: 'Relevance', value: breakdown.answerRelevance },
    ];
  }
  const base = Math.max(20, Math.round(fallbackScore || 40));
  return [
    { skill: 'Technical', value: base },
    { skill: 'Problem Solving', value: Math.max(15, base - 4) },
    { skill: 'Communication', value: Math.min(95, base + 6) },
    { skill: 'Confidence', value: Math.max(18, base - 2) },
    { skill: 'Relevance', value: base },
  ];
};

/**
 * Teal skill radar used in Performance and Users drawer.
 * @param {{ data: Array<{ skill: string, value: number }>, height?: number, className?: string }} props
 */
export const SkillRadarChart = ({
  data,
  height = 280,
  className = '',
  color = ADMIN_COLORS.tealAccent,
  gridStroke = ADMIN_COLORS.creamBorder,
  tickFill = ADMIN_COLORS.inkMuted,
}) => (
  <div className={`admin-radar-wrap ${className}`.trim()}>
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data}>
        <PolarGrid stroke={gridStroke} />
        <PolarAngleAxis dataKey="skill" tick={{ fill: tickFill, fontSize: 11 }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name="Skills"
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.18}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  </div>
);

export default SkillRadarChart;
