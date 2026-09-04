"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  ClipboardList,
  Activity,
  Menu,
  X,
  Moon,
  Sun,
  Phone,
  BarChart2,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

const NAV_ITEMS = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Chat", href: "/chat", icon: MessageSquare },
  { name: "PO Queue", href: "/po-queue", icon: ClipboardList },
  { name: "Simulator", href: "/simulator", icon: Activity },
  { name: "Call Logs", href: "/call-logs", icon: Phone },
  { name: "Model Eval", href: "/model-eval", icon: BarChart2 },
  { name: "Audit Log", href: "/audit-log", icon: Shield },
];

export function Sidebar() {
  const pathname = usePathname();
  const { setTheme, theme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavLinks = ({ onNav }: { onNav?: () => void }) => (
    <div className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNav}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {item.name}
          </Link>
        );
      })}
    </div>
  );

  const ThemeToggle = () => (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="inline-flex items-center justify-center size-8 rounded-md hover:bg-muted transition-colors"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  );

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-background sticky top-0 z-40">
        <div className="font-bold text-lg flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          ProcureAI
        </div>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center size-8 rounded-md hover:bg-muted transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* ── Mobile drawer overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          aria-modal="true"
        >
          {/* backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          {/* drawer panel */}
          <div className="relative z-50 flex flex-col w-64 bg-background border-r p-4 h-full">
            <div className="flex items-center justify-between mb-6">
              <span className="font-bold text-lg flex items-center gap-2">
                <Activity className="h-6 w-6 text-primary" />
                ProcureAI
              </span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center size-8 rounded-md hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1">
              <NavLinks onNav={() => setMobileOpen(false)} />
            </div>
            <div className="pt-4 border-t mt-auto flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-medium">Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:flex flex-col w-64 border-r bg-muted/20 min-h-screen p-4 sticky top-0 h-screen">
        <div className="font-bold text-xl flex items-center gap-2 mb-8 px-2">
          <Activity className="h-6 w-6 text-primary" />
          ProcureAI
        </div>
        <div className="flex-1">
          <NavLinks />
        </div>
        <div className="pt-4 border-t mt-auto flex items-center justify-between px-2">
          <span className="text-sm text-muted-foreground font-medium">Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}
