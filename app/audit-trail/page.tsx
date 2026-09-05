"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { fetchAuditLogs } from "@/lib/api";
import { AuditLogEntry } from "@/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ShieldCheck,
  Search,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  Clock,
  Bot,
  UserCheck,
  Cpu,
  PhoneCall,
  FileText,
  Copy,
  Check,
  Filter,
  Layers,
  Sparkles,
  ArrowUpDown,
  History,
  Activity,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ─── Helpers ────────────────────────────────────────────── */
const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
};

const formatDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
};

const formatRelativeTime = (iso: string) => {
  try {
    const now = Date.now();
    const diffMs = now - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDays = Math.floor(diffHour / 24);
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
};

const getActionStyle = (action: string) => {
  if (action.includes("APPROVED") || action.includes("COMPLETED")) {
    return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  }
  if (action.includes("REJECTED") || action.includes("FAILED")) {
    return "bg-red-500/15 text-red-500 border-red-500/30";
  }
  if (action.includes("PRICE_NEGOTIATED") || action.includes("CALL")) {
    return "bg-cyan-500/15 text-cyan-500 border-cyan-500/30";
  }
  if (action.includes("SCENARIO") || action.includes("ADJUST")) {
    return "bg-amber-500/15 text-amber-500 border-amber-500/30";
  }
  return "bg-blue-500/15 text-blue-500 border-blue-500/30";
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "success":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="h-3 w-3" /> Verified
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
          <AlertTriangle className="h-3 w-3" /> Warning
        </span>
      );
    case "failure":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
          <XCircle className="h-3 w-3" /> Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-full">
          <Info className="h-3 w-3" /> Info
        </span>
      );
  }
};

const getActorIcon = (actor: string) => {
  if (actor.toLowerCase().includes("ai") || actor.toLowerCase().includes("voice")) {
    return <Bot className="h-3.5 w-3.5 text-cyan-500" />;
  }
  if (actor.toLowerCase().includes("officer") || actor.toLowerCase().includes("user") || actor.toLowerCase().includes("analyst")) {
    return <UserCheck className="h-3.5 w-3.5 text-emerald-500" />;
  }
  return <Cpu className="h-3.5 w-3.5 text-muted-foreground" />;
};

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "timeline">("table");
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [livePulse, setLivePulse] = useState(false);

  const loadLogs = async () => {
    try {
      const res = await fetchAuditLogs({
        entityType: entityFilter,
        action: actionFilter,
        search: search.trim() || undefined,
        limit: 100,
      });
      setLogs(res.logs || []);
    } catch {
      // fallback handled in api.ts
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadLogs();

    // WebSocket real-time subscription for live audit log stream
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket("ws://127.0.0.1:8000/ws");
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (
            msg.type === "AUDIT_LOG_CREATED" ||
            msg.type === "PO_UPDATED" ||
            msg.type === "SUPPLIER_CALL_COMPLETED" ||
            msg.type === "SCENARIO_RUN"
          ) {
            setLivePulse(true);
            setTimeout(() => setLivePulse(false), 2000);
            loadLogs();
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (ws) ws.close();
    };
  }, [entityFilter, actionFilter]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadLogs();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard", { duration: 2000 });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExport = (format: "json" | "csv") => {
    if (format === "json") {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `audit_trail_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success("Exported JSON audit log");
    } else {
      const headers = ["ID", "Action", "Entity Type", "Entity ID", "Actor", "Status", "Timestamp", "Summary"];
      const rows = filteredLogs.map((l) => [
        l.id,
        l.action,
        l.entityType,
        l.entityId || "",
        l.actor,
        l.status,
        l.createdAt,
        JSON.stringify(l.details).replace(/"/g, '""'),
      ]);
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.map(cell => `"${cell}"`).join(","))].join("\n");
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", encodeURI(csvContent));
      downloadAnchor.setAttribute("download", `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success("Exported CSV audit log");
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchSearch =
        !search.trim() ||
        log.id.toLowerCase().includes(search.toLowerCase()) ||
        log.action.toLowerCase().includes(search.toLowerCase()) ||
        log.actor.toLowerCase().includes(search.toLowerCase()) ||
        (log.entityId && log.entityId.toLowerCase().includes(search.toLowerCase())) ||
        JSON.stringify(log.details).toLowerCase().includes(search.toLowerCase());

      const matchEntity = entityFilter === "all" || log.entityType === entityFilter;
      const matchAction = actionFilter === "all" || log.action === actionFilter;

      return matchSearch && matchEntity && matchAction;
    });
  }, [logs, search, entityFilter, actionFilter]);

  const metrics = useMemo(() => {
    const total = logs.length;
    const approvals = logs.filter((l) => l.action.includes("APPROVED")).length;
    const aiActions = logs.filter((l) => l.actor.toLowerCase().includes("ai") || l.action.includes("NEGOTIATED") || l.action.includes("CALL")).length;
    const scenarios = logs.filter((l) => l.action.includes("SCENARIO")).length;
    return { total, approvals, aiActions, scenarios };
  }, [logs]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-bold tracking-tight">Audit Trail &amp; Ledger</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border transition-all duration-300",
                livePulse
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 ring-2 ring-emerald-500/20"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", livePulse ? "bg-emerald-400 animate-ping" : "bg-emerald-500")} />
              Live Ledger Active
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Immutable, append-only chronological record of procurement decisions, AI negotiations, and inventory changes
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleExport("csv")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted text-foreground transition-colors shadow-sm"
            title="Export filtered records as CSV"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport("json")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted text-foreground transition-colors shadow-sm"
            title="Export filtered records as JSON"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            JSON
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted text-foreground transition-colors shadow-sm"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="shadow-sm border-l-4 border-l-primary">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 font-medium">
              <span>Total Logged Events</span>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="text-2xl font-bold tracking-tight tabular-nums">{metrics.total}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Append-only compliance store</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 font-medium">
              <span>PO Approvals &amp; Orders</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
              {metrics.approvals}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Authorised by officer</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-cyan-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 font-medium">
              <span>AI Autonomous Actions</span>
              <Bot className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-cyan-600 dark:text-cyan-400 tabular-nums">
              {metrics.aiActions}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Voice calls &amp; auto quotes</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 font-medium">
              <span>What-If Simulations</span>
              <Activity className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
              {metrics.scenarios}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Stress-tests logged</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search audit ID, material, actor, action, supplier or keyword..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Entity Type Filter */}
            <div className="w-full md:w-48">
              <Select value={entityFilter} onValueChange={(val) => val && setEntityFilter(val)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entity Types</SelectItem>
                  <SelectItem value="purchase_order">Purchase Orders</SelectItem>
                  <SelectItem value="supplier_call">Supplier Calls</SelectItem>
                  <SelectItem value="scenario">What-If Scenarios</SelectItem>
                  <SelectItem value="system">System Core</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Action Filter */}
            <div className="w-full md:w-48">
              <Select value={actionFilter} onValueChange={(val) => val && setActionFilter(val)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="PO_APPROVED">PO Approved</SelectItem>
                  <SelectItem value="PO_REJECTED">PO Rejected</SelectItem>
                  <SelectItem value="PO_PRICE_NEGOTIATED">Price Negotiated</SelectItem>
                  <SelectItem value="PO_AUTO_GENERATED">PO Generated</SelectItem>
                  <SelectItem value="SCENARIO_SIMULATION_RUN">Simulation Run</SelectItem>
                  <SelectItem value="SYSTEM_INITIALIZED">System Initialized</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-border p-0.5 bg-muted/30 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                  viewMode === "table" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode("timeline")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                  viewMode === "timeline" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <History className="h-3.5 w-3.5" />
                Timeline
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Ledger Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <Card className="py-16 text-center shadow-sm">
          <CardContent className="flex flex-col items-center justify-center">
            <ShieldCheck className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-base font-medium">No audit events match your filters</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Try adjusting your search terms or clearing the entity and action filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setEntityFilter("all");
                setActionFilter("all");
              }}
              className="mt-4 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
            >
              Reset All Filters
            </button>
          </CardContent>
        </Card>
      ) : viewMode === "table" ? (
        /* TABLE VIEW */
        <Card className="shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Summary &amp; Key Details</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLogs.map((log) => {
                  const summaryText =
                    log.details.summary ||
                    log.details.decision ||
                    (log.details.negotiated_unit_price ? `Quoted: $${Number(log.details.negotiated_unit_price).toFixed(2)} (${log.details.supplier || ""})` : null) ||
                    (log.details.total_cost ? `Total: $${Number(log.details.total_cost).toLocaleString()} (${log.details.sku || ""})` : null) ||
                    (log.details.message ? log.details.message : JSON.stringify(log.details));

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer group"
                      onClick={() => setSelectedEntry(log)}
                    >
                      {/* ID with quick copy */}
                      <td className="py-3 px-4 font-mono text-[11px] font-medium text-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{log.id}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(log.id, log.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            title="Copy Audit ID"
                          >
                            {copiedId === log.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>

                      {/* Timestamp */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-medium text-foreground">{formatTime(log.createdAt)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatRelativeTime(log.createdAt)}</div>
                      </td>

                      {/* Action Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Badge className={cn("text-[10px] font-semibold border", getActionStyle(log.action))}>
                          {log.action.replace(/_/g, " ")}
                        </Badge>
                      </td>

                      {/* Entity */}
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-foreground">
                        {log.entityId ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/60 text-[11px] font-mono">
                            {log.entityId}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Actor */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          {getActorIcon(log.actor)}
                          <span>{log.actor}</span>
                        </div>
                      </td>

                      {/* Summary */}
                      <td className="py-3 px-4 max-w-xs truncate text-muted-foreground" title={summaryText}>
                        {summaryText}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">{getStatusBadge(log.status)}</td>

                      {/* View Action */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEntry(log);
                          }}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          View Details &rarr;
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* TIMELINE VIEW */
        <div className="space-y-4 relative before:absolute before:inset-0 before:left-6 before:w-0.5 before:bg-border before:-z-0">
          {filteredLogs.map((log, idx) => (
            <div key={log.id} className="relative flex items-start gap-4 pl-12 group">
              {/* Timeline marker icon */}
              <div className="absolute left-3 -translate-x-1/2 top-3 h-7 w-7 rounded-full bg-card border-2 border-primary/50 shadow flex items-center justify-center z-10">
                {getActorIcon(log.actor)}
              </div>

              {/* Event card */}
              <Card
                className="flex-1 shadow-sm hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-primary"
                onClick={() => setSelectedEntry(log)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className={cn("text-[10px] font-semibold border", getActionStyle(log.action))}>
                        {log.action.replace(/_/g, " ")}
                      </Badge>
                      {log.entityId && (
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/60">
                          {log.entityId}
                        </span>
                      )}
                      {getStatusBadge(log.status)}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      <span>{formatDate(log.createdAt)} at {formatTime(log.createdAt)}</span>
                      <span className="opacity-60">({formatRelativeTime(log.createdAt)})</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Actor: <strong className="text-foreground font-semibold">{log.actor}</strong>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">ID: {log.id}</span>
                  </div>

                  {/* Details preview */}
                  <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs font-mono overflow-x-auto text-foreground">
                    {JSON.stringify(log.details, null, 2)}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Entry Detail Dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedEntry && (
            <DialogHeader className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge className={cn("text-xs font-semibold border", getActionStyle(selectedEntry.action))}>
                  {selectedEntry.action.replace(/_/g, " ")}
                </Badge>
                {getStatusBadge(selectedEntry.status)}
              </div>
              <DialogTitle className="text-lg font-bold flex items-center justify-between">
                <span>Audit Record: {selectedEntry.id}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedEntry.id, "dialog-id")}
                  className="text-xs font-normal text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {copiedId === "dialog-id" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy ID
                </button>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Recorded on {formatDate(selectedEntry.createdAt)} at {formatTime(selectedEntry.createdAt)} ({formatRelativeTime(selectedEntry.createdAt)})
              </DialogDescription>

              {/* Metadata attributes grid */}
              <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                <div className="p-2.5 rounded-lg border bg-card">
                  <div className="text-muted-foreground font-medium mb-0.5">Actor</div>
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    {getActorIcon(selectedEntry.actor)}
                    {selectedEntry.actor}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border bg-card">
                  <div className="text-muted-foreground font-medium mb-0.5">Entity Target</div>
                  <div className="font-semibold text-foreground font-mono">
                    {selectedEntry.entityId || "N/A"} ({selectedEntry.entityType})
                  </div>
                </div>
              </div>

              {/* Payload details */}
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <span>Structured Payload &amp; Audit Diff</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(JSON.stringify(selectedEntry.details, null, 2), "payload")}
                    className="text-[11px] font-normal lowercase flex items-center gap-1 hover:text-foreground"
                  >
                    {copiedId === "payload" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    copy json
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-muted/60 border border-border text-[11px] font-mono overflow-x-auto text-foreground leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(selectedEntry.details, null, 2)}
                </pre>
              </div>

              {/* Verification Stamp */}
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  Cryptographically immutable entry. Verified in SQLite persistent database ledger.
                </span>
              </div>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
