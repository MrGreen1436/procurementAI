"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchKPIs, fetchAlerts, fetchInventoryHistory, fetchPOs, fetchSupplierRiskPanel, fetchAuditTrail } from "@/lib/api";
import { KPISummary, Alert, InventoryPoint, PurchaseOrder, RiskLevel, SupplierRisk, AuditLog } from "@/types";
import { useCountUp } from "@/lib/useCountUp";
import { toast } from "sonner";
import { UploadCSVButton } from "@/components/UploadCSVButton";

// shadcn UI
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Recharts
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// Lucide
import { AlertTriangle, Bot, Mail, TrendingUp, ShoppingCart, Activity } from "lucide-react";

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
  isHero = false,
  isHighRisk = false,
}: {
  label: string;
  value: number;
  formatted?: string;
  borderColor: string;
  icon: React.ElementType;
  isHero?: boolean;
  isHighRisk?: boolean;
}) {
  const animated = useCountUp(value, 1200);
  const display = formatted
    ? formatCurrency(animated * (value / Math.max(1, value)))  // keeps proportional if formatted
    : animated;

  // For currency we do a simpler linear scale
  const currencyAnimated = useCountUp(Math.round(value), 1200);

  return (
    <Card className={cn(
      "shadow-sm transition-all relative overflow-hidden",
      isHero ? "border-l-4 lg:col-span-2 bg-card/80 border-primary shadow-[0_0_15px_rgba(255,182,39,0.15)]" : cn("border-t-4", borderColor)
    )}>
      {isHero && (
        <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
      )}
      <CardHeader className="pb-2 flex flex-row items-center justify-between relative z-10">
        <CardTitle className={cn(
          "font-medium", 
          isHero ? "text-base text-primary/90 font-heading" : "text-sm text-muted-foreground"
        )}>{label}</CardTitle>
        <Icon className={cn("h-4 w-4", isHero ? "text-primary/80" : "text-muted-foreground")} />
      </CardHeader>
      <CardContent className="relative z-10">
        <div className={cn(
          "font-bold tabular-nums font-heading tracking-tight",
          isHero ? "text-5xl text-glow-primary text-foreground" : "text-3xl",
          isHighRisk && !isHero && "text-glow-red text-destructive"
        )}>
          {formatted
            ? formatCurrency(currencyAnimated)
            : animated}
          {label === "Supplier Risk Score" && (
            <span className={cn("font-normal", isHero ? "text-2xl text-muted-foreground/60 ml-1" : "text-lg text-muted-foreground")}>/100</span>
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
  const [supplierRisks, setSupplierRisks] = useState<SupplierRisk[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [selectedSku, setSelectedSku] = useState<string>("SKU-LITH-007");
  const [alertFilter, setAlertFilter] = useState<string>("all");
  const [newAlertIds, setNewAlertIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchKPIs().then(setKpis);
    fetchAlerts().then(setAlerts);
    fetchInventoryHistory().then(setHistory);
    fetchPOs().then(setPOs);
    fetchSupplierRiskPanel().then(setSupplierRisks);
    fetchAuditTrail().then(setAuditLogs);
  }, []);

  const chartData = history
    .filter((h) => h.sku === selectedSku)
    .map((h) => ({
      date: h.date,
      ActualLevel: h.actualLevel,
      ForecastedLevel: h.forecastedLevel,
    }))
    .reverse();

  const uniqueSkus = Array.from(new Set(history.map((h) => h.sku)));

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

  return (
    <div className="space-y-6">
      {/* Header + Demo Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold tracking-tight font-heading">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time supply chain forecasting &amp; risk intelligence
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <UploadCSVButton />
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

      {/* KPI Cards & Supplier Risk Panel */}
      {kpis && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
          {/* Supplier Risk Panel (Hero) */}
          <Card className="col-span-1 sm:col-span-2 lg:col-span-2 shadow-[0_0_15px_rgba(255,182,39,0.15)] border-l-4 border-primary bg-card/80 overflow-hidden relative">
            <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
            <CardHeader className="pb-3 relative z-10 border-b border-border/50">
              <CardTitle className="text-base text-primary/90 font-heading flex items-center justify-between">
                Supplier Risk Breakdown
                <Activity className="h-4 w-4 text-primary/80" />
              </CardTitle>
            </CardHeader>
            <CardContent className="relative z-10 p-0">
              {supplierRisks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b-border/30">
                      <TableHead className="text-xs">Supplier</TableHead>
                      <TableHead className="text-xs">Risk</TableHead>
                      <TableHead className="text-xs text-right">Avg Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplierRisks.map((s) => (
                      <TableRow key={s.supplierId} className="border-b-border/30">
                        <TableCell className="font-medium text-sm">
                          {s.supplierName}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              s.riskPct > 50 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" : s.riskPct > 20 ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                            )} />
                            <span className="text-xs">{s.riskPct.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {formatCurrency(s.avgOrderAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  No active supplier risks detected.
                </div>
              )}
            </CardContent>
          </Card>

          <KPICard
            label="Stockout Risk Count"
            value={kpis.stockoutRiskCount}
            borderColor={KPI_BORDER.stockout}
            icon={AlertTriangle}
            isHighRisk={kpis.stockoutRiskCount > 0}
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
        </div>
      )}

      {/* Main Grid: Chart + PO Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart */}
        <div className="lg:col-span-2">
          <Card className="shadow-sm h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">Inventory Forecast vs Actual</CardTitle>
              <div className="w-56">
                <Select value={selectedSku} onValueChange={(val) => val && setSelectedSku(val)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select SKU" />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueSkus.map((sku) => (
                      <SelectItem key={sku} value={sku} className="text-xs">
                        {sku}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                      tickFormatter={(val) => val.split("-").slice(1).join("/")}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      className="text-muted-foreground"
                      axisLine={false}
                      tickLine={false}
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
                    <Line
                      type="monotone"
                      dataKey="ForecastedLevel"
                      name="Forecasted Level"
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      isAnimationActive
                      animationDuration={800}
                      animationBegin={200}
                    />
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
              {pos.length > 0 ? (
                pos.slice(0, 5).map((po) => (
                  <div key={po.id} className="p-3 border rounded-lg bg-card shadow-sm">
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="font-semibold text-sm">{po.sku}</span>
                      <Badge className={cn("text-xs", riskColorClass(po.riskLevel))}>{po.riskLevel}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">Supplier: {po.supplier}</div>
                    <div className="flex justify-between text-xs font-medium">
                      <span>Qty: {po.quantity.toLocaleString()}</span>
                      <span>{formatCurrency(po.totalCost)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No pending purchase orders.
                </div>
              )}
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
              {filteredAlerts.length > 0 ? (
                filteredAlerts.map((alert) => (
                  <TableRow
                    key={alert.id}
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 transition-all",
                      newAlertIds.has(alert.id) &&
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
                        <span className={alert.daysUntilStockout <= 5 ? "text-glow-red text-destructive font-bold" : ""}>
                          {alert.daysUntilStockout} days
                        </span>
                      ) : "N/A"}
                    </TableCell>
                    <TableCell>
                      <span>{alert.currentStock.toLocaleString()}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-red-500">{alert.forecastedDemand.toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs pr-6">
                      {new Date(alert.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                    No active alerts found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Audit Trail Feed */}
      <Card className="shadow-sm border-t-4 border-t-primary/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold font-heading flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Live Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-64 overflow-y-auto">
            {auditLogs.length > 0 ? (
              <div className="divide-y divide-border/50">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-4 hover:bg-muted/30 transition-colors flex items-start gap-3">
                    <div className="mt-1">
                      <div className="w-2 h-2 rounded-full bg-primary/70 ring-4 ring-primary/10" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">
                        {log.details || `${log.actionType} on ${log.entityType} ${log.entityId}`}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-primary/80">{log.performedBy}</span>
                        <span>•</span>
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
                <Activity className="h-8 w-8 opacity-20" />
                <p className="text-sm">Awaiting agent activity...</p>
              </div>
            )}
          </div>
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
