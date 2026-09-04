"use client";

import { useEffect, useState, useRef } from "react";
import { Phone, PhoneCall, PhoneOff, RefreshCw, Zap, CheckCircle2, XCircle, Clock, Package, DollarSign, Truck, Activity, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ─────────────────────────────────────────────── */
interface CallLogEntry {
  id: string;
  sku_id: string;
  supplier_name: string;
  supplier_id: string;
  reason: string;
  status: "completed" | "failed";
  source: "simulation" | "real_call";
  price: number | null;
  transcription?: string | null;
  lead_time_days: number | null;
  availability: "in_stock" | "low_stock" | "unknown" | "call_placed";
  error?: string | null;
  timestamp: string;
  // Twilio-specific fields (present when source === "real_call")
  call_sid?: string | null;
  call_status?: string | null;
  called_number?: string | null;
}

interface InventoryAlert {
  sku: string;
  skuName: string;
  riskLevel: string;
  daysUntilStockout: number | null;
  currentStock: number;
  forecastedDemand: number;
}

/* ─── Helpers ─────────────────────────────────────────── */
const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(val);

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

const availabilityStyle = (a: string) => {
  if (a === "in_stock") return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  if (a === "low_stock") return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  return "bg-slate-500/15 text-slate-400 border border-slate-500/30";
};

const riskStyle = (r: string) => ({
  high: "bg-red-500/15 text-red-400 border border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
}[r] ?? "bg-slate-500/15 text-slate-400 border border-slate-500/30");

/* ─── Animated ring around phone icon while calling ─────── */
function CallingRing() {
  return (
    <span className="relative flex h-12 w-12">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-30"></span>
      <span className="relative inline-flex rounded-full h-12 w-12 bg-emerald-500/20 border border-emerald-500/50 items-center justify-center">
        <PhoneCall className="h-5 w-5 text-emerald-400" />
      </span>
    </span>
  );
}

/* ─── Stat pill ─────────────────────────────────────────── */
function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={cn("px-4 py-2 rounded-xl border text-center", color)}>
      <div className="text-xs opacity-70 font-medium mb-0.5">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────── */
export default function OutreachPage() {
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [callReason, setCallReason] = useState<string>("Urgent reorder — stock below threshold");
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<CallLogEntry | null>(null);
  const [callPhoneStatus, setCallPhoneStatus] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Fetch initial data */
  useEffect(() => {
    // Fetch risk alerts to populate SKU picker
    fetch("http://127.0.0.1:8000/risk/alerts")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        const normalized = data.map((d: any) => ({
          sku: d.sku_id || d.sku || "SKU-001",
          skuName: d.sku_id || d.sku || "Product",
          riskLevel: d.risk_level || d.riskLevel || "high",
          daysUntilStockout: d.predicted_stockout_date ? Math.max(1, Math.round((new Date(d.predicted_stockout_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 5,
          currentStock: d.current_stock ?? 120,
          forecastedDemand: d.forecasted_demand ?? 350,
          reason: d.reason || "High stockout risk detected by AI forecasting",
        }));
        setAlerts(normalized);
        if (normalized.length > 0) {
          setSelectedSku(normalized[0].sku);
          setCallReason(normalized[0].reason);
        }
      })
      .catch(() => {});

    // Fetch existing call log
    fetchLog();

    // WebSocket for live updates
    const ws = new WebSocket("ws://127.0.0.1:8000/ws");
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "SUPPLIER_CALL_COMPLETED") {
          fetchLog();
          if (msg.payload?.price != null || msg.payload?.transcription) {
            setLastResult((prev) =>
              prev
                ? {
                    ...prev,
                    price: msg.payload.price ?? prev.price,
                    transcription: msg.payload.transcription ?? prev.transcription,
                    status: "completed",
                    availability: "in_stock",
                  }
                : prev
            );
            setCallPhoneStatus("completed");
          }
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const fetchLog = () => {
    fetch("http://127.0.0.1:8000/supplier-calls/log")
      .then((r) => r.ok ? r.json() : [])
      .then(setCallLog)
      .catch(() => {});
  };

  /* Poll real call status every 3 s until it resolves */
  const startStatusPolling = (callSid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setCallPhoneStatus("queued");
    const TERMINAL = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:8000/supplier-calls/status/${callSid}`);
        if (!r.ok) return;
        const s = await r.json();
        setCallPhoneStatus(s.status ?? null);
        if (TERMINAL.has(s.status)) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          fetchLog();
        }
      } catch { /* ignore polling errors */ }
    }, 3000);
  };

  /* Trigger a call */
  const handleCall = async () => {
    if (!selectedSku || isCalling) return;
    setIsCalling(true);
    setLastResult(null);
    setCallPhoneStatus(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    try {
      const res = await fetch("http://127.0.0.1:8000/supplier-calls/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku_id: selectedSku, reason: callReason }),
      });
      const data: CallLogEntry = await res.json();
      setLastResult(data);
      fetchLog();
      // If a real Twilio call was placed, start polling for live status
      if (data.source === "real_call" && data.call_sid) {
        startStatusPolling(data.call_sid);
      }
    } catch (err) {
      setLastResult({
        id: "err",
        sku_id: selectedSku,
        supplier_name: "—",
        supplier_id: "—",
        reason: callReason,
        status: "failed",
        source: "simulation",
        price: null,
        lead_time_days: null,
        availability: "unknown",
        error: "Network error — could not reach backend. Is the server running?",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsCalling(false);
    }
  };

  /* Summary stats */
  const totalCalls = callLog.length;
  const completedCalls = callLog.filter((c) => c.status === "completed").length;
  const avgPrice =
    callLog.filter((c) => c.price != null).length > 0
      ? callLog.filter((c) => c.price != null).reduce((acc, c) => acc + (c.price ?? 0), 0) /
        callLog.filter((c) => c.price != null).length
      : 0;
  const inStockPct =
    totalCalls > 0
      ? Math.round((callLog.filter((c) => c.availability === "in_stock").length / totalCalls) * 100)
      : 0;

  const selectedAlert = alerts.find((a) => a.sku === selectedSku);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supplier Outreach</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered autonomous voice calls to suppliers for real-time quotes & availability
          </p>
        </div>
        <div className="flex items-center gap-2">
          {wsConnected ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <Wifi className="h-3 w-3" /> Live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-500/10 border border-slate-500/20 px-3 py-1.5 rounded-full">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatPill label="Total Calls" value={totalCalls} color="bg-blue-500/10 border-blue-500/20 text-blue-400" />
        <StatPill label="Completed" value={completedCalls} color="bg-emerald-500/10 border-emerald-500/20 text-emerald-400" />
        <StatPill label="Avg. Quote Price" value={avgPrice > 0 ? formatCurrency(avgPrice) : "—"} color="bg-violet-500/10 border-violet-500/20 text-violet-400" />
        <StatPill label="In-Stock Rate" value={totalCalls > 0 ? `${inStockPct}%` : "—"} color="bg-amber-500/10 border-amber-500/20 text-amber-400" />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Call Control Panel (left 1/3) ── */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card shadow-sm p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30">
                <Phone className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">Initiate AI Call</h2>
                <p className="text-xs text-muted-foreground">Select a high-risk SKU and trigger an outbound call</p>
              </div>
            </div>

            {/* SKU Picker */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">At-Risk SKU</label>
              <select
                value={selectedSku}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedSku(val);
                  const matched = alerts.find((a: any) => a.sku === val);
                  if (matched && (matched as any).reason) {
                    setCallReason((matched as any).reason);
                  }
                }}
                className="w-full h-9 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {alerts.length === 0 && <option value="">Loading alerts…</option>}
                {alerts.map((a, i) => (
                  <option key={a.sku ?? i} value={a.sku}>
                    {a.sku} — {a.riskLevel.toUpperCase()} Risk
                  </option>
                ))}
              </select>
            </div>

            {/* Call Reason */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Call Reason</label>
              <textarea
                value={callReason}
                onChange={(e) => setCallReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
              />
            </div>

            {/* SKU Context */}
            {selectedAlert && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
                <div className="font-semibold text-muted-foreground mb-1">SKU Context</div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Risk</span>
                  <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", riskStyle(selectedAlert.riskLevel))}>
                    {selectedAlert.riskLevel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Stock</span>
                  <span className="font-semibold">{(selectedAlert.currentStock ?? 0).toLocaleString()} units</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">30-day Forecast</span>
                  <span className="font-semibold text-red-400">{(selectedAlert.forecastedDemand ?? 0).toLocaleString()} units</span>
                </div>
                {selectedAlert.daysUntilStockout != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Days to Stockout</span>
                    <span className={cn("font-bold", selectedAlert.daysUntilStockout <= 7 ? "text-red-400" : "text-amber-400")}>
                      {selectedAlert.daysUntilStockout}d
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Call Button */}
            <button
              type="button"
              onClick={handleCall}
              disabled={isCalling || !selectedSku}
              className={cn(
                "w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-semibold text-sm transition-all duration-200",
                isCalling
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 cursor-not-allowed"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 active:scale-95"
              )}
            >
              {isCalling ? (
                <>
                  <span className="h-4 w-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  Connecting…
                </>
              ) : (
                <>
                  <PhoneCall className="h-4 w-4" />
                  Initiate AI Call
                </>
              )}
            </button>
          </div>

          {/* Last Call Result Card */}
          {lastResult && (
            <div className={cn(
              "rounded-xl border p-5 space-y-3 shadow-sm transition-all",
              lastResult.status === "completed"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {lastResult.status === "completed"
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    : <XCircle className="h-5 w-5 text-red-400" />}
                  <span className="font-semibold text-sm">
                    {lastResult.source === "real_call" ? "📞 Real Twilio Call" : "🤖 Simulated Call"}
                    {" — "}
                    {lastResult.status === "completed" ? "Initiated" : "Failed"}
                  </span>
                </div>
                {/* Live call status badge */}
                {callPhoneStatus && (
                  <span className={cn(
                    "text-xs font-medium px-2.5 py-1 rounded-full border",
                    callPhoneStatus === "completed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                    callPhoneStatus === "in-progress" ? "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse" :
                    callPhoneStatus === "ringing" ? "bg-amber-500/15 text-amber-400 border-amber-500/30 animate-pulse" :
                    callPhoneStatus === "failed" || callPhoneStatus === "busy" || callPhoneStatus === "no-answer"
                      ? "bg-red-500/15 text-red-400 border-red-500/30"
                      : "bg-slate-500/15 text-slate-400 border-slate-500/30"
                  )}>
                    {callPhoneStatus === "ringing" ? "📲 Ringing…" :
                     callPhoneStatus === "in-progress" ? "🔊 In Progress" :
                     callPhoneStatus === "completed" ? "✅ Completed" :
                     callPhoneStatus === "busy" ? "📵 Busy" :
                     callPhoneStatus === "no-answer" ? "📵 No Answer" :
                     callPhoneStatus === "failed" ? "❌ Failed" :
                     callPhoneStatus}
                  </span>
                )}
              </div>

              {/* Real call status & numbers */}
              {lastResult.source === "real_call" && (
                <div className="space-y-2 text-xs">
                  {lastResult.called_number && (
                    <div className="flex justify-between items-center bg-background/50 rounded-lg px-3 py-2">
                      <span className="text-muted-foreground">Called Number</span>
                      <span className="font-mono font-semibold">{lastResult.called_number}</span>
                    </div>
                  )}
                  {lastResult.call_sid && (
                    <div className="flex justify-between items-center bg-background/50 rounded-lg px-3 py-2">
                      <span className="text-muted-foreground">Call SID</span>
                      <span className="font-mono text-xs text-muted-foreground truncate ml-2">{lastResult.call_sid}</span>
                    </div>
                  )}
                  {lastResult.price == null && (
                    <p className="text-emerald-400/80 text-xs px-1">
                      ✅ Phone is ringing. The AI will ask for the unit price and record the spoken quote in real-time.
                    </p>
                  )}
                </div>
              )}

              {/* Recorded Price & Quote Details */}
              {lastResult.status === "completed" && (lastResult.price != null || lastResult.transcription) && (
                <div className="space-y-2">
                  {lastResult.price != null && (
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-center">
                      <div className="text-xs text-emerald-400/80 mb-0.5 font-semibold">Recorded Negotiated Price</div>
                      <div className="text-2xl font-black text-emerald-400">
                        {formatCurrency(lastResult.price)} <span className="text-xs font-normal text-muted-foreground">/ unit</span>
                      </div>
                    </div>
                  )}
                  {lastResult.transcription && (
                    <div className="rounded-lg bg-background/70 border p-2.5 space-y-1">
                      <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Spoken Transcript (Twilio ASR)</div>
                      <div className="text-xs italic text-foreground">"{lastResult.transcription}"</div>
                    </div>
                  )}
                </div>
              )}

              {lastResult.error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{lastResult.error}</p>
              )}
              <div className="text-xs text-muted-foreground">
                Supplier: <span className="font-medium">{lastResult.supplier_name}</span>
                {" · "}{formatTime(lastResult.timestamp)}
              </div>
            </div>
          )}

        </div>

        {/* ── Call Log Table (right 2/3) ── */}
        <div className="lg:col-span-2 rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Call History</h2>
              {totalCalls > 0 && (
                <span className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">{totalCalls}</span>
              )}
            </div>
            <button
              type="button"
              onClick={fetchLog}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          {callLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <div className="p-4 rounded-full bg-muted/50 border">
                <Phone className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No calls yet</p>
              <p className="text-xs text-muted-foreground/60">Select a SKU and press "Initiate AI Call" to begin</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-[620px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left px-5 py-3 font-semibold">SKU / Supplier</th>
                    <th className="text-left px-3 py-3 font-semibold">Reason</th>
                    <th className="text-right px-3 py-3 font-semibold">Quote</th>
                    <th className="text-center px-3 py-3 font-semibold">Lead</th>
                    <th className="text-center px-3 py-3 font-semibold">Stock</th>
                    <th className="text-center px-3 py-3 font-semibold">Status</th>
                    <th className="text-right px-5 py-3 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {callLog.map((call, idx) => (
                    <tr
                      key={call.id}
                      className={cn(
                        "hover:bg-muted/30 transition-colors",
                        idx === 0 && "animate-in fade-in-0 slide-in-from-top-1 duration-300"
                      )}
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-sm">{call.sku_id}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[140px]">{call.supplier_name}</div>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="text-xs text-muted-foreground truncate block max-w-[150px]" title={call.reason}>
                          {call.reason}
                        </span>
                        {call.transcription && (
                          <span className="text-[11px] text-emerald-400/90 truncate block max-w-[150px] italic mt-0.5" title={`Spoken: "${call.transcription}"`}>
                            💬 "{call.transcription}"
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <span className={cn("font-semibold tabular-nums block", call.price != null ? "text-emerald-400" : "text-muted-foreground")}>
                          {call.price != null ? formatCurrency(call.price) : "—"}
                        </span>
                        {call.source === "real_call" && (
                          <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-tight">Twilio Voice</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <span className="text-xs font-medium">
                          {call.lead_time_days != null ? `${call.lead_time_days}d` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", availabilityStyle(call.availability))}>
                          {call.availability.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {call.status === "completed" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" /> Done
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                            <XCircle className="h-3 w-3" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                        <div>{formatDate(call.timestamp)}</div>
                        <div>{formatTime(call.timestamp)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
