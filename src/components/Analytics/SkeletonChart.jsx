import React from 'react';

export default function SkeletonChart({ height = 250 }) {
  return (
    <div
      className="analytics-skeleton-chart"
      style={{ height }}
      aria-label="Loading chart..."
    >
      <div className="skeleton-shimmer" />
    </div>
  );
}
