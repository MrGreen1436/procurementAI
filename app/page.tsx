"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchKPIs, fetchAlerts, fetchInventoryHistory, fetchPOs } from "@/lib/api";
import { KPISummary, Alert, InventoryPoint, PurchaseOrder, RiskLevel } from "@/types";
import { useCountUp } from "@/lib/useCountUp";
import { toast } from "sonner";

// shadcn UI
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Recharts
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// Lucide
import { AlertTriangle, Bot, Mail, TrendingUp, ShoppingCart, Database } from "lucide-react";

import { cn } from "@/lib/utils";

/* ─── Helpers ─────────────────────────────────────────── */
const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

const riskColorClass = (level: RiskLevel) => ({
  high: "bg-red-500 hover:bg-red-600 text-white",
  medium: "bg-amber-500 hover:bg-amber-600 text-white",
  low: "bg-emerald-500 hover:bg-emerald-600 text-white",
}[level] ?? "bg-slate-500 text-white");

const KPI_BORDER = {
  stockout: "border-t-red-500",
  excess: "border-t-emerald-500",
  po: "border-t-blue-500",
  supplier: "border-t-amber-500",
};

/* ─── Animated KPI Card ───────────────────────────────── */
function KPICard({
  label,
  value,
  formatted,
  borderColor,
  icon: Icon,
}: {
  label: string;
  value: number;
  formatted?: string;
  borderColor: string;
  icon: React.ElementType;
}) {
  const animated = useCountUp(value, 1200);
  const display = formatted
    ? formatCurrency(animated * (value / Math.max(1, value)))  // keeps proportional if formatted
    : animated;

  // For currency we do a simpler linear scale
  const currencyAnimated = useCountUp(Math.round(value), 1200);

  return (
    <Card className={cn("border-t-4 shadow-sm", borderColor)}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">
          {formatted
            ? formatCurrency(currencyAnimated)
            : animated}
          {label === "Supplier Risk Score" && (
            <span className="text-lg text-muted-foreground font-normal">/100</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

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

/* ─── Page ────────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();

  const [kpis, setKpis] = useState<KPISummary | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<InventoryPoint[]>([]);
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);

  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [selectedSku, setSelectedSku] = useState<string>("ALL");
  const [alertFilter, setAlertFilter] = useState<string>("all");
  const [newAlertIds, setNewAlertIds] = useState<Set<string>>(new Set());

  // Chart Controls
  const [dateRange, setDateRange] = useState<string>("1M");
  const [showXGB, setShowXGB] = useState<boolean>(true);
  const [showETS, setShowETS] = useState<boolean>(false);
  const [showLSTM, setShowLSTM] = useState<boolean>(false);

  useEffect(() => {
    fetchKPIs().then(setKpis);
    fetchAlerts().then(setAlerts);
    fetchInventoryHistory().then((data) => {
      setHistory(data);
      if (data && data.length > 0) {
        const skus = Array.from(
          new Set(
            data
              .map((h) => h.sku)
              .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          )
        );
        if (skus.length > 0) {
          setSelectedSku((prev) => (prev && skus.includes(prev) ? prev : (skus.includes("ALL") ? "ALL" : skus[0])));
        }
      }
    });
    fetchPOs().then(setPOs);

    // Real-time sync with AI voice calls and PO updates
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket("ws://127.0.0.1:8000/ws");
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "PO_UPDATED" || msg.type === "SUPPLIER_CALL_COMPLETED") {
            fetchPOs().then(setPOs);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (ws) ws.close();
    };
  }, []);

  const uniqueSkus = Array.from(
    new Set(
      history
        .map((h) => h.sku)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    )
  );

  // Whenever uniqueSkus changes, ensure selectedSku points to a valid SKU
  useEffect(() => {
    if (uniqueSkus.length > 0 && (!selectedSku || !uniqueSkus.includes(selectedSku))) {
      setSelectedSku(uniqueSkus.includes("ALL") ? "ALL" : uniqueSkus[0]);
    }
  }, [uniqueSkus, selectedSku]);

  let filteredHistory = history.filter((h) => h.sku === selectedSku);
  if (dateRange !== "ALL" && filteredHistory.length > 0) {
    if (dateRange === "1M") filteredHistory = filteredHistory.slice(-60); // 30 past + 30 future
    else if (dateRange === "1W") filteredHistory = filteredHistory.slice(-37); // 7 past + 30 future
  }

  const chartData = filteredHistory.map((h) => ({
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
    setAlertFilter("all"); // show all so the new alert is visible

    toast.error("⚠️ Supplier Delay Email Received", {
      description: "WireCo Global reports a 7-day delay on Copper Wire shipments. New high-risk alert added.",
      duration: 5000,
    });

    // Remove fade-in highlight after animation
    setTimeout(() => {
      setNewAlertIds((prev) => {
        const next = new Set(prev);
        next.delete(newAlert.id);
        return next;
      });
    }, 2500);
  };

  /* ── Demo: Run Agent (auto chat replay) ── */
  const handleRunAgent = () => {
    const question = encodeURIComponent("Which SKUs are at highest stockout risk?");
    toast.success("🤖 Agent Running", {
      description: "Navigating to Chat with a pre-loaded query…",
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
    
    toast.info("Uploading Dataset", {
      description: `Uploading and processing ${file.name}...`,
      duration: 5000,
    });
    
    const { uploadDataset } = await import("@/lib/api");
    const result = await uploadDataset(file);
    e.target.value = ""; // Allow re-uploading
    
    if (result.success) {
      toast.success("Upload Complete!", { description: result.message, duration: 5000 });
      // Refresh UI by triggering a reload
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } else {
      toast.error("Upload Failed", { description: result.message, duration: 6000 });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Demo Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
              <Database className="h-3 w-3" /> Live Database Active
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time supply chain forecasting &amp; risk intelligence from database
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground text-xs font-semibold px-3 py-2 transition-colors cursor-pointer" title="Optionally import or update records">
            <Database className="h-3.5 w-3.5 text-primary" />
            Import / Sync Data
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleUploadDataset} />
          </label>
          <button
            id="demo-delay-btn"
            type="button"
            onClick={handleSimulateDelay}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-2 transition-colors"
          >
            <Mail className="h-3.5 w-3.5" />
            Simulate Supplier Delay
          </button>
          <button
            id="demo-agent-btn"
            type="button"
            onClick={handleRunAgent}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold px-3 py-2 transition-colors"
          >
            <Bot className="h-3.5 w-3.5" />
            Run Agent
          </button>
        </div>
      </div>

      {/* KPI Cards with count-up animation */}
      {kpis && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <KPICard
            label="Stockout Risk Count"
            value={kpis.stockoutRiskCount}
            borderColor={KPI_BORDER.stockout}
            icon={AlertTriangle}
          />
          <KPICard
            label="Excess Inventory Value"
            value={kpis.excessInventoryValue}
            formatted="currency"
            borderColor={KPI_BORDER.excess}
            icon={TrendingUp}
          />
          <KPICard
            label="Open POs"
            value={kpis.openPOCount}
            borderColor={KPI_BORDER.po}
            icon={ShoppingCart}
          />
          <KPICard
            label="Supplier Risk Score"
            value={kpis.supplierRiskScore}
            borderColor={KPI_BORDER.supplier}
            icon={AlertTriangle}
          />
        </div>
      )}

      {/* Main Grid: Chart + PO Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart */}
        <div className="lg:col-span-2">
          <Card className="shadow-sm h-full">
            <CardHeader className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 pb-2">
              <CardTitle className="text-base font-semibold">Inventory Forecast vs Actual</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {/* Model Toggles */}
                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md border text-xs">
                  <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-background rounded transition-colors">
                    <input type="checkbox" checked={showXGB} onChange={(e) => setShowXGB(e.target.checked)} className="accent-slate-500" />
                    XGBoost
                  </label>
                  <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-background rounded transition-colors">
                    <input type="checkbox" checked={showETS} onChange={(e) => setShowETS(e.target.checked)} className="accent-amber-500" />
                    ETS
                  </label>
                  <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-background rounded transition-colors">
                    <input type="checkbox" checked={showLSTM} onChange={(e) => setShowLSTM(e.target.checked)} className="accent-purple-500" />
                    LSTM
                  </label>
                </div>

                {/* Date Range Select */}
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue placeholder="Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1W">1 Week</SelectItem>
                    <SelectItem value="1M">1 Month</SelectItem>
                    <SelectItem value="ALL">All Time</SelectItem>
                  </SelectContent>
                </Select>

                {/* SKU Select */}
                <div className="w-36">
                  <Select value={selectedSku || "ALL"} onValueChange={(val) => { if (val) setSelectedSku(val); }}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select SKU" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueSkus.map((sku) => (
                        <SelectItem key={sku} value={sku} className="text-xs">
                          {sku === "ALL" ? "All Products" : sku}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/30" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      className="text-muted-foreground"
                      tickFormatter={(val) => val ? val.split("-").slice(1).join("/") : ""}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={15}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      className="text-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                      domain={['auto', 'auto']}
                      tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)}
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
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="ActualLevel"
                      name="Actual Level"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                      isAnimationActive
                      animationDuration={800}
                    />
                    {showXGB && (
                      <Line
                        type="monotone"
                        dataKey="ForecastedLevel"
                        name="XGBoost Forecast"
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        isAnimationActive
                        animationDuration={800}
                        animationBegin={200}
                      />
                    )}
                    {showETS && (
                      <Line
                        type="monotone"
                        dataKey="EtsForecastedLevel"
                        name="ETS Forecast"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="3 3"
                        dot={false}
                        isAnimationActive
                        animationDuration={800}
                        animationBegin={400}
                      />
                    )}
                    {showLSTM && (
                      <Line
                        type="monotone"
                        dataKey="LstmForecastedLevel"
                        name="LSTM Forecast"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        strokeDasharray="4 1 2"
                        dot={false}
                        isAnimationActive
                        animationDuration={800}
                        animationBegin={600}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* PO Queue Preview */}
        <div className="lg:col-span-1">
          <Card className="shadow-sm flex flex-col h-full">
            <CardHeader>
              <CardTitle className="text-base font-semibold">PO Approval Queue</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto space-y-3">
              {pos.slice(0, 5).map((po) => (
                <div key={po.id} className="p-3 border rounded-lg bg-card shadow-sm">
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="font-semibold text-sm">{po.sku}</span>
                    <Badge className={cn("text-xs", riskColorClass(po.riskLevel))}>{po.riskLevel}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mb-1.5 flex items-center justify-between">
                    <span className="truncate">Supplier: {po.supplier}</span>
                    {po.quotedByCall && (
                      <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">
                        AI Quoted
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center text-xs font-medium">
                    <span>Qty: {po.quantity.toLocaleString()} @ <span className="font-semibold text-foreground">${Number(po.unitCost).toFixed(2)}</span></span>
                    <span className="font-semibold">{formatCurrency(po.totalCost)}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Alerts Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Active Alerts
            {alerts.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">({alerts.length})</span>
            )}
          </CardTitle>
          <div className="w-44">
            <Select value={alertFilter} onValueChange={(val) => val && setAlertFilter(val)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risks</SelectItem>
                <SelectItem value="high">High Risk</SelectItem>
                <SelectItem value="medium">Medium Risk</SelectItem>
                <SelectItem value="low">Low Risk</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">SKU</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead>Days to Stockout</TableHead>
                <TableHead>Current vs Forecast</TableHead>
                <TableHead className="text-right pr-6">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAlerts.map((alert, idx) => (
                <TableRow
                  key={alert.id ?? `alert-${idx}`}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-all",
                    alert.id && newAlertIds.has(alert.id) &&
                      "animate-in fade-in-0 slide-in-from-top-2 duration-500 bg-red-500/5"
                  )}
                  onClick={() => setSelectedAlert(alert)}
                >
                  <TableCell className="font-medium pl-6">
                    <div>{alert.sku}</div>
                    <div className="text-xs text-muted-foreground">{alert.skuName}</div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs", riskColorClass(alert.riskLevel))}>
                      {alert.riskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {alert.daysUntilStockout != null ? (
                      <span className={alert.daysUntilStockout <= 5 ? "text-red-500 font-semibold" : ""}>
                        {alert.daysUntilStockout} days
                      </span>
                    ) : "N/A"}
                  </TableCell>
                  <TableCell>
                    <span>{(alert.currentStock ?? 0).toLocaleString()}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-red-500">{(alert.forecastedDemand ?? 0).toLocaleString()}</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs pr-6">
                    {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString() : "N/A"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Alert Detail Drawer */}
      <Sheet open={!!selectedAlert} onOpenChange={(open) => !open && setSelectedAlert(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Alert Details</SheetTitle>
            <SheetDescription>Actionable insights for {selectedAlert?.sku}</SheetDescription>
          </SheetHeader>
          {selectedAlert && (
            <div className="mt-6 space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Item Name</div>
                <div className="text-lg font-semibold">{selectedAlert.skuName}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-muted rounded-lg border">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Current Stock</div>
                  <div className="text-2xl font-bold">{selectedAlert.currentStock.toLocaleString()}</div>
                </div>
                <div className="p-4 bg-muted rounded-lg border">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Forecasted Demand</div>
                  <div className="text-2xl font-bold text-destructive">{selectedAlert.forecastedDemand.toLocaleString()}</div>
                </div>
              </div>
              <div className="p-4 border rounded-lg bg-card">
                <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  AI Recommendation
                </div>
                <p className="text-sm leading-relaxed">
                  Based on a {selectedAlert.daysUntilStockout}-day window until potential stockout,
                  an expedited purchase order is recommended. A draft PO has been generated in the PO Approval Queue.
                </p>
              </div>
              <div className="flex gap-2">
                <Badge className={cn("text-xs", riskColorClass(selectedAlert.riskLevel))}>
                  {selectedAlert.riskLevel} risk
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {selectedAlert.daysUntilStockout} days remaining
                </Badge>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
