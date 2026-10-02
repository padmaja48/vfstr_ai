import React from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

/**
 * @param {{ title: string, icon?: React.ComponentType, value: string|number, trend?: { value: string, direction?: 'up'|'down'|'flat' } }} props
 */
export const StatCard = ({ title, icon: Icon, value, trend }) => {
  const direction = trend?.direction || (trend ? 'up' : undefined);
  const TrendIcon = direction === 'down' ? TrendingDown : direction === 'flat' ? Minus : TrendingUp;
  const trendClass =
    direction === 'down'
      ? 'is-down'
      : direction === 'flat'
        ? 'is-flat'
        : 'is-up';

  return (
    <article className="admin-stat-card">
      <div className="admin-stat-card-top">
        <span className="admin-stat-label">{title}</span>
        {Icon ? (
          <span className="admin-stat-icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2} />
          </span>
        ) : null}
      </div>
      <strong className="admin-stat-value">{value}</strong>
      {trend?.value ? (
        <span className={`admin-stat-trend ${trendClass}`}>
          <TrendIcon size={14} strokeWidth={2.25} />
          {trend.value}
        </span>
      ) : null}
    </article>
  );
};
