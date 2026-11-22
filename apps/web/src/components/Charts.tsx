import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Metric, SeriesPoint } from "@giga/shared";

const GRID = "rgba(148, 163, 184, 0.12)";
const AXIS = "#7c8a9c";

interface Props {
  kind: string;
  series: SeriesPoint[];
  metric: Metric;
}

export function WidgetChart({ kind, series, metric }: Props) {
  if (kind === "line") {
    return (
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={series} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" hide />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip unit={metric.unit} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#a3e635"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "#a3e635" }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (kind === "radar") {
    return (
      <ResponsiveContainer width="100%" height={190}>
        <RadarChart data={series} outerRadius={72}>
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} />
          <Radar dataKey="value" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.22} />
          <Tooltip content={<ChartTip unit="0–100" />} />
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  if (kind === "scatter") {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey="value" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="number" dataKey="secondary" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip unit={metric.unit} />} />
          <Scatter data={series} fill="#38bdf8" />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart
        data={series}
        layout={kind === "bar" || kind === "stacked" ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        {kind === "bar" || kind === "stacked" ? (
          <>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={78}
              tick={{ fill: AXIS, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
          </>
        )}
        <Tooltip content={<ChartTip unit={metric.unit} />} />
        <Bar dataKey="value" fill="#38bdf8" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <span>{label ?? payload[0]?.payload?.label}</span>
      <b>
        {typeof payload[0].value === "number"
          ? payload[0].value.toFixed(2)
          : payload[0].value}{" "}
        {unit}
      </b>
    </div>
  );
}
