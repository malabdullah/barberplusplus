import React, { memo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

const AnalyticsMetricCard = memo(function AnalyticsMetricCard({
  icon: Icon,
  label,
  value,
  trend,
  subValue,
  color = 'accent',
  delay = 0
}) {
  return (
    <div
      className={`analytics-metric-card animate-fade-in-up stagger-${delay}`}
    >
      <div className="analytics-metric-header">
        <div className={`analytics-metric-icon ${color}`}>
          <Icon size={22} strokeWidth={1.5} />
        </div>
        {trend !== undefined && trend !== null && (
          <div className={`analytics-metric-trend ${trend >= 0 ? 'positive' : 'negative'}`}>
            {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <div className="analytics-metric-value">{value}</div>
      <div className="analytics-metric-label">{label}</div>
      {subValue && <div className="analytics-metric-sub">{subValue}</div>}
    </div>
  );
});

export default AnalyticsMetricCard;
