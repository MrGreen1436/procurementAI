"use client";

import { useState } from "react";
import { parseSupplierEmail } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Sparkles, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const SAMPLE_EMAILS = [
  {
    title: "Beta Metals (7-Day Logistics Delay on SKU-001)",
    text: `Dear Procurement Team,

We regret to inform you that due to severe port congestion at the regional depot, the scheduled shipment of SKU-001 under purchase order ORD-9821 from Beta Metals (SUP-02) will be delayed by 7 days.

We sincerely apologize for this disruption and are expediting transit as soon as berths clear.

Best regards,
Beta Metals Operations Team`,
  },
  {
    title: "WireCo Global (10-Day Raw Material Shortage on SKU-002)",
    text: `URGENT NOTICE: Production Delay

Attention Procurement Manager,
Please be advised that delivery of SKU-002 from WireCo Global (SUP-01) is postponed by 10 days due to upstream copper rod delays. Ref order PO-8842.

Please contact your account representative to discuss safety stock buffers.

Regards,
WireCo Logistics`,
  },
  {
    title: "ChipTech Fab (14-Day Foundry Delay on SKU-003)",
    text: `Dear Partner,

Notice of supply lag: order ref ORD-4321 for SKU-003 will experience a 14-day delay due to scheduled re-tooling in our cleanroom facility.

We anticipate dispatch resumption by mid next week.

Warm regards,
ChipTech Fab Support`,
  },
];

interface EmailParserModalProps {
  onEmailParsed?: (result: any) => void;
  trigger?: React.ReactNode;
}

export function EmailParserModal({ onEmailParsed, trigger }: EmailParserModalProps) {
  const [open, setOpen] = useState(false);
  const [emailText, setEmailText] = useState(SAMPLE_EMAILS[0].text);
  const [loading, setLoading] = useState(false);
  const [parsedResult, setParsedResult] = useState<any | null>(null);

  const handleParse = async () => {
    if (!emailText.trim()) {
      toast.error("Please enter email text to parse.");
      return;
    }
    setLoading(true);
    try {
      const res = await parseSupplierEmail(emailText);
      setParsedResult(res);
      toast.success("Delay Email Processed!", {
        description: `Extracted ${res.delay_days}d delay for ${res.sku_id || "SKU"}. High-risk alert generated and replenishment triggered.`,
      });
      if (onEmailParsed) {
        try {
          onEmailParsed(res);
        } catch (callbackErr) {
          console.debug("onEmailParsed callback warning:", callbackErr);
        }
      }
    } catch (err: any) {
      toast.error("Failed to parse email", {
        description: err?.message || String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <span>Simulate Delay Email</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5 text-indigo-500" />
            Supplier Delay Email Ingestion
          </DialogTitle>
          <DialogDescription>
            Parses unstructured supplier delay notices, updates supplier lead times, generates high-risk stockout alerts, and broadcasts real-time updates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Quick preset chips */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Quick Sample Templates
            </label>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_EMAILS.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setEmailText(sample.text);
                    setParsedResult(null);
                  }}
                  className="text-xs px-2.5 py-1 rounded-md border bg-muted/50 hover:bg-accent text-left transition-colors font-medium text-foreground/80 hover:text-foreground"
                >
                  {sample.title}
                </button>
              ))}
            </div>
          </div>

          {/* Email Textarea */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Raw Supplier Email Body
            </label>
            <textarea
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              rows={7}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
              placeholder="Paste raw email text from supplier..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEmailText("");
                setParsedResult(null);
              }}
            >
              Clear
            </Button>
            <Button
              onClick={handleParse}
              disabled={loading}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Parsing & Disruption Analysis...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Parse & Dispatch Disruption</span>
                </>
              )}
            </Button>
          </div>

          {/* Extraction Result Card */}
          {parsedResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-2 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  <CheckCircle2 className="h-4 w-4" />
                  Extracted Disruption Impact
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-500 font-semibold border border-red-500/20">
                  Risk Alert Triggered
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                <div className="p-2 rounded bg-background border">
                  <span className="text-muted-foreground block">Supplier</span>
                  <span className="font-semibold text-foreground">{parsedResult.supplier_id || "Identified in text"}</span>
                </div>
                <div className="p-2 rounded bg-background border">
                  <span className="text-muted-foreground block">Affected SKU</span>
                  <span className="font-semibold text-foreground">{parsedResult.sku_id || "SKU-001"}</span>
                </div>
                <div className="p-2 rounded bg-background border">
                  <span className="text-muted-foreground block">Delay</span>
                  <span className="font-bold text-red-500">+{parsedResult.delay_days || 7} Days</span>
                </div>
              </div>

              <div className="text-xs text-foreground/85 pt-1">
                <span className="font-semibold">Summary: </span>
                {parsedResult.summary}
              </div>

              {parsedResult.new_lead_time_days && (
                <div className="text-xs text-muted-foreground">
                  New Adjusted Lead Time: <span className="font-semibold text-foreground">{parsedResult.new_lead_time_days} days</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
