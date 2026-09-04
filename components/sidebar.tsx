"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  ClipboardList,
  Activity,
  Shield,
  Menu,
  X,
  Radio,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Chat Assistant", href: "/chat", icon: MessageSquare },
  { name: "PO Queue", href: "/po-queue", icon: ClipboardList },
  { name: "Simulator", href: "/simulator", icon: Activity },
  { name: "Audit Trail", href: "/audit-log", icon: Shield },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavLinks = ({ onNav }: { onNav?: () => void }) => (
    <div className="space-y-1.5">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNav}
            className={cn(
              "group relative flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 select-none",
              isActive
                ? "bg-[#1C1E2B] text-[#F5F1E8] border border-[#FFB627]/30 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
                : "text-[#8B87A0] hover:text-[#F5F1E8] hover:bg-[#14151F] border border-transparent"
            )}
          >
            {/* Active gold flare indicator line */}
            {isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-[#FFB627] shadow-[0_0_12px_#FFB627]" />
            )}

            <Icon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isActive ? "text-[#FFB627]" : "text-[#8B87A0] group-hover:text-[#F5F1E8]"
              )}
            />
            <span className="tracking-wide font-heading">{item.name}</span>

            {isActive && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#FFB627] animate-pulse" />
            )}
          </Link>
        );
      })}
    </div>
  );

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#262838] bg-[#0A0B10] sticky top-0 z-40">
        <div className="font-bold text-base font-heading flex items-center gap-2.5 text-[#F5F1E8]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FFB627] to-[#FF6B35] flex items-center justify-center text-[#0A0B10] shadow-[0_0_16px_rgba(255,182,39,0.3)]">
            <Radio className="h-4 w-4" />
          </div>
          <span>ProcureAI</span>
          <span className="text-[10px] text-[#8B87A0] font-mono px-1.5 py-0.5 rounded bg-[#14151F] border border-[#262838]">
            CONTROL ROOM
          </span>
        </div>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center size-8 rounded-lg bg-[#14151F] text-[#F5F1E8] border border-[#262838] hover:bg-[#1C1E2B] transition-colors"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>

      {/* ── Mobile drawer overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-50 flex flex-col w-72 bg-[#0E0F17] border-r border-[#262838] p-5 h-full">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#262838]">
              <div className="font-bold text-lg font-heading flex items-center gap-2.5 text-[#F5F1E8]">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#FFB627] to-[#FF6B35] flex items-center justify-center text-[#0A0B10] shadow-[0_0_16px_rgba(255,182,39,0.3)]">
                  <Radio className="h-4 w-4" />
                </div>
                <span>ProcureAI</span>
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center size-7 rounded-lg bg-[#14151F] text-[#8B87A0] hover:text-[#F5F1E8] border border-[#262838] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1">
              <NavLinks onNav={() => setMobileOpen(false)} />
            </div>
            <div className="pt-4 border-t border-[#262838] mt-auto text-[11px] text-[#8B87A0]">
              <div className="flex items-center justify-between">
                <span>Status:</span>
                <span className="text-[#34D399] flex items-center gap-1 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-pulse" /> Active
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:flex flex-col w-64 border-r border-[#262838] bg-[#0E0F17] min-h-screen p-5 sticky top-0 h-screen select-none shadow-[4px_0_24px_rgba(0,0,0,0.4)]">
        {/* Brand Header */}
        <div className="flex items-center gap-2.5 mb-8 px-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#FFB627] to-[#FF6B35] flex items-center justify-center text-[#0A0B10] shadow-[0_0_16px_rgba(255,182,39,0.35)] shrink-0">
            <Radio className="h-4 w-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="font-bold text-base font-heading text-[#F5F1E8] tracking-tight flex items-center gap-1.5">
              ProcureAI
              <span className="text-[9px] text-[#FFB627] font-semibold px-1 rounded bg-[#FFB627]/10 border border-[#FFB627]/25">
                v2.4
              </span>
            </div>
            <p className="text-[10px] text-[#8B87A0] tracking-wider uppercase font-mono">
              Risk Control Room
            </p>
          </div>
        </div>

        {/* Navigation items */}
        <div className="flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8B87A0] px-3.5 mb-2.5 font-mono">
            Navigation
          </div>
          <NavLinks />
        </div>

        {/* Telemetry Footer */}
        <div className="pt-4 border-t border-[#262838] mt-auto">
          <div className="p-3 rounded-lg bg-[#14151F] border border-[#262838] text-[11px] space-y-1.5">
            <div className="flex items-center justify-between text-[#8B87A0]">
              <span>Decision Loop:</span>
              <span className="text-[#34D399] flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-pulse" />
                ONLINE
              </span>
            </div>
            <div className="flex items-center justify-between text-[#8B87A0]">
              <span>Telemetry:</span>
              <span className="text-[#7DD3C0] font-mono text-[10px]">Active</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
