"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ForecastComparisonPoint {
  date: string;
  xgboostOriginal: number;
  xgboostSimulated: number;
  lstmOriginal: number;
  lstmSimulated: number;
  etsOriginal: number;
  etsSimulated: number;
}

interface ForecastComparisonChartProps {
  data: ForecastComparisonPoint[];
}

export function ForecastComparisonChart({
  data,
}: ForecastComparisonChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const series = [
    { key: "xgboostOriginal", name: "XGBoost Original", color: "#2563eb", dash: undefined },
    { key: "xgboostSimulated", name: "XGBoost Simulated", color: "#2563eb", dash: "5 5" },
    { key: "lstmOriginal", name: "LSTM Original", color: "#16a34a", dash: undefined },
    { key: "lstmSimulated", name: "LSTM Simulated", color: "#16a34a", dash: "5 5" },
    { key: "etsOriginal", name: "ETS Original", color: "#9333ea", dash: undefined },
    { key: "etsSimulated", name: "ETS Simulated", color: "#9333ea", dash: "5 5" },
  ] as const;

  const toggleSeries = (entry: { dataKey?: unknown }) => {
    if (typeof entry.dataKey !== "string") return;
    const dataKey = entry.dataKey;
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  return (
    <div className="h-72 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/30" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "currentColor" }}
            className="text-muted-foreground"
            tickFormatter={(value) => String(value).split("-").slice(1).join("/")}
            axisLine={false}
            tickLine={false}
            minTickGap={30}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "currentColor" }}
            className="text-muted-foreground"
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => {
              const numericValue = Number(value);
              return numericValue >= 1000 ? `${(numericValue / 1000).toFixed(1)}k` : String(value);
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
              borderRadius: "8px",
              fontSize: 12,
            }}
          />
          <Legend onClick={toggleSeries} wrapperStyle={{ fontSize: 12, cursor: "pointer" }} />
          {series.map(({ key, name, color, dash }, index) => (
            <Line
              key={key}
              hide={hiddenSeries.has(key)}
              type="monotone"
              dataKey={key}
              name={name}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={dash}
              dot={false}
              activeDot={index === 0 ? { r: 5 } : false}
              isAnimationActive
              animationDuration={800}
              animationBegin={index * 100}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
