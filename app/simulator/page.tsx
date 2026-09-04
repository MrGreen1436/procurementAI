"use client";

import { useState } from "react";
import { runScenario } from "@/lib/api";
import { ScenarioInput, ScenarioResult } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Package,
  Loader2,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RealtimeStatusBadge } from "@/components/RealtimeStatusBadge";
import { ForecastComparisonChart, ForecastComparisonPoint } from "@/components/ForecastComparisonChart";

/* ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    signDisplay: "always",
  }).format(val);

/* ΓöÇΓöÇΓöÇ Slider ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function ScenarioSlider({
  id,
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const color =
    value > 0
      ? "text-red-500 dark:text-red-400"
      : value < 0
      ? "text-emerald-500 dark:text-emerald-400"
      : "text-muted-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label htmlFor={id} className="text-sm font-semibold">
            {label}
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <span className={cn("text-2xl font-bold tabular-nums min-w-[4rem] text-right", color)}>
          {value > 0 ? "+" : ""}
          {value}%
        </span>
      </div>

      <div className="relative">
        {/* Track background */}
        <div className="relative h-2 rounded-full bg-muted overflow-hidden">
          {/* Zero marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-border z-10"
            style={{ left: `${((0 - min) / (max - min)) * 100}%` }}
          />
          {/* Fill */}
          <div
            className={cn(
              "absolute top-0 bottom-0 rounded-full transition-all",
              value > 0 ? "bg-red-500" : value < 0 ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
            style={
              value >= 0
                ? {
                    left: `${((0 - min) / (max - min)) * 100}%`,
                    width: `${pct - ((0 - min) / (max - min)) * 100}%`,
                  }
                : {
                    left: `${pct}%`,
                    width: `${((0 - min) / (max - min)) * 100 - pct}%`,
                  }
            }
          />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 h-2 cursor-pointer"
        />
        {/* Thumb indicator */}
        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-4 rounded-full border-2 border-background shadow-sm transition-all pointer-events-none",
            value > 0 ? "bg-red-500" : value < 0 ? "bg-emerald-500" : "bg-muted-foreground"
          )}
          style={{ left: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}%</span>
        <span>0%</span>
        <span>+{max}%</span>
      </div>
    </div>
  );
}

/* ΓöÇΓöÇΓöÇ Results Panel ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function ResultsPanel({
  result,
  baseline,
}: {
  result: ScenarioResult;
  baseline: number;
}) {
  const costPositive = result.costImpact > 0;
  const costNeutral = result.costImpact === 0;
  const CostIcon = costPositive ? TrendingUp : costNeutral ? Minus : TrendingDown;

  const chartData: ForecastComparisonPoint[] = [];
  for (const detail of result.skuDetails) {
    const models = [
      ["xgboost", "xgboostOriginal", "xgboostSimulated"],
      ["lstm", "lstmOriginal", "lstmSimulated"],
      ["ets", "etsOriginal", "etsSimulated"],
    ] as const;
    for (const [model, originalKey, simulatedKey] of models) {
      const original = detail.baselineForecasts?.[model] ?? [];
      const simulated = detail.simulatedForecasts?.[model] ?? [];
      original.forEach((point, index) => {
        const current = chartData[index] ?? {
          date: point.date,
          xgboostOriginal: 0,
          xgboostSimulated: 0,
          lstmOriginal: 0,
          lstmSimulated: 0,
          etsOriginal: 0,
          etsSimulated: 0,
        };
        current[originalKey] += point.value;
        current[simulatedKey] += simulated[index]?.value ?? 0;
        chartData[index] = current;
      });
    }
  }

  return (
    <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      <h2 className="text-lg font-semibold">Scenario Results</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Stockout count */}
        <Card className={cn("border-t-4", result.newStockoutCount > 0 ? "border-t-red-500" : "border-t-emerald-500")}>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Projected Stockouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-4xl font-bold tabular-nums", result.newStockoutCount > 0 ? "text-red-500" : "text-emerald-500")}>
              {result.newStockoutCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {result.newStockoutCount > baseline ? (
                <span className="text-red-500">
                  Γû▓ {result.newStockoutCount - baseline} more than current
                </span>
              ) : result.newStockoutCount < baseline ? (
                <span className="text-emerald-500">
                  Γû╝ {baseline - result.newStockoutCount} fewer than current
                </span>
              ) : (
                <span>No change from current</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cost impact */}
        <Card className={cn("border-t-4", costPositive ? "border-t-red-500" : costNeutral ? "border-t-muted" : "border-t-emerald-500")}>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Cost Impact
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold tabular-nums flex items-center gap-1.5",
              costPositive ? "text-red-500" : costNeutral ? "text-muted-foreground" : "text-emerald-500"
            )}>
              <CostIcon className="h-6 w-6 shrink-0" />
              {formatCurrency(result.costImpact)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {costPositive ? "Additional spend required" : costNeutral ? "No cost change" : "Potential savings"}
            </div>
          </CardContent>
        </Card>

        {/* Affected SKUs count */}
        <Card className="border-t-4 border-t-amber-500">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Affected SKUs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tabular-nums text-amber-500">
              {result.affectedSkus.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              SKUs at elevated risk
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Affected SKU list */}
      {result.affectedSkus.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Affected SKUs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {result.affectedSkus.map((sku) => (
                <div
                  key={sku}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium"
                >
                  <Package className="h-3 w-3" />
                  {sku}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          No additional SKUs affected under this scenario
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Forecast Comparison</h2>
        <Card className="shadow-sm">
          <CardContent>
            <ForecastComparisonChart data={chartData} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ΓöÇΓöÇΓöÇ Page ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
const DEFAULT_INPUT: ScenarioInput = {
  leadTimeVariabilityPct: 0,
  demandIncreasePct: 0,
};

export default function SimulatorPage() {
  const [input, setInput] = useState<ScenarioInput>(DEFAULT_INPUT);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setHasRun(true);
    setError(null);
    try {
      const res = await runScenario(input);
      setResult(res);
    } catch {
      setResult(null);
      setError("Unable to run the backend scenario. Start the FastAPI service and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setInput(DEFAULT_INPUT);
    setResult(null);
    setHasRun(false);
    setError(null);
  };

  const isDirty =
    input.leadTimeVariabilityPct !== DEFAULT_INPUT.leadTimeVariabilityPct ||
    input.demandIncreasePct !== DEFAULT_INPUT.demandIncreasePct;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">What-If Simulator</h1>
            <RealtimeStatusBadge />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Model supply chain disruptions and see their projected impact before they happen
          </p>
        </div>
      </div>

      {/* Sliders card */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Scenario Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          <ScenarioSlider
            id="lead-time"
            label="Lead Time Variability"
            description="Adjust expected supplier lead time vs. baseline"
            value={input.leadTimeVariabilityPct}
            min={-20}
            max={50}
            onChange={(v) =>
              setInput((prev) => ({ ...prev, leadTimeVariabilityPct: v }))
            }
          />
          <ScenarioSlider
            id="demand-increase"
            label="Demand Increase"
            description="Shift in projected end-customer demand vs. forecast"
            value={input.demandIncreasePct}
            min={-20}
            max={50}
            onChange={(v) =>
              setInput((prev) => ({ ...prev, demandIncreasePct: v }))
            }
          />

          {/* Current values summary */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm">
            <span className="text-muted-foreground">Scenario:</span>
            <span>
              Lead time{" "}
              <span className={cn("font-semibold", input.leadTimeVariabilityPct > 0 ? "text-red-500" : input.leadTimeVariabilityPct < 0 ? "text-emerald-500" : "")}>
                {input.leadTimeVariabilityPct > 0 ? "+" : ""}{input.leadTimeVariabilityPct}%
              </span>
            </span>
            <span className="text-muted-foreground">┬╖</span>
            <span>
              Demand{" "}
              <span className={cn("font-semibold", input.demandIncreasePct > 0 ? "text-red-500" : input.demandIncreasePct < 0 ? "text-emerald-500" : "")}>
                {input.demandIncreasePct > 0 ? "+" : ""}{input.demandIncreasePct}%
              </span>
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              id="run-scenario-btn"
              type="button"
              onClick={handleRun}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-semibold py-2.5 px-5 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> RunningΓÇª
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Run Scenario
                </>
              )}
            </button>
            {(isDirty || hasRun) && (
              <button
                type="button"
                onClick={handleReset}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card hover:bg-muted text-sm font-medium py-2.5 px-4 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Running scenario modelΓÇª</span>
        </div>
      )}

      {!loading && result && (
        <ResultsPanel result={result} baseline={6} />
      )}

      {!loading && error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !result && !hasRun && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border border-dashed rounded-xl">
          <Play className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Adjust the sliders above and click Run Scenario</p>
          <p className="text-xs mt-1 opacity-60">Results will appear here</p>
        </div>
      )}
    </div>
  );
}
