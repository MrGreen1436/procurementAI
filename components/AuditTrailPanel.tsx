"use client";

import React, { useState } from "react";
import { AuditLogEntry } from "@/types";
import {
  UserCheck,
  Cpu,
  Bot,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

interface AuditTrailPanelProps {
  logs: AuditLogEntry[];
  limit?: number;
  showViewAll?: boolean;
}

export function AuditTrailPanel({
  logs,
  limit = 6,
  showViewAll = true,
}: AuditTrailPanelProps) {
  const displayedLogs = limit ? logs.slice(0, limit) : logs;

  const getActorBadge = (actor: string, actorType: string) => {
    const isHuman = actorType === "human" || actor.toLowerCase().includes("officer");

    if (isHuman) {
      return {
        label: actor,
        icon: UserCheck,
        bg: "bg-[#FFB627]/15",
        text: "text-[#FFB627]",
        border: "border-[#FFB627]/30",
        dot: "bg-[#FFB627]",
        typeLabel: "HUMAN",
      };
    }

    if (actor.toLowerCase().includes("gemini") || actor.toLowerCase().includes("llm")) {
      return {
        label: actor,
        icon: Bot,
        bg: "bg-[#7DD3C0]/15",
        text: "text-[#7DD3C0]",
        border: "border-[#7DD3C0]/30",
        dot: "bg-[#7DD3C0]",
        typeLabel: "AI AGENT",
      };
    }

    if (actor.toLowerCase().includes("decision") || actor.toLowerCase().includes("engine")) {
      return {
        label: actor,
        icon: Cpu,
        bg: "bg-[#FF6B35]/15",
        text: "text-[#FF6B35]",
        border: "border-[#FF6B35]/30",
        dot: "bg-[#FF6B35]",
        typeLabel: "RULES ENGINE",
      };
    }

    return {
      label: actor || "system",
      icon: Activity,
      bg: "bg-[#8B87A0]/15",
      text: "text-[#8B87A0]",
      border: "border-[#8B87A0]/30",
      dot: "bg-[#8B87A0]",
      typeLabel: "SYSTEM",
    };
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-3.5 h-3.5 text-[#34D399]" />;
      case "warning":
        return <AlertTriangle className="w-3.5 h-3.5 text-[#FBBF24]" />;
      case "error":
        return <AlertTriangle className="w-3.5 h-3.5 text-[#F0455C]" />;
      default:
        return <Info className="w-3.5 h-3.5 text-[#7DD3C0]" />;
    }
  };

  return (
    <div className="rounded-xl bg-[#14151F] border border-[#262838] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3.5 border-b border-[#262838]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold font-heading text-[#F5F1E8] tracking-tight">
              Audit & Governance Trail
            </h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7DD3C0]/10 text-[#7DD3C0] border border-[#7DD3C0]/25">
              IMMUTABLE LOG
            </span>
          </div>
          <p className="text-xs text-[#8B87A0] mt-0.5">
            Full provenance tracking human authorization vs autonomous AI actions
          </p>
        </div>

        {showViewAll && (
          <Link
            href="/audit-log"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#FFB627] hover:underline"
          >
            Full Trail <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      {/* Timeline items */}
      <div className="mt-4 space-y-3.5 flex-1">
        {displayedLogs.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8B87A0]">
            No audit events recorded yet.
          </div>
        ) : (
          displayedLogs.map((entry, index) => {
            const badge = getActorBadge(entry.actor, entry.actorType);
            const Icon = badge.icon;

            return (
              <div
                key={entry.id || `aud-${index}`}
                className="relative pl-6 pb-3.5 last:pb-0 border-l border-[#262838]/80 group"
              >
                {/* Timeline node dot */}
                <div
                  className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${badge.dot} ring-4 ring-[#14151F] transition-transform group-hover:scale-125`}
                />

                <div className="bg-[#1C1E2B]/60 hover:bg-[#1C1E2B] transition-colors rounded-lg border border-[#262838] p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-1.5">
                    {/* Actor tag */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        <Icon className="w-3 h-3" />
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-[#8B87A0] font-mono tracking-wider">
                        [{badge.typeLabel}]
                      </span>
                    </div>

                    {/* Timestamp */}
                    <span className="text-[11px] text-[#8B87A0] flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3 text-[#8B87A0]" />
                      {entry.timestamp.includes("T")
                        ? new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : entry.timestamp}
                    </span>
                  </div>

                  {/* Action statement */}
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F5F1E8] font-heading mt-1">
                    {getStatusIcon(entry.status)}
                    <span className="line-clamp-1">{entry.action}</span>
                  </div>

                  {/* Target & details */}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-[#8B87A0]">
                    <span className="px-1.5 py-0.5 rounded bg-[#0A0B10] border border-[#262838] text-[#F5F1E8]/90 font-mono text-[10px]">
                      Target: {entry.target}
                    </span>
                    {entry.details && (
                      <span className="line-clamp-1 text-[#8B87A0]">
                        — {entry.details}
                      </span>
                    )}
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
