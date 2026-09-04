"use client";

import React, { useState } from "react";
import { SupplierRiskItem } from "@/types";
import { ShieldAlert, ShieldCheck, AlertCircle, Search, ArrowUpDown, Filter } from "lucide-react";

interface SupplierRiskPanelProps {
  suppliers: SupplierRiskItem[];
  isLoading?: boolean;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function SupplierRiskPanel({ suppliers, isLoading = false }: SupplierRiskPanelProps) {
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"risk" | "amount" | "anomaly">("risk");

  const filtered = suppliers
    .filter((s) => {
      if (filter !== "all" && s.label !== filter) return false;
      if (searchQuery.trim() === "") return true;
      const query = searchQuery.toLowerCase();
      return (
        s.supplier_name.toLowerCase().includes(query) ||
        s.supplier_id.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (sortBy === "risk") {
        return (b.risk_score ?? 0) - (a.risk_score ?? 0);
      }
      if (sortBy === "amount") {
        return (b.avg_amount ?? 0) - (a.avg_amount ?? 0);
      }
      return (b.anomaly_rate ?? 0) - (a.anomaly_rate ?? 0);
    });

  const getTrafficColor = (label: string) => {
    switch (label) {
      case "red":
        return {
          bg: "bg-[#F0455C]/10",
          text: "text-[#F0455C]",
          border: "border-[#F0455C]/30",
          dot: "bg-[#F0455C]",
          bar: "#F0455C",
          title: "Critical Risk",
        };
      case "yellow":
        return {
          bg: "bg-[#FBBF24]/10",
          text: "text-[#FBBF24]",
          border: "border-[#FBBF24]/30",
          dot: "bg-[#FBBF24]",
          bar: "#FBBF24",
          title: "Guarded Risk",
        };
      case "green":
      default:
        return {
          bg: "bg-[#34D399]/10",
          text: "text-[#34D399]",
          border: "border-[#34D399]/30",
          dot: "bg-[#34D399]",
          bar: "#34D399",
          title: "Healthy",
        };
    }
  };

  return (
    <div className="rounded-xl bg-[#14151F] border border-[#262838] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#262838]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold font-heading text-[#F5F1E8] tracking-tight">
              Supplier Risk Intelligence
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#1C1E2B] text-[#8B87A0] border border-[#262838]">
              {suppliers.length} monitored
            </span>
          </div>
          <p className="text-xs text-[#8B87A0] mt-1">
            Predictive composite scoring based on anomaly frequency, order variance, and disruption history
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8B87A0]" />
            <input
              type="text"
              placeholder="Filter suppliers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs bg-[#1C1E2B] text-[#F5F1E8] placeholder:text-[#8B87A0] rounded-lg border border-[#262838] focus:outline-none focus:border-[#FFB627]/50 transition-colors w-40 sm:w-48"
            />
          </div>

          {/* Risk severity tabs */}
          <div className="flex bg-[#1C1E2B] p-0.5 rounded-lg border border-[#262838] text-xs">
            {(["all", "red", "yellow", "green"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilter(lvl)}
                className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                  filter === lvl
                    ? "bg-[#262838] text-[#F5F1E8] shadow-sm"
                    : "text-[#8B87A0] hover:text-[#F5F1E8]"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-1 text-xs text-[#8B87A0] bg-[#1C1E2B] px-2.5 py-1 rounded-lg border border-[#262838]">
            <ArrowUpDown className="w-3 h-3 text-[#FFB627]" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-[#F5F1E8] focus:outline-none cursor-pointer text-xs"
            >
              <option value="risk" className="bg-[#1C1E2B]">Risk Score</option>
              <option value="anomaly" className="bg-[#1C1E2B]">Anomaly Rate</option>
              <option value="amount" className="bg-[#1C1E2B]">Avg Amount</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid of Depth-Stacked Supplier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pt-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-lg bg-[#1C1E2B]/50 animate-pulse border border-[#262838]"
            />
          ))
        ) : filtered.length === 0 ? (
          <div className="col-span-full py-10 text-center text-sm text-[#8B87A0]">
            No suppliers found matching current filters.
          </div>
        ) : (
          filtered.map((supplier) => {
            const riskLabel = supplier.label === "insufficient_data" ? "green" : supplier.label;
            const colors = getTrafficColor(riskLabel);
            const scoreDisplay =
              supplier.risk_score !== null
                ? Math.round(supplier.risk_score > 1 ? supplier.risk_score : supplier.risk_score * 100)
                : "--";

            return (
              <div
                key={supplier.supplier_id}
                data-risk={riskLabel}
                className="supplier-card relative rounded-lg bg-[#1C1E2B]/90 border border-[#262838] p-4 flex flex-col justify-between hover:border-[#FFB627]/30 transition-all duration-200"
              >
                {/* Top Row: Name + Severity badge */}
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <h3 className="text-sm font-semibold text-[#F5F1E8] font-heading line-clamp-1">
                        {supplier.supplier_name || supplier.supplier_id}
                      </h3>
                      <span className="text-[11px] text-[#8B87A0] font-mono">
                        {supplier.supplier_id}
                      </span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} animate-pulse`} />
                      {colors.title}
                    </span>
                  </div>

                  {/* Quantitative Stats Row */}
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[#262838]/80 text-xs">
                    <div>
                      <div className="text-[10px] text-[#8B87A0] uppercase">Risk Score</div>
                      <div className="text-base font-bold font-heading text-[#F5F1E8] mt-0.5">
                        {scoreDisplay}
                        <span className="text-[10px] font-normal text-[#8B87A0]">/100</span>
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-[#8B87A0] uppercase">Anomaly Rate</div>
                      <div
                        className={`text-sm font-bold font-heading mt-0.5 ${
                          supplier.anomaly_rate > 0.15 ? "text-[#FF6B35]" : "text-[#F5F1E8]"
                        }`}
                      >
                        {(supplier.anomaly_rate * 100).toFixed(1)}%
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-[#8B87A0] uppercase">Avg Order</div>
                      <div className="text-sm font-bold font-heading text-[#F5F1E8] mt-0.5 truncate">
                        {formatCurrency(supplier.avg_amount)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress bar representing risk intensity */}
                <div className="mt-3.5 pt-2 border-t border-[#262838]/50 flex items-center justify-between text-[11px] text-[#8B87A0]">
                  <span>Sampling: {supplier.n_rows ?? 80} orders</span>
                  <div className="w-20 h-1.5 bg-[#0A0B10] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${typeof scoreDisplay === "number" ? scoreDisplay : 20}%`,
                        backgroundColor: colors.bar,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
