import React, { useId, useMemo } from "react";

interface PriceSparklineProps {
  values?: number[];
  width?: number;
  height?: number;
  className?: string;
}

const PriceSparkline = ({ values = [], width = 140, height = 44, className = "" }: PriceSparklineProps) => {
  const gradientId = useId();

  const { path, isPositive } = useMemo(() => {
    const cleaned = Array.isArray(values)
      ? values
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];

    if (!cleaned.length) return { path: "", isPositive: true };

    // A single point is still useful: draw a flat line so we don't show the placeholder.
    if (cleaned.length === 1) {
      const y = height / 2;
      return { path: `M0,${y.toFixed(2)} L${width.toFixed(2)},${y.toFixed(2)}`, isPositive: true };
    }

    const min = Math.min(...cleaned);
    const max = Math.max(...cleaned);
    const rawRange = max - min;

    // If all values are equal, draw a flat line in the middle (instead of hugging the bottom edge).
    if (rawRange <= 0) {
      const y = height / 2;
      return {
        path: `M0,${y.toFixed(2)} L${width.toFixed(2)},${y.toFixed(2)}`,
        isPositive: cleaned[cleaned.length - 1] >= cleaned[0],
      };
    }

    const range = rawRange;
    const stepX = width / (cleaned.length - 1);
    const d = cleaned
      .map((value, index) => {
        const x = index * stepX;
        const y = height - ((value - min) / range) * height;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    return {
      path: d,
      isPositive: cleaned[cleaned.length - 1] >= cleaned[0],
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
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={isPositive ? "#2dd4bf" : "#f87171"} stopOpacity="0.2" />
          <stop offset="100%" stopColor={isPositive ? "#22d3ee" : "#fb7185"} stopOpacity="1" />
        </linearGradient>
      </defs>
      {path ? (
        <path
          d={path}
          fill="none"
          stroke={`url(#${gradientId})`}
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
