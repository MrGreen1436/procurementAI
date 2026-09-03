"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchPOs, updatePOStatus } from "@/lib/api";
import { PurchaseOrder, RiskLevel } from "@/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Building2,
  Package,
  DollarSign,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Helpers ────────────────────────────────────────────── */
const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

const RISK_STYLES: Record<RiskLevel, { badge: string; border: string; icon: string }> = {
  high: {
    badge: "bg-red-500 hover:bg-red-600 text-white",
    border: "border-l-4 border-l-red-500",
    icon: "text-red-500",
  },
  medium: {
    badge: "bg-amber-500 hover:bg-amber-600 text-white",
    border: "border-l-4 border-l-amber-500",
    icon: "text-amber-500",
  },
  low: {
    badge: "bg-emerald-500 hover:bg-emerald-600 text-white",
    border: "border-l-4 border-l-emerald-500",
    icon: "text-emerald-500",
  },
};

const STATUS_STYLES = {
  pending: { icon: Clock, className: "text-muted-foreground" },
  approved: { icon: CheckCircle2, className: "text-emerald-500" },
  rejected: { icon: XCircle, className: "text-red-500" },
} as const;

/* ─── Agent Explanation Row ──────────────────────────────── */
function ExplanationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed">{value}</dd>
    </div>
  );
}

/* ─── PO Card ────────────────────────────────────────────── */
function POCard({
  po,
  onApprove,
  onReject,
}: {
  po: PurchaseOrder;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const risk = RISK_STYLES[po.riskLevel];
  const status = STATUS_STYLES[po.status];
  const StatusIcon = status.icon;
  const isPending = po.status === "pending";

  return (
    <Card
      className={cn(
        "shadow-sm transition-shadow hover:shadow-md",
        risk.border
      )}
    >
      <CardHeader className="pb-3">
        {/* Top row: SKU + risk badge + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{po.sku}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{po.skuName}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-xs", risk.badge)}>{po.riskLevel}</Badge>
            <StatusIcon className={cn("h-4 w-4", status.className)} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* Metadata grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" /> Supplier
            </div>
            <span className="text-sm font-medium truncate">{po.supplier}</span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" /> Quantity
            </div>
            <span className="text-sm font-medium">{po.quantity.toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3" /> Total Cost
            </div>
            <span className="text-sm font-medium">{formatCurrency(po.totalCost)}</span>
          </div>
        </div>

        {/* Unit cost pill */}
        <div className="text-xs text-muted-foreground">
          Unit cost: <span className="font-medium text-foreground">{formatCurrency(po.unitCost)}</span>
        </div>

        {/* Agent explanation (collapsible) */}
        <div className="border border-border/60 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Agent explanation
            </span>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          {expanded && (
            <dl className="px-3 py-3 space-y-3 border-t border-border/60 bg-muted/20">
              <ExplanationRow label="Why this supplier?" value={po.agentExplanation.whySupplier} />
              <ExplanationRow label="Why this quantity?" value={po.agentExplanation.whyQuantity} />
              <ExplanationRow label="Why this cost?" value={po.agentExplanation.whyCost} />
            </dl>
          )}
        </div>

        {/* Approve / Reject buttons — only shown for pending POs */}
        {isPending && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              id={`approve-${po.id}`}
              onClick={() => onApprove(po.id)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium py-2 px-3 transition-colors"
            >
              <Check className="h-4 w-4" /> Approve
            </button>
            <button
              type="button"
              id={`reject-${po.id}`}
              onClick={() => onReject(po.id)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium py-2 px-3 transition-colors"
            >
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        )}

        {/* Approved / Rejected label */}
        {!isPending && (
          <div
            className={cn(
              "text-center text-sm font-semibold py-2 rounded-lg",
              po.status === "approved"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            )}
          >
            {po.status === "approved" ? "✓ Approved" : "✕ Rejected"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────────── */
export default function POQueuePage() {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    fetchPOs().then((data) => {
      setPOs(data);
      setLoading(false);
    });
  }, []);

  // Optimistic approve
  const handleApprove = async (id: string) => {
    setPOs((prev) =>
      prev.map((po) => (po.id === id ? { ...po, status: "approved" } : po))
    );
    await updatePOStatus(id, "approved");
  };

  // Optimistic reject
  const handleReject = async (id: string) => {
    setPOs((prev) =>
      prev.map((po) => (po.id === id ? { ...po, status: "rejected" } : po))
    );
    await updatePOStatus(id, "rejected");
  };

  const filtered = useMemo(() => {
    return pos.filter((po) => {
      const riskOk = riskFilter === "all" || po.riskLevel === riskFilter;
      const statusOk = statusFilter === "all" || po.status === statusFilter;
      return riskOk && statusOk;
    });
  }, [pos, riskFilter, statusFilter]);

  const counts = useMemo(
    () => ({
      pending: pos.filter((p) => p.status === "pending").length,
      approved: pos.filter((p) => p.status === "approved").length,
      rejected: pos.filter((p) => p.status === "rejected").length,
    }),
    [pos]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">PO Approval Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve AI-generated purchase order recommendations
        </p>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border bg-card text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">{counts.pending}</span>
          <span className="text-muted-foreground">Pending</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border bg-card text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="font-semibold">{counts.approved}</span>
          <span className="text-muted-foreground">Approved</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border bg-card text-sm">
          <XCircle className="h-4 w-4 text-red-500" />
          <span className="font-semibold">{counts.rejected}</span>
          <span className="text-muted-foreground">Rejected</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-sm font-medium text-muted-foreground">Filter by:</span>
        <div className="w-44">
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Risk Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Levels</SelectItem>
              <SelectItem value="high">High Risk</SelectItem>
              <SelectItem value="medium">Medium Risk</SelectItem>
              <SelectItem value="low">Low Risk</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(riskFilter !== "all" || statusFilter !== "all") && (
          <button
            type="button"
            onClick={() => { setRiskFilter("all"); setStatusFilter("all"); }}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Showing {filtered.length} of {pos.length} POs
        </span>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No POs match the current filters</p>
          <button
            type="button"
            onClick={() => { setRiskFilter("all"); setStatusFilter("all"); }}
            className="mt-3 text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((po) => (
            <POCard
              key={po.id}
              po={po}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
