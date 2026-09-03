"use client";

import { useRealtime, RealtimeMessage } from "@/lib/realtime";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

interface RealtimeStatusBadgeProps {
  onMessage?: (msg: RealtimeMessage) => void;
  className?: string;
}

export function RealtimeStatusBadge({ onMessage, className }: RealtimeStatusBadgeProps) {
  const { isConnected } = useRealtime(onMessage);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors shadow-sm",
        isConnected
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
        className
      )}
      title={isConnected ? "Real-time updates active (FastAPI WebSocket connected)" : "Connecting to real-time server..."}
    >
      <span className="relative flex h-2 w-2">
        {isConnected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            isConnected ? "bg-emerald-500" : "bg-amber-500"
          )}
        />
      </span>
      <Radio className="h-3 w-3" />
      <span>{isConnected ? "Live Sync Connected" : "Connecting..."}</span>
    </div>
  );
}
