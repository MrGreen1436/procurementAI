"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Phone, PhoneCall, DollarSign, MessageSquare, RefreshCw, ArrowLeft, CheckCircle, XCircle, Clock } from "lucide-react";
import Link from "next/link";

interface CallQuote {
  id: number;
  supplier_name: string;
  phone_number: string;
  item_name: string;
  raw_transcript: string | null;
  extracted_price: number | null;
  call_sid: string;
  created_at: string;
}

const TWILIO_BASE = "/backend-voice";

export default function CallLogsPage() {
  const [quotes, setQuotes] = useState<CallQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<CallQuote | null>(null);

  const loadQuotes = useCallback(() => {
    setLoading(true);
    fetch(`${TWILIO_BASE}/quotes`)
      .then((r) => r.json())
      .then((data: CallQuote[]) => {
        setQuotes(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadQuotes();
    // Auto-refresh every 15 s so live demo shows new calls coming in
    const id = setInterval(loadQuotes, 15000);
    return () => clearInterval(id);
  }, [loadQuotes]);

  const totalCalls = quotes.length;
  const successfulExtract = quotes.filter((q) => q.extracted_price !== null).length;
  const avgPrice =
    successfulExtract > 0
      ? quotes.filter((q) => q.extracted_price !== null).reduce((s, q) => s + (q.extracted_price ?? 0), 0) /
        successfulExtract
      : null;
  const latestCall = quotes[0]?.created_at ?? null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-[#8B87A0] hover:text-[#FFB627] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          </div>
          <h1 className="text-3xl font-bold font-heading text-[#F5F1E8] tracking-tight flex items-center gap-3">
            <PhoneCall className="w-8 h-8 text-[#FFB627]" />
            Supplier Call Log & Transcripts
          </h1>
          <p className="text-sm text-[#8B87A0] mt-1">
            Live record of every automated outbound call — supplier name, item, AI-extracted price quote, and raw transcript.
          </p>
        </div>
        <button
          onClick={loadQuotes}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1C1E2B] hover:bg-[#262838] border border-[#262838] text-xs font-semibold text-[#F5F1E8] transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#FFB627]" : ""}`} />
          Refresh
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8B87A0] mb-1">Total Calls</div>
          <div className="text-2xl font-bold text-[#F5F1E8]">{totalCalls}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8B87A0] mb-1">Prices Extracted</div>
          <div className="text-2xl font-bold text-[#34D399]">{successfulExtract}</div>
        </div>
        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8B87A0] mb-1">Avg Quote</div>
          <div className="text-2xl font-bold text-[#FFB627]">
            {avgPrice !== null ? `$${avgPrice.toFixed(0)}` : "—"}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8B87A0] mb-1">Last Call</div>
          <div className="text-sm font-semibold text-[#F5F1E8] truncate">
            {latestCall
              ? new Date(latestCall).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl bg-[#14151F] border border-[#262838] shadow-[0_8px_32px_rgba(0,0,0,0.35)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#262838]">
          <div className="flex items-center gap-2.5">
            <Phone className="w-4 h-4 text-[#FFB627]" />
            <h2 className="text-sm font-semibold text-[#F5F1E8]">Call Records</h2>
            {quotes.length > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FFB627]/10 text-[#FFB627] border border-[#FFB627]/25">
                {quotes.length} calls
              </span>
            )}
          </div>
          <span className="text-[10px] text-[#8B87A0]">Auto-refreshes every 15s</span>
        </div>

        {loading && quotes.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#8B87A0]">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-[#FFB627]" />
            Loading call records…
          </div>
        ) : quotes.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#8B87A0]">
            <Phone className="w-8 h-8 mx-auto mb-3 opacity-40" />
            No calls recorded yet. Trigger a call from the Decision Engine.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#262838]">
                  {["Time", "Supplier", "Item", "Transcript", "Extracted Price", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8B87A0]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotes.map((q, i) => (
                  <tr
                    key={q.id}
                    onClick={() => setSelectedRow(selectedRow?.id === q.id ? null : q)}
                    className={`border-b border-[#262838]/60 cursor-pointer transition-colors hover:bg-[#1C1E2B] ${
                      selectedRow?.id === q.id ? "bg-[#1C1E2B]" : i % 2 === 0 ? "bg-transparent" : "bg-[#0E0F17]/40"
                    }`}
                  >
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-xs text-[#8B87A0]">
                        <Clock className="w-3 h-3" />
                        {new Date(q.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-[#F5F1E8] text-xs">{q.supplier_name}</div>
                      <div className="text-[10px] text-[#8B87A0] font-mono mt-0.5">{q.phone_number}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-xs font-medium text-[#7DD3C0]">{q.item_name}</span>
                    </td>
                    <td className="px-5 py-4 max-w-xs">
                      {q.raw_transcript ? (
                        <div className="flex items-start gap-1.5">
                          <MessageSquare className="w-3 h-3 text-[#8B87A0] mt-0.5 shrink-0" />
                          <span className="text-xs text-[#F5F1E8]/80 italic line-clamp-2">
                            "{q.raw_transcript}"
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-[#8B87A0]">No transcript</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {q.extracted_price !== null ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#34D399]/10 border border-[#34D399]/30 text-[#34D399] text-xs font-bold">
                          <DollarSign className="w-3 h-3" />
                          {q.extracted_price.toLocaleString()}
                        </div>
                      ) : (
                        <span className="text-xs text-[#8B87A0] italic">Not extracted</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {q.extracted_price !== null ? (
                        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#34D399]">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Quoted
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#F0455C]">
                          <XCircle className="w-3.5 h-3.5" />
                          No price
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Expanded Transcript Row */}
        {selectedRow && (
          <div className="border-t border-[#262838] bg-[#0E0F17] px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-[#FFB627]" />
              <span className="text-xs font-semibold text-[#FFB627] uppercase tracking-wider">Full Transcript</span>
              <span className="text-xs text-[#8B87A0] ml-1">— {selectedRow.supplier_name} re: {selectedRow.item_name}</span>
            </div>
            <div className="bg-[#14151F] border border-[#262838] rounded-lg p-4 text-sm text-[#F5F1E8]/90 italic leading-relaxed">
              {selectedRow.raw_transcript ? `"${selectedRow.raw_transcript}"` : "No transcript recorded for this call."}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-[#8B87A0]">
              <span>Call SID: <span className="font-mono text-[#F5F1E8]/70">{selectedRow.call_sid}</span></span>
              {selectedRow.extracted_price !== null && (
                <span className="text-[#34D399] font-semibold">
                  AI extracted price: ${selectedRow.extracted_price.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
