"use client";

import React, { useState, useMemo } from "react";
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
  Phone,
  PhoneMissed,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

interface AuditTrailPanelProps {
  logs: AuditLogEntry[];
  limit?: number;
  showViewAll?: boolean;
  actorFilter?: string;   // "all" | "human" | "automated"
  actionFilter?: string;  // "all" | "po" | "anomaly" | "calls" | "transfer"
}

// ── Detail formatter ────────────────────────────────────────────────────────
function formatDetails(action: string, rawDetails?: string): { readable: string; raw: string } {
  const raw = rawDetails || "";
  if (!raw) return { readable: "", raw: "" };

  // Try to parse as JSON
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — return as-is
    return { readable: raw, raw };
  }

  const get = (k: string) => parsed[k] ?? "";

  switch (action) {
    case "po.auto_created":
    case "po.fallback_created": {
      const total = typeof parsed.total_cost === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsed.total_cost as number)
        : `$${parsed.total_cost}`;
      const statusLabel = get("status") === "pending_approval" ? "pending approval" : String(get("status")).replace("_", " ");
      return {
        readable: `Auto-created PO for ${get("sku_id")} — ${Number(get("quantity")).toLocaleString()} units from ${get("supplier_id")}, ${total} total · ${statusLabel}`,
        raw,
      };
    }
    case "po.llm_created": {
      const total = typeof parsed.total_cost === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsed.total_cost as number)
        : `$${parsed.total_cost}`;
      return {
        readable: `Gemini LLM created PO for ${get("sku_id")} — ${Number(get("quantity")).toLocaleString()} units from ${get("supplier_id")}, ${total} total`,
        raw,
      };
    }
    case "po.approved":
    case "po.rejected": {
      const verb = action === "po.approved" ? "Approved" : "Rejected";
      const total = typeof parsed.total_cost === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsed.total_cost as number)
        : "";
      return {
        readable: `${verb} PO from ${get("supplier_id")}${total ? `, ${total} total` : ""}`,
        raw,
      };
    }
    case "anomaly.approved":
      return {
        readable: `Officer confirmed anomaly — ${get("anomaly_reason") || "flagged transaction"}${get("sku_id") ? ` for ${get("sku_id")}` : ""}`,
        raw,
      };
    case "anomaly.rejected":
      return {
        readable: `Officer dismissed as false-positive${get("sku_id") ? ` for ${get("sku_id")}` : ""}`,
        raw,
      };
    case "transfer.recommended":
      return {
        readable: `Decision Engine recommended inter-store transfer for ${get("sku_id") || "SKU"} — ${get("quantity") ? `${get("quantity")} units` : ""} from ${get("from_site") || "source"} to ${get("to_site") || "destination"}`,
        raw,
      };
    case "automated_supplier_call_triggered": {
      // raw is plain text like "Item: Electronics (P0001), Result: {...}"
      const itemMatch = raw.match(/Item:\s*([^,]+)/);
      const item = itemMatch ? itemMatch[1].trim() : "";
      return {
        readable: `✅ Successfully initiated outbound call${item ? ` for ${item}` : ""}`,
        raw,
      };
    }
    case "automated_supplier_call_failed": {
      const itemMatch = raw.match(/Item:\s*([^,]+)/);
      const item = itemMatch ? itemMatch[1].trim() : "";
      return {
        readable: `❌ Call attempt failed${item ? ` for ${item}` : ""} — unverified number or network unreachable`,
        raw,
      };
    }
    case "periodic_price_refresh_call": {
      const itemMatch = raw.match(/Item:\s*([^,]+)/);
      const item = itemMatch ? itemMatch[1].trim() : "";
      return {
        readable: `🕐 Scheduled 90-day price refresh check${item ? ` for ${item}` : ""}`,
        raw,
      };
    }
    default:
      return { readable: raw.length > 120 ? raw.slice(0, 120) + "…" : raw, raw };
  }
}

// ── Actor badge config ────────────────────────────────────────────────────────
function getActorBadge(actor: string, actorType?: string) {
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
}

// ── Call trigger action config ───────────────────────────────────────────────
const CALL_ACTIONS: Record<string, { icon: React.ElementType; label: string; accent: string; dotColor: string }> = {
  automated_supplier_call_triggered: {
    icon: Phone,
    label: "🔴 LOW STOCK TRIGGER",
    accent: "border-l-[#7DD3C0] bg-[#7DD3C0]/5",
    dotColor: "bg-[#7DD3C0]",
  },
  automated_supplier_call_failed: {
    icon: PhoneMissed,
    label: "🔴 LOW STOCK TRIGGER (FAILED)",
    accent: "border-l-red-500 bg-red-500/5",
    dotColor: "bg-red-500",
  },
  periodic_price_refresh_call: {
    icon: RefreshCw,
    label: "🕐 PERIODIC 90-DAY REFRESH",
    accent: "border-l-amber-400 bg-amber-400/5",
    dotColor: "bg-amber-400",
  },
};

function isCallAction(action: string): boolean {
  return action in CALL_ACTIONS;
}

// ── Status icon ───────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "success": return <CheckCircle2 className="w-3.5 h-3.5 text-[#34D399]" />;
    case "warning": return <AlertTriangle className="w-3.5 h-3.5 text-[#FBBF24]" />;
    case "error":   return <AlertTriangle className="w-3.5 h-3.5 text-[#F0455C]" />;
    default:        return <Info className="w-3.5 h-3.5 text-[#7DD3C0]" />;
  }
}

// ── Expandable raw detail ─────────────────────────────────────────────────────
function ExpandableDetails({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  if (!raw) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] text-[#8B87A0] hover:text-[#F5F1E8] transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {open ? "Hide raw JSON" : "Show raw JSON"}
      </button>
      {open && (
        <pre className="mt-1.5 text-[10px] font-mono text-[#8B87A0] bg-[#0A0B10] border border-[#262838] rounded p-2 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
          {(() => {
            try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
          })()}
        </pre>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function AuditTrailPanel({
  logs,
  limit = 6,
  showViewAll = true,
  actorFilter = "all",
  actionFilter = "all",
}: AuditTrailPanelProps) {

  const filtered = useMemo(() => {
    let result = logs;

    if (actorFilter !== "all") {
      result = result.filter((l) =>
        actorFilter === "human"
          ? l.actorType === "human" || l.actor.toLowerCase().includes("officer")
          : l.actorType === "automated" || l.actorType === "system" || (!l.actor.toLowerCase().includes("officer"))
      );
    }

    if (actionFilter !== "all") {
      const groups: Record<string, string[]> = {
        po:       ["po.auto_created", "po.llm_created", "po.fallback_created", "po.approved", "po.rejected"],
        anomaly:  ["anomaly.approved", "anomaly.rejected"],
        calls:    ["automated_supplier_call_triggered", "automated_supplier_call_failed", "periodic_price_refresh_call"],
        transfer: ["transfer.recommended"],
      };
      const allowed = groups[actionFilter] ?? [];
      result = result.filter((l) => allowed.includes(l.action));
    }

    return result;
  }, [logs, actorFilter, actionFilter]);

  const displayedLogs = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div className="rounded-xl bg-[#14151F] border border-[#262838] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3.5 border-b border-[#262838]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold font-heading text-[#F5F1E8] tracking-tight">
              Audit &amp; Governance Trail
            </h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7DD3C0]/10 text-[#7DD3C0] border border-[#7DD3C0]/25">
              IMMUTABLE LOG
            </span>
          </div>
          <p className="text-xs text-[#8B87A0] mt-0.5">
            Full provenance tracking — human authorization vs autonomous AI actions
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
            No audit events match the current filters.
          </div>
        ) : (
          displayedLogs.map((entry, index) => {
            const badge = getActorBadge(entry.actor, entry.actorType);
            const ActorIcon = badge.icon;
            const callConfig = isCallAction(entry.action) ? CALL_ACTIONS[entry.action] : null;
            const CallIcon = callConfig?.icon;
            const { readable, raw } = formatDetails(entry.action, entry.details);

            const actionLabel = entry.action.replace(/\./g, " · ").replace(/_/g, " ");

            return (
              <div
                key={entry.id || `aud-${index}`}
                className="relative pl-6 pb-3.5 last:pb-0 border-l border-[#262838]/80 group"
              >
                {/* Timeline node dot */}
                <div
                  className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${callConfig?.dotColor ?? badge.dot} ring-4 ring-[#14151F] transition-transform group-hover:scale-125`}
                />

                <div
                  className={`hover:bg-[#1C1E2B] transition-colors rounded-lg border border-[#262838] p-3 ${
                    callConfig
                      ? `border-l-2 ${callConfig.accent}`
                      : "bg-[#1C1E2B]/60"
                  }`}
                >
                  {/* Call trigger label banner */}
                  {callConfig && (
                    <div className="flex items-center gap-1.5 mb-2">
                      {CallIcon && <CallIcon className="w-3 h-3 text-[#7DD3C0]" />}
                      <span className="text-[10px] font-bold tracking-widest text-[#7DD3C0] uppercase">
                        {callConfig.label}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-1.5">
                    {/* Actor tag */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        <ActorIcon className="w-3 h-3" />
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
                        ? new Date(entry.timestamp).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : entry.timestamp}
                    </span>
                  </div>

                  {/* Action code */}
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F5F1E8] font-heading mt-1">
                    <StatusIcon status={entry.status} />
                    <span className="line-clamp-1 font-mono text-[11px] text-[#8B87A0]">{actionLabel}</span>
                  </div>

                  {/* Target */}
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#8B87A0]">
                    <span className="px-1.5 py-0.5 rounded bg-[#0A0B10] border border-[#262838] text-[#F5F1E8]/90 font-mono text-[10px]">
                      {entry.target || entry.target_id || "N/A"}
                    </span>
                  </div>

                  {/* Human-readable details */}
                  {readable && (
                    <p className="mt-2 text-[12px] text-[#C4C0D4] leading-relaxed">
                      {readable}
                    </p>
                  )}

                  {/* Expandable raw JSON */}
                  <ExpandableDetails raw={raw} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
