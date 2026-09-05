"use client";

import { useState } from "react";
import { simulateDeliveryDelay } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  DollarSign,
  Package,
  Clock,
  Building2,
  ArrowRight,
  ShieldAlert,
  Layers,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SAMPLE_EMAILS = [
  {
    title: "WireCo Global (7-Day Shipment Delay on Material P0001)",
    sku: "P0001",
    delay: 7,
    text: `URGENT NOTICE: Shipment Delay Notification

Dear Procurement Operations,

Please be advised that the scheduled delivery of Material P0001 (Ref PO-AUTO-P0001) from WireCo Global (SUP-01) is postponed by 7 days due to regional port container congestion and transport backlogs.

Original scheduled arrival: in 5 days.
Updated estimated dispatch: +7 days delayed.

Please activate safety buffers or alternate warehousing reserves.

Sincerely,
Logistics Dispatch, WireCo Global`,
  },
  {
    title: "Steel Dynamics (10-Day Mill Delay on Material P0002)",
    sku: "P0002",
    delay: 10,
    text: `Attention: Procurement Manager

We regret to advise that our primary mill line underwent emergency calibration. Consequently, delivery for Material P0002 under order PO-P0002 is delayed by 10 days.

We apologize for the inconvenience and are working around the clock to expedite shipping.

Best regards,
Steel Dynamics Operations Team`,
  },
  {
    title: "Apex Logistics (14-Day Disruption on Material P0004)",
    sku: "P0004",
    delay: 14,
    text: `SUPPLY CHAIN ALERT: Transit Postponement

Dear Partner,
Due to unseasonal monsoon weather impacting arterial transit corridors, scheduled delivery of Material P0004 will face a 14-day delay.

Safety stock review is recommended immediately.

Warm regards,
Apex Logistics Supply Chain`,
  },
];

interface EmailParserModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onEmailParsed?: (result: any) => void;
  trigger?: React.ReactElement;
}

export function EmailParserModal({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onEmailParsed,
  trigger,
}: EmailParserModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (isControlled && setControlledOpen) {
      setControlledOpen(val);
    } else {
      setInternalOpen(val);
    }
  };

  const [emailText, setEmailText] = useState(SAMPLE_EMAILS[0].text);
  const [selectedSku, setSelectedSku] = useState("P0001");
  const [customDelay, setCustomDelay] = useState<number>(7);
  const [loading, setLoading] = useState(false);
  const [simResult, setSimResult] = useState<any | null>(null);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

  const handleSimulate = async () => {
    if (!emailText.trim()) {
      toast.error("Please enter email text to simulate.");
      return;
    }
    setLoading(true);
    try {
      const res = await simulateDeliveryDelay({
        raw_email_text: emailText,
        sku_id: selectedSku,
        delay_days: customDelay,
      });
      setSimResult(res);
      toast.success("Delivery Delay Simulated!", {
        description: `Delay of ${res.delay_days}d for ${res.sku_id} analyzed against live database.`,
      });
      if (onEmailParsed) {
        try {
          onEmailParsed(res);
        } catch (callbackErr) {
          console.debug("onEmailParsed error:", callbackErr);
        }
      }
    } catch (err: any) {
      toast.error("Failed to simulate delivery delay", {
        description: err?.message || String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="sm:max-w-[840px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Mail className="h-5 w-5 text-red-500" />
            Supplier Delay Email & Delivery Impact Simulation
          </DialogTitle>
          <DialogDescription>
            Simulate a supplier shipment delay from incoming email notices. The engine parses the delay, queries live database inventory and replenishment orders, and projects the comparative <strong>On-Time Delivery vs. Delayed Delivery</strong> inventory curves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Quick preset chips */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Quick Sample Delay Emails
            </label>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_EMAILS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setEmailText(sample.text);
                    setSelectedSku(sample.sku);
                    setCustomDelay(sample.delay);
                    setSimResult(null);
                  }}
                  className={cn(
                    "text-xs px-2.5 py-1.5 rounded-lg border text-left transition-all font-medium",
                    selectedSku === sample.sku && customDelay === sample.delay
                      ? "border-red-500/60 bg-red-500/10 text-red-500 font-semibold"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {sample.title}
                </button>
              ))}
            </div>
          </div>

          {/* Email Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Raw Supplier Email Body
              </label>
              <span className="text-[11px] text-muted-foreground">
                AI extracts Material ID and delay days automatically
              </span>
            </div>
            <textarea
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-input bg-muted/20 px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-mono"
              placeholder="Paste raw email notice from supplier..."
            />
          </div>

          {/* Actions & Simulation Trigger */}
          <div className="flex items-center justify-between pt-1 border-b pb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEmailText("");
                setSimResult(null);
              }}
            >
              Clear Text
            </Button>
            <Button
              onClick={handleSimulate}
              disabled={loading}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white shadow-md font-semibold text-xs px-4 py-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Calculating Dynamic Delivery Curves...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Simulate Delay &amp; Compute Impact Graph</span>
                </>
              )}
            </Button>
          </div>

          {/* Dynamic Result & Graph Section */}
          {simResult && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* Top Impact KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Clock className="h-3.5 w-3.5 text-red-500" /> Delay Duration
                  </div>
                  <div className="text-xl font-bold text-red-500 mt-1">
                    +{simResult.delay_days} Days
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Arrives Day {simResult.delayed_arrival_day} (was Day {simResult.scheduled_arrival_day})
                  </div>
                </div>

                <div className="p-3 rounded-xl border bg-card">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Stockout Risk Day
                  </div>
                  <div className="text-xl font-bold text-foreground mt-1">
                    {simResult.delayed_stockout_day !== null ? `Day ${simResult.delayed_stockout_day}` : "Safe Buffer"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Duration: {simResult.stockout_duration_days} days stockout
                  </div>
                </div>

                <div className="p-3 rounded-xl border bg-card">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Package className="h-3.5 w-3.5 text-blue-500" /> Shortage Units
                  </div>
                  <div className="text-xl font-bold text-foreground mt-1">
                    {Math.round(simResult.shortage_units).toLocaleString()}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Unsatisfied customer demand
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" /> Financial Revenue Risk
                  </div>
                  <div className="text-xl font-bold text-emerald-500 mt-1">
                    {formatCurrency(simResult.financial_impact)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    At ${simResult.unit_price.toFixed(2)}/unit
                  </div>
                </div>
              </div>

              {/* Delivery Delay Impact Comparison Graph */}
              <div className="p-4 rounded-xl border bg-card/60 backdrop-blur-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-2.5">
                  <div>
                    <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-red-500" />
                      Inventory Trajectory: On-Time vs. Delayed Delivery
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      30-day dynamic projection for {simResult.sku_name} based on real database consumption and incoming replenishment PO ({simResult.replenishment_quantity.toLocaleString()} units)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      ● On-Time Delivery
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                      --- Delayed Delivery
                    </span>
                  </div>
                </div>

                {/* Recharts Container */}
                <div className="h-72 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={simResult.graph_data}
                      margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.6} />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        interval={3}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "0.75rem",
                          fontSize: "12px",
                          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4)",
                        }}
                        formatter={(val: any, name: any) => {
                          const label =
                            name === "onTimeInventory"
                              ? "On-Time Delivery Stock"
                              : name === "delayedInventory"
                              ? "Delayed Delivery Stock"
                              : name === "reorderThreshold"
                              ? "Safety Threshold"
                              : name;
                          return [`${Number(val).toLocaleString()} units`, label];
                        }}
                        labelFormatter={(label, items) => {
                          const pt = items?.[0]?.payload;
                          let note = `Date: ${label} (Day ${pt?.day})`;
                          if (pt?.shipmentOnTime > 0) note += ` • [On-Time Shipment Arrived: +${pt.shipmentOnTime.toLocaleString()}]`;
                          if (pt?.shipmentDelayed > 0) note += ` • [Delayed Shipment Arrived: +${pt.shipmentDelayed.toLocaleString()}]`;
                          if (pt?.isStockout) note += ` • ⚠️ [STOCKOUT DEFICIT ACTIVE]`;
                          return note;
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        formatter={(value) => (
                          <span className="text-xs font-semibold text-foreground mr-3">
                            {value === "onTimeInventory"
                              ? "On-Time Delivery Stock"
                              : value === "delayedInventory"
                              ? "Delayed Delivery Stock"
                              : value === "reorderThreshold"
                              ? "Safety Threshold"
                              : value}
                          </span>
                        )}
                      />
                      {/* Safety Stock / Reorder Threshold Line */}
                      <ReferenceLine
                        y={simResult.reorder_threshold}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        label={{
                          value: `Safety Level (${simResult.reorder_threshold})`,
                          fill: "#f59e0b",
                          fontSize: 10,
                          position: "insideTopRight",
                        }}
                      />
                      {/* On-Time Curve (Solid Emerald) */}
                      <Line
                        type="monotone"
                        dataKey="onTimeInventory"
                        name="onTimeInventory"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, fill: "#10b981" }}
                      />
                      {/* Delayed Curve (Dashed Rose) */}
                      <Line
                        type="monotone"
                        dataKey="delayedInventory"
                        name="delayedInventory"
                        stroke="#ef4444"
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={false}
                        activeDot={{ r: 5, fill: "#ef4444" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Explanation Banner */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs">
                  <ShieldAlert className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-red-500">Delay Impact Summary: </span>
                    <span className="text-foreground">{simResult.summary}</span>
                  </div>
                </div>

                {/* Warehouse Transfer Mitigation Options */}
                {simResult.transfers_available && simResult.transfers_available.length > 0 && (
                  <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                        Available Surplus Warehouse Transfers (Cost-Optimized Mitigation)
                      </span>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
                        Zero Procurement Cost
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      {simResult.transfers_available.map((t: any, idx: number) => (
                        <div key={idx} className="p-2 rounded bg-card border flex items-center justify-between">
                          <div>
                            <div className="font-bold text-foreground">{t.store_id}</div>
                            <div className="text-[11px] text-muted-foreground">Available: {t.available_qty}</div>
                          </div>
                          <span className="text-xs font-semibold text-emerald-500">
                            +{t.surplus} surplus
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
