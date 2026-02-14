import React, { useMemo } from "react";

interface PriceSparklineProps {
  values?: number[];
  width?: number;
  height?: number;
  className?: string;
}

const PriceSparkline = ({ values = [], width = 140, height = 44, className = "" }: PriceSparklineProps) => {
  const { path, isPositive } = useMemo(() => {
    if (!Array.isArray(values) || values.length < 2) {
      return { path: "", isPositive: true };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1e-9);
    const stepX = width / (values.length - 1);
    const d = values
      .map((value, index) => {
        const x = index * stepX;
        const y = height - ((value - min) / range) * height;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return {
      path: d,
      isPositive: values[values.length - 1] >= values[0],
    };
  }, [height, values, width]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="Price sparkline"
    >
      <defs>
        <linearGradient id="launchpad-sparkline" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={isPositive ? "#2dd4bf" : "#f87171"} stopOpacity="0.2" />
          <stop offset="100%" stopColor={isPositive ? "#22d3ee" : "#fb7185"} stopOpacity="1" />
        </linearGradient>
      </defs>
      {path ? (
        <path
          d={path}
          fill="none"
          stroke="url(#launchpad-sparkline)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <rect width={width} height={height} rx="8" fill="rgba(15,23,42,0.5)" />
      )}
    </svg>
  );
};

export default React.memo(PriceSparkline);
