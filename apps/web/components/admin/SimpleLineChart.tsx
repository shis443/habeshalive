"use client";

import styles from "./SimpleLineChart.module.css";

export interface ChartSeries {
  label: string;
  color: string;
  points: { x: string; y: number }[];
}

const WIDTH = 640;
const HEIGHT = 200;
const PADDING = { top: 12, right: 12, bottom: 24, left: 44 };

// Hand-rolled SVG, not a charting library — none is in this app's
// dependencies, and this is exactly the kind of simple line chart that
// doesn't need one. No dependency added, per the standing ground rule.
export function SimpleLineChart({ series, valueFormatter }: { series: ChartSeries[]; valueFormatter?: (v: number) => string }) {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return <p className={styles.empty}>No data for this period yet.</p>;
  }

  const maxY = Math.max(1, ...allPoints.map((p) => p.y));
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const pointCount = series[0]?.points.length ?? 1;
  const xStep = pointCount > 1 ? plotWidth / (pointCount - 1) : 0;

  function toX(i: number): number {
    return PADDING.left + i * xStep;
  }
  function toY(v: number): number {
    return PADDING.top + plotHeight - (v / maxY) * plotHeight;
  }

  const format = valueFormatter ?? ((v: number) => String(v));
  const xLabelEvery = Math.max(1, Math.ceil(pointCount / 6));

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Chart">
        {/* Y-axis gridlines + labels, 4 bands */}
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (maxY / 4) * i;
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={PADDING.left} y1={y} x2={WIDTH - PADDING.right} y2={y} stroke="var(--outline-variant)" strokeWidth={1} opacity={0.5} />
              <text x={PADDING.left - 6} y={y + 3} textAnchor="end" className={styles.axisLabel}>
                {format(Math.round(v))}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {series[0]?.points.map((p, i) =>
          i % xLabelEvery === 0 ? (
            <text key={p.x} x={toX(i)} y={HEIGHT - 6} textAnchor="middle" className={styles.axisLabel}>
              {p.x.slice(5)}
            </text>
          ) : null
        )}

        {/* One polyline per series */}
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            points={s.points.map((p, i) => `${toX(i)},${toY(p.y)}`).join(" ")}
          />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
        {series.map((s) => (
          <span key={s.label} style={{ fontSize: 11, color: "var(--on-surface-variant)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 2, background: s.color, display: "inline-block" }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
