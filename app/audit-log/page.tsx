"use client";

import React, { useEffect, useState, useMemo } from "react";
import { fetchAuditLogs } from "@/lib/api";
import { AuditLogEntry } from "@/types";
import { AuditTrailPanel } from "@/components/AuditTrailPanel";
import {
  Shield,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Users,
  Cpu,
  Phone,
  FileText,
  Filter,
} from "lucide-react";
import Link from "next/link";

// ── Filter options ────────────────────────────────────────────────────────────
const ACTOR_FILTERS = [
  { value: "all",       label: "All Actors",          icon: Users },
  { value: "human",     label: "Procurement Officer",  icon: Users },
  { value: "automated", label: "Automated / AI",       icon: Cpu },
] as const;

const ACTION_FILTERS = [
  { value: "all",      label: "All Actions" },
  { value: "po",       label: "PO Events" },
  { value: "anomaly",  label: "Anomaly Reviews" },
  { value: "calls",    label: "Supplier Calls" },
  { value: "transfer", label: "Transfers" },
] as const;

const ACTION_GROUPS: Record<string, string[]> = {
  po:       ["po.auto_created", "po.llm_created", "po.fallback_created", "po.approved", "po.rejected"],
  anomaly:  ["anomaly.approved", "anomaly.rejected"],
  calls:    ["automated_supplier_call_triggered", "automated_supplier_call_failed", "periodic_price_refresh_call"],
  transfer: ["transfer.recommended"],
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const loadData = () => {
    setLoading(true);
    fetchAuditLogs().then((data) => {
      setLogs(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadData();
  }, []);

  // ── Derived stats (always from full unfiltered logs) ──────────────────────
  const totalEvents     = logs.length;
  const humanCount      = logs.filter((l) => l.actorType === "human").length;
  const autonomousCount = logs.filter((l) => l.actorType === "automated").length;
  const callCount       = logs.filter((l) =>
    ["automated_supplier_call_triggered", "automated_supplier_call_failed", "periodic_price_refresh_call"].includes(l.action)
  ).length;

  // ── Filtered logs for the panel (filtering done here, passed down) ─────────
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (actorFilter !== "all") {
      result = result.filter((l) =>
        actorFilter === "human"
          ? l.actorType === "human" || l.actor.toLowerCase().includes("officer")
          : l.actorType === "automated" || !(l.actor.toLowerCase().includes("officer"))
      );
    }

    if (actionFilter !== "all") {
      const allowed = ACTION_GROUPS[actionFilter] ?? [];
      result = result.filter((l) => allowed.includes(l.action));
    }

    return result;
  }, [logs, actorFilter, actionFilter]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-[#8B87A0] hover:text-[#FFB627] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          </div>
          <h1 className="text-3xl font-bold font-heading text-[#F5F1E8] tracking-tight flex items-center gap-3">
            <Shield className="w-8 h-8 text-[#FFB627]" />
            Audit &amp; Decision Governance Log
          </h1>
          <p className="text-sm text-[#8B87A0] mt-1">
            Complete provenance trail for AI-driven purchase orders, price anomaly flags, supplier call triggers, and officer overrides.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1C1E2B] hover:bg-[#262838] border border-[#262838] text-xs font-semibold text-[#F5F1E8] transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#FFB627]" : ""}`} />
          Refresh Logs
        </button>
      </div>

      {/* KPI mini-strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Recorded Events</div>
          <div className="text-2xl font-bold font-heading text-[#F5F1E8] mt-1">{totalEvents}</div>
          <div className="text-[11px] text-[#7DD3C0] mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> 100% Provenance
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Human Authorizations</div>
          <div className="text-2xl font-bold font-heading text-[#FFB627] mt-1">{humanCount}</div>
          <div className="text-[11px] text-[#8B87A0] mt-1">Officer approvals &amp; reviews</div>
        </div>

        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Autonomous Actions</div>
          <div className="text-2xl font-bold font-heading text-[#7DD3C0] mt-1">{autonomousCount}</div>
          <div className="text-[11px] text-[#8B87A0] mt-1">Gemini-LLM &amp; Decision Engine</div>
        </div>

        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Supplier Call Triggers</div>
          <div className="text-2xl font-bold font-heading text-amber-400 mt-1 flex items-center gap-2">
            <Phone className="w-5 h-5" />
            {callCount}
          </div>
          <div className="text-[11px] text-[#8B87A0] mt-1">Low-stock + periodic refresh</div>
        </div>
      </div>

      {/* ── Filter controls ── */}
      <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-[#8B87A0] shrink-0">
          <Filter className="w-3.5 h-3.5" />
          <span className="font-semibold uppercase tracking-wider">Filters</span>
        </div>

        {/* Actor filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#8B87A0] uppercase tracking-wider mr-1">Actor:</span>
          {ACTOR_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setActorFilter(value)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                actorFilter === value
                  ? "bg-[#FFB627]/20 text-[#FFB627] border-[#FFB627]/40"
                  : "bg-[#1C1E2B] text-[#8B87A0] border-[#262838] hover:text-[#F5F1E8]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[#262838] hidden sm:block" />

        {/* Action filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#8B87A0] uppercase tracking-wider mr-1">Type:</span>
          {ACTION_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setActionFilter(value)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                actionFilter === value
                  ? "bg-[#7DD3C0]/20 text-[#7DD3C0] border-[#7DD3C0]/40"
                  : "bg-[#1C1E2B] text-[#8B87A0] border-[#262838] hover:text-[#F5F1E8]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Active filter count badge */}
        <div className="ml-auto text-[11px] text-[#8B87A0]">
          Showing <span className="text-[#F5F1E8] font-semibold">{filteredLogs.length}</span> of{" "}
          <span className="text-[#F5F1E8] font-semibold">{totalEvents}</span> entries
        </div>
      </div>

      {/* ── Supplier Call Legend ── */}
      {(actionFilter === "all" || actionFilter === "calls") && callCount > 0 && (
        <div className="p-3 rounded-lg bg-[#1C1E2B] border border-[#262838] flex flex-wrap items-center gap-4 text-[11px] text-[#8B87A0]">
          <span className="font-semibold text-[#F5F1E8]">Supplier Call Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#7DD3C0]" />
            <Phone className="w-3 h-3 text-[#7DD3C0]" />
            🔴 LOW STOCK TRIGGER — fired by Decision Engine when stock unavailable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <RefreshCw className="w-3 h-3 text-amber-400" />
            🕐 PERIODIC 90-DAY REFRESH — scheduled price staleness check
          </span>
        </div>
      )}

      {/* Full Audit Panel — filters already applied, pass actorFilter=all and actionFilter=all to avoid double-filtering */}
      <div className="bg-[#14151F] rounded-xl border border-[#262838] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <AuditTrailPanel
          logs={filteredLogs}
          limit={200}
          showViewAll={false}
          actorFilter="all"
          actionFilter="all"
        />
      </div>
    </div>
  );
}
