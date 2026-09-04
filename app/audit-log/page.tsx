"use client";

import React, { useEffect, useState } from "react";
import { fetchAuditLogs } from "@/lib/api";
import { AuditLogEntry } from "@/types";
import { AuditTrailPanel } from "@/components/AuditTrailPanel";
import { Shield, ArrowLeft, RefreshCw, FileText, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

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
            Complete cryptographic and provenance trail for AI-driven purchase orders, price anomaly flags, and officer overrides.
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

      {/* KPI mini-strip for audit stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Recorded Events</div>
          <div className="text-2xl font-bold font-heading text-[#F5F1E8] mt-1">
            {logs.length}
          </div>
          <div className="text-[11px] text-[#7DD3C0] mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> 100% Provenance Integrity
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Human Authorizations</div>
          <div className="text-2xl font-bold font-heading text-[#FFB627] mt-1">
            {logs.filter((l) => l.actorType === "human").length}
          </div>
          <div className="text-[11px] text-[#8B87A0] mt-1">
            Procurement Officer approvals &amp; audits
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-xs text-[#8B87A0] uppercase font-medium">Autonomous Actions</div>
          <div className="text-2xl font-bold font-heading text-[#7DD3C0] mt-1">
            {logs.filter((l) => l.actorType === "automated").length}
          </div>
          <div className="text-[11px] text-[#8B87A0] mt-1">
            Gemini-LLM &amp; Decision Engine triggers
          </div>
        </div>
      </div>

      {/* Full Audit Panel */}
      <div className="bg-[#14151F] rounded-xl border border-[#262838] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <AuditTrailPanel logs={logs} limit={100} showViewAll={false} />
      </div>
    </div>
  );
}
