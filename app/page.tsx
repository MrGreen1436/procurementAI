"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchKPIs,
  fetchAlerts,
  fetchInventoryHistory,
  fetchPOs,
  fetchSupplierRisks,
  fetchAuditLogs,
  fetchAlertsStatus,
  uploadDataset,
} from "@/lib/api";
import {
  KPISummary,
  Alert,
  InventoryPoint,
  PurchaseOrder,
  RiskLevel,
  SupplierRiskItem,
  AuditLogEntry,
  AlertsStatus,
} from "@/types";
import { useCountUp } from "@/lib/useCountUp";
import { toast } from "sonner";
import { HeroKpiCard } from "@/components/HeroKpiCard";
import { SupplierRiskPanel } from "@/components/SupplierRiskPanel";
import { AuditTrailPanel } from "@/components/AuditTrailPanel";

// shadcn UI & Recharts
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Lucide Icons
import {
  AlertTriangle,
  Bot,
  Mail,
  TrendingUp,
  ShoppingCart,
  Upload,
  Radio,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Shield,
  Layers,
} from "lucide-react";

import { cn } from "@/lib/utils";

/* ─── Helpers ─────────────────────────────────────────── */
const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

const riskBadgeStyle = (level: RiskLevel) => {
  switch (level) {
    case "high":
      return "bg-[#F0455C]/15 text-[#F0455C] border-[#F0455C]/30";
    case "medium":
      return "bg-[#FBBF24]/15 text-[#FBBF24] border-[#FBBF24]/30";
    case "low":
    default:
      return "bg-[#34D399]/15 text-[#34D399] border-[#34D399]/30";
  }
};

/* ─── Simulated supplier delay alert ─────────────────── */
const DELAY_ALERT: Alert = {
  id: `demo-${Date.now()}`,
  sku: "SKU-COP-006",
  skuName: "Copper Wire - 12 AWG",
  riskLevel: "high",
  daysUntilStockout: 3,
  currentStock: 2500,
  forecastedDemand: 9000,
  createdAt: new Date().toISOString(),
};

/* ─── Secondary Raised KPI Card ────────────────────────── */
function RaisedKpiCard({
  label,
  value,
  isCurrency = false,
  subtitle,
  icon: Icon,
  accentColor = "#FFB627",
  urgencyBorder,
}: {
  label: string;
  value: number;
  isCurrency?: boolean;
  subtitle: string;
  icon: React.ElementType;
  accentColor?: string;
  urgencyBorder?: string;
}) {
  const animatedValue = useCountUp(Math.round(value), 1200);

  return (
    <div
      className={cn(
        "raised-surface raised-surface-hover rounded-xl p-5 flex flex-col justify-between transition-all duration-200 border border-[#262838]",
        urgencyBorder
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-[#8B87A0] tracking-normal">
          {label}
        </span>
        <div
          className="p-2 rounded-lg bg-[#1C1E2B] border border-[#262838] transition-transform"
          style={{ color: accentColor }}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="my-1">
        <div
          className="text-3xl font-bold font-heading tracking-tight tabular-nums"
          style={{ color: accentColor === "#FF6B35" ? "#FF6B35" : "#F5F1E8" }}
        >
          {isCurrency ? formatCurrency(animatedValue) : animatedValue.toLocaleString()}
        </div>
      </div>

      <p className="text-[11px] text-[#8B87A0] mt-1.5 line-clamp-1">
        {subtitle}
      </p>
    </div>
  );
}

/* ─── Dashboard Page Component ─────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();

  const [kpis, setKpis] = useState<KPISummary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<InventoryPoint[]>([]);
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [supplierRisks, setSupplierRisks] = useState<SupplierRiskItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [slackStatus, setSlackStatus] = useState<AlertsStatus>({ configured: false });

  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [alertFilter, setAlertFilter] = useState<string>("all");
  const [newAlertIds, setNewAlertIds] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState<boolean>(false);

  useEffect(() => {
    fetchKPIs().then(setKpis);
    fetchAlerts().then(setAlerts);
    fetchInventoryHistory().then((data) => {
      setHistory(data);
      if (data && data.length > 0) {
        const skus = Array.from(new Set(data.map((h) => h.sku)));
        if (skus.length > 0) {
          setSelectedSku((prev) => (prev && skus.includes(prev) ? prev : skus[0]));
        }
      }
    });
    fetchPOs().then(setPOs);
    fetchSupplierRisks().then(setSupplierRisks);
    fetchAuditLogs().then(setAuditLogs);
    fetchAlertsStatus().then(setSlackStatus);
  }, []);

  const uniqueSkus = Array.from(new Set(history.map((h) => h.sku)));

  useEffect(() => {
    if (uniqueSkus.length > 0 && (!selectedSku || !uniqueSkus.includes(selectedSku))) {
      setSelectedSku(uniqueSkus[0]);
    }
  }, [uniqueSkus, selectedSku]);

  const chartData = history
    .filter((h) => h.sku === selectedSku)
    .map((h) => ({
      date: h.date,
      ActualLevel: h.actualLevel,
      ForecastedLevel: h.forecastedLevel,
      EtsForecastedLevel: h.etsForecastedLevel,
      LstmForecastedLevel: h.lstmForecastedLevel,
    }));

  const filteredAlerts =
    alertFilter === "all" ? alerts : alerts.filter((a) => a.riskLevel === alertFilter);

  /* ── Demo: Simulate Supplier Delay Email ── */
  const handleSimulateDelay = () => {
    const newAlert: Alert = {
      ...DELAY_ALERT,
      id: `demo-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setAlerts((prev) => [newAlert, ...prev]);
    setNewAlertIds((prev) => new Set(prev).add(newAlert.id));
    setAlertFilter("all");

    // Add immediate audit log entry
    const newAuditEntry: AuditLogEntry = {
      id: `aud-sim-${Date.now()}`,
      timestamp: "Just now",
      action: "Parsed Supplier Delay Email from WireCo Global",
      actor: "Gemini-LLM",
      actorType: "automated",
      target: "SKU-COP-006 (Copper Wire)",
      details: "7-day shipment lag extracted; flagged critical stockout risk.",
      status: "warning",
    };
    setAuditLogs((prev) => [newAuditEntry, ...prev]);

    toast.error("Supplier Delay Notice Processed", {
      description: "WireCo Global reported a 7-day delay. Stockout window narrowed to 3 days.",
      duration: 5000,
    });

    setTimeout(() => {
      setNewAlertIds((prev) => {
        const next = new Set(prev);
        next.delete(newAlert.id);
        return next;
      });
    }, 2500);
  };

  /* ── Demo: Run Agent ── */
  const handleRunAgent = () => {
    const question = encodeURIComponent("Which SKUs are at highest stockout risk?");
    toast.success("Autonomous Agent Invoked", {
      description: "Opening multi-turn inspection agent in chat...",
      duration: 2500,
    });
    setTimeout(() => {
      router.push(`/chat?autoask=${question}`);
    }, 800);
  };

  /* ── Demo: Upload Dataset ── */
  const handleUploadDataset = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    toast.info("Ingesting Dataset", {
      description: `Uploading ${file.name} and retraining ML demand pipeline...`,
      duration: 7000,
    });

    const result = await uploadDataset(file);
    e.target.value = "";
    setIsUploading(false);

    if (result.success) {
      toast.success("Model Pipeline Retrained", {
        description: result.message,
        duration: 5000,
      });
      setTimeout(() => {
        window.location.reload();
      }, 1400);
    } else {
      toast.error("Upload Error", {
        description: result.message,
        duration: 6000,
      });
    }
  };

  return (
    <div className="space-y-7 max-w-[1600px] mx-auto pb-10">
      {/* ─── Top Control Room Bar ─────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-[#262838]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold font-heading text-[#F5F1E8] tracking-tight">
              Command Control Room
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#34D399]/10 text-[#34D399] border border-[#34D399]/25">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-ping" />
              LIVE TELEMETRY
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#8B87A0] mt-1">
            Real-time supply chain forecasting, predictive supplier risk intelligence &amp; autonomous governance
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          <label className="inline-flex items-center gap-2 rounded-lg border border-[#262838] bg-[#14151F] hover:bg-[#1C1E2B] hover:border-[#FFB627]/40 text-[#F5F1E8] text-xs font-semibold px-3.5 py-2.5 transition-all duration-200 cursor-pointer shadow-sm">
            <Upload className="h-3.5 w-3.5 text-[#FFB627]" />
            <span>{isUploading ? "Retraining..." : "Upload Dataset"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              disabled={isUploading}
              onChange={handleUploadDataset}
            />
          </label>

          <button
            id="demo-delay-btn"
            type="button"
            onClick={handleSimulateDelay}
            className="inline-flex items-center gap-2 rounded-lg border border-[#FF6B35]/30 bg-[#FF6B35]/10 hover:bg-[#FF6B35]/20 text-[#FF6B35] text-xs font-semibold px-3.5 py-2.5 transition-all duration-200 shadow-sm"
          >
            <Mail className="h-3.5 w-3.5 text-[#FF6B35]" />
            Simulate Delay
          </button>

          <button
            id="demo-agent-btn"
            type="button"
            onClick={handleRunAgent}
            className="inline-flex items-center gap-2 rounded-lg border border-[#FFB627]/50 bg-gradient-to-r from-[#FFB627]/20 to-[#FF6B35]/20 hover:from-[#FFB627]/30 hover:to-[#FF6B35]/30 text-[#FFB627] text-xs font-semibold px-4 py-2.5 transition-all duration-200 shadow-[0_0_20px_rgba(255,182,39,0.15)]"
          >
            <Bot className="h-3.5 w-3.5 text-[#FFB627]" />
            Run AI Agent
          </button>
        </div>
      </div>

      {/* ─── Hero KPI Strip with Ambient Gold Flare Glow ────────── */}
      <div className="hero-ambient-glow relative">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
          {/* Card 1: Stockout Risk Count (Urgent/Ember Accent) */}
          <RaisedKpiCard
            label="Stockout Risk Count"
            value={kpis?.stockoutRiskCount ?? 6}
            subtitle="SKUs breaching 7-day threshold"
            icon={AlertTriangle}
            accentColor="#FF6B35"
            urgencyBorder="border-l-4 border-l-[#FF6B35]"
          />

          {/* Card 2: Excess Inventory Value (Cool Teal Contrast) */}
          <RaisedKpiCard
            label="Excess Inventory Value"
            value={kpis?.excessInventoryValue ?? 1245000}
            isCurrency
            subtitle="Holding capital exceeding 1.5× forecast"
            icon={TrendingUp}
            accentColor="#7DD3C0"
          />

          {/* Card 3: Open POs (Raised Control Surface) */}
          <RaisedKpiCard
            label="Active Purchase Orders"
            value={kpis?.openPOCount ?? 5}
            subtitle="Autonomous drafts & pending approvals"
            icon={ShoppingCart}
            accentColor="#F5F1E8"
          />

          {/* Card 4: Flagship Metric — Hero 3D Tilt Card (Gold Solar Core) */}
          <HeroKpiCard
            label="Supplier Risk Score"
            value={kpis?.supplierRiskScore ?? 68}
            maxScore={100}
            subtitle="Fleet-wide aggregate risk index"
            icon={Shield}
            badgeText="FLAGSHIP METRIC"
          />
        </div>
      </div>

      {/* ─── Main Analytics Row: Forecast Chart + PO Queue ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Forecast Chart with Gradient Fill Under Teal Line */}
        <div className="lg:col-span-2">
          <div className="rounded-xl bg-[#14151F] border border-[#262838] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] flex flex-col h-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#262838]">
              <div>
                <h2 className="text-base font-semibold font-heading text-[#F5F1E8] tracking-tight">
                  Inventory Forecast vs Actual Demand
                </h2>
                <p className="text-xs text-[#8B87A0] mt-0.5">
                  Past 90-day history blended with 30-day XGBoost, ETS &amp; LSTM predictions
                </p>
              </div>

              <div className="w-56">
                <Select value={selectedSku} onValueChange={(val) => val && setSelectedSku(val)}>
                  <SelectTrigger className="h-8 text-xs bg-[#1C1E2B] border-[#262838] text-[#F5F1E8] focus:ring-[#FFB627]/40">
                    <SelectValue placeholder="Select SKU" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#14151F] border-[#262838] text-[#F5F1E8]">
                    {uniqueSkus.map((sku) => (
                      <SelectItem
                        key={sku}
                        value={sku}
                        className="text-xs focus:bg-[#1C1E2B] focus:text-[#FFB627]"
                      >
                        {sku}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Recharts Area + Line chart with 1.2s motion moment */}
            <div className="h-80 w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7DD3C0" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#7DD3C0" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#262838"
                    opacity={0.6}
                  />

                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#8B87A0" }}
                    tickFormatter={(val) => val.split("-").slice(1).join("/")}
                    axisLine={{ stroke: "#262838" }}
                    tickLine={false}
                    minTickGap={28}
                  />

                  <YAxis
                    tick={{ fontSize: 11, fill: "#8B87A0" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)}
                  />

                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#14151F",
                      borderColor: "#262838",
                      borderRadius: "10px",
                      color: "#F5F1E8",
                      fontSize: "12px",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                    }}
                    labelStyle={{ color: "#8B87A0", marginBottom: "4px" }}
                  />

                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                    formatter={(val) => <span style={{ color: "#F5F1E8" }}>{val}</span>}
                  />

                  {/* Gradient-fill area beneath Actual Level in Cool Teal (#7DD3C0) */}
                  <Area
                    type="monotone"
                    dataKey="ActualLevel"
                    name="Actual Level"
                    stroke="#7DD3C0"
                    strokeWidth={2.5}
                    fill="url(#actualGradient)"
                    dot={false}
                    activeDot={{ r: 5, fill: "#7DD3C0", stroke: "#0A0B10", strokeWidth: 2 }}
                    isAnimationActive
                    animationDuration={1200}
                    animationEasing="ease-out"
                  />

                  {/* Multi-model Forecast Lines */}
                  <Line
                    type="monotone"
                    dataKey="ForecastedLevel"
                    name="XGBoost Forecast"
                    stroke="#8B87A0"
                    strokeWidth={1.8}
                    strokeDasharray="5 5"
                    dot={false}
                    isAnimationActive
                    animationDuration={1200}
                  />

                  <Line
                    type="monotone"
                    dataKey="EtsForecastedLevel"
                    name="ETS Forecast"
                    stroke="#FBBF24"
                    strokeWidth={1.8}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive
                    animationDuration={1200}
                  />

                  <Line
                    type="monotone"
                    dataKey="LstmForecastedLevel"
                    name="LSTM Forecast"
                    stroke="#A78BFA"
                    strokeWidth={1.8}
                    strokeDasharray="4 1 2"
                    dot={false}
                    isAnimationActive
                    animationDuration={1200}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* PO Approval Queue Preview */}
        <div className="lg:col-span-1">
          <div className="rounded-xl bg-[#14151F] border border-[#262838] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] flex flex-col h-full">
            <div className="flex items-center justify-between pb-3 border-b border-[#262838]">
              <div>
                <h2 className="text-base font-semibold font-heading text-[#F5F1E8] tracking-tight">
                  PO Approval Queue
                </h2>
                <p className="text-xs text-[#8B87A0] mt-0.5">
                  AI-drafted orders pending human confirmation
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-[#1C1E2B] text-[#FFB627] font-semibold border border-[#FFB627]/20">
                {pos.length} queued
              </span>
            </div>

            <div className="flex-1 overflow-auto space-y-3 mt-4 pr-1">
              {pos.slice(0, 5).map((po) => (
                <div
                  key={po.id}
                  className="p-3.5 rounded-lg bg-[#1C1E2B]/80 hover:bg-[#1C1E2B] border border-[#262838] hover:border-[#FFB627]/30 transition-all duration-200 shadow-sm"
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <div>
                      <span className="font-semibold text-sm text-[#F5F1E8] font-heading">
                        {po.sku}
                      </span>
                      <div className="text-[11px] text-[#8B87A0] truncate max-w-[160px]">
                        {po.supplier}
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${riskBadgeStyle(
                        po.riskLevel
                      )}`}
                    >
                      {po.riskLevel} risk
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs mt-2.5 pt-2 border-t border-[#262838]/80 text-[#8B87A0]">
                    <span>Qty: <strong className="text-[#F5F1E8]">{po.quantity.toLocaleString()}</strong></span>
                    <span className="text-[#F5F1E8] font-semibold font-heading">
                      {formatCurrency(po.totalCost)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-[#262838] mt-3 text-center">
              <button
                onClick={() => router.push("/po-queue")}
                className="w-full py-2 rounded-lg bg-[#1C1E2B] hover:bg-[#262838] text-xs font-semibold text-[#FFB627] transition-colors border border-[#262838] flex items-center justify-center gap-1"
              >
                Inspect All Orders <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── NEW SECTION: Per-Supplier Risk Panel ─────────────────── */}
      <SupplierRiskPanel suppliers={supplierRisks} />

      {/* ─── Bottom Split: Active Alerts + Audit Trail Timeline ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Active Alerts Table (7 cols) */}
        <div className="lg:col-span-7">
          <div className="rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_8px_32px_rgba(0,0,0,0.35)] overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 pb-4 border-b border-[#262838] gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold font-heading text-[#F5F1E8] tracking-tight">
                  Active Stockout Alerts
                </h2>
                {/* Slack Status Indicator */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border",
                    slackStatus.configured
                      ? "bg-[#34D399]/10 text-[#34D399] border-[#34D399]/30"
                      : "bg-[#8B87A0]/10 text-[#8B87A0] border-[#8B87A0]/30"
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      slackStatus.configured ? "bg-[#34D399] animate-pulse" : "bg-[#8B87A0]"
                    )}
                  />
                  Slack: {slackStatus.configured ? "Connected" : "Not configured"}
                </span>
              </div>

              <div className="w-36">
                <Select value={alertFilter} onValueChange={(val) => val && setAlertFilter(val)}>
                  <SelectTrigger className="h-8 text-xs bg-[#1C1E2B] border-[#262838] text-[#F5F1E8] focus:ring-[#FFB627]/40">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#14151F] border-[#262838] text-[#F5F1E8]">
                    <SelectItem value="all">All Risks</SelectItem>
                    <SelectItem value="high">High Risk</SelectItem>
                    <SelectItem value="medium">Medium Risk</SelectItem>
                    <SelectItem value="low">Low Risk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-[#262838] hover:bg-transparent">
                    <TableHead className="pl-5 text-[#8B87A0] text-xs">SKU</TableHead>
                    <TableHead className="text-[#8B87A0] text-xs">Risk Level</TableHead>
                    <TableHead className="text-[#8B87A0] text-xs">Days to Stockout</TableHead>
                    <TableHead className="text-[#8B87A0] text-xs">Current vs Forecast</TableHead>
                    <TableHead className="text-right pr-5 text-[#8B87A0] text-xs">Logged</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-xs text-[#8B87A0]">
                        No active stockout alerts for current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAlerts.map((alert, idx) => (
                      <TableRow
                        key={alert.id ?? `alert-${idx}`}
                        className={cn(
                          "cursor-pointer hover:bg-[#1C1E2B]/80 transition-colors border-b border-[#262838]/60",
                          alert.id &&
                            newAlertIds.has(alert.id) &&
                            "bg-[#FF6B35]/15 animate-pulse"
                        )}
                        onClick={() => setSelectedAlert(alert)}
                      >
                        <TableCell className="font-medium pl-5 text-[#F5F1E8]">
                          <div className="font-heading">{alert.sku}</div>
                          <div className="text-[11px] text-[#8B87A0]">{alert.skuName}</div>
                        </TableCell>

                        <TableCell>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${riskBadgeStyle(
                              alert.riskLevel
                            )}`}
                          >
                            {alert.riskLevel}
                          </span>
                        </TableCell>

                        <TableCell>
                          {alert.daysUntilStockout != null ? (
                            <span
                              className={
                                alert.daysUntilStockout <= 5
                                  ? "text-[#FF6B35] font-semibold"
                                  : "text-[#F5F1E8]"
                              }
                            >
                              {alert.daysUntilStockout} days
                            </span>
                          ) : (
                            <span className="text-[#8B87A0]">N/A</span>
                          )}
                        </TableCell>

                        <TableCell className="text-xs">
                          <span className="text-[#F5F1E8]">
                            {(alert.currentStock ?? 0).toLocaleString()}
                          </span>
                          <span className="text-[#8B87A0]"> / </span>
                          <span className="text-[#FF6B35] font-semibold">
                            {(alert.forecastedDemand ?? 0).toLocaleString()}
                          </span>
                        </TableCell>

                        <TableCell className="text-right text-[#8B87A0] text-xs pr-5 font-mono">
                          {alert.createdAt
                            ? new Date(alert.createdAt).toLocaleDateString()
                            : "N/A"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* Audit Trail Panel (5 cols) */}
        <div className="lg:col-span-5">
          <AuditTrailPanel logs={auditLogs} limit={6} showViewAll />
        </div>
      </div>

      {/* ─── Alert Detail Drawer (Restyled for Solar Storm) ──────── */}
      <Sheet open={!!selectedAlert} onOpenChange={(open) => !open && setSelectedAlert(null)}>
        <SheetContent className="bg-[#14151F] border-l border-[#262838] text-[#F5F1E8]">
          <SheetHeader>
            <SheetTitle className="text-xl font-bold font-heading text-[#F5F1E8]">
              Alert Deep Inspection
            </SheetTitle>
            <SheetDescription className="text-xs text-[#8B87A0]">
              Actionable telemetry insights for {selectedAlert?.sku}
            </SheetDescription>
          </SheetHeader>

          {selectedAlert && (
            <div className="mt-6 space-y-5">
              <div>
                <div className="text-xs font-medium text-[#8B87A0] mb-1">Item Identification</div>
                <div className="text-lg font-semibold font-heading text-[#F5F1E8]">
                  {selectedAlert.skuName}
                </div>
                <span className="text-xs font-mono text-[#8B87A0]">{selectedAlert.sku}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 bg-[#1C1E2B] rounded-lg border border-[#262838]">
                  <div className="text-[11px] text-[#8B87A0] mb-1 uppercase font-medium">Current Stock</div>
                  <div className="text-2xl font-bold font-heading text-[#F5F1E8]">
                    {selectedAlert.currentStock.toLocaleString()}
                  </div>
                </div>
                <div className="p-3.5 bg-[#1C1E2B] rounded-lg border border-[#262838]">
                  <div className="text-[11px] text-[#8B87A0] mb-1 uppercase font-medium">Forecasted Demand</div>
                  <div className="text-2xl font-bold font-heading text-[#FF6B35]">
                    {selectedAlert.forecastedDemand.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[#1C1E2B]/80 border border-[#262838] space-y-2">
                <div className="text-xs font-semibold text-[#FFB627] tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#FFB627]" />
                  Decision Engine Recommendation
                </div>
                <p className="text-xs leading-relaxed text-[#F5F1E8]/90">
                  With a projected stockout horizon of {selectedAlert.daysUntilStockout} days, an automated draft purchase order has been queued in the approval pipeline. Cross-store inventory surplus was evaluated and determined insufficient.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${riskBadgeStyle(selectedAlert.riskLevel)}`}>
                  {selectedAlert.riskLevel} risk
                </span>
                <span className="text-xs px-3 py-1 rounded-full bg-[#1C1E2B] text-[#8B87A0] border border-[#262838]">
                  {selectedAlert.daysUntilStockout} days remaining
                </span>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
