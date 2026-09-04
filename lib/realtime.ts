"use client";

import { useEffect, useState, useRef } from "react";

export type RealtimeEventType =
  | "CONNECTED"
  | "PONG"
  | "EMAIL_PARSED"
  | "RISK_ALERT_CREATED"
  | "PO_CREATED"
  | "PO_UPDATED"
  | "SCENARIO_RUN"
  | "KPI_UPDATE";

export interface RealtimeMessage {
  type: RealtimeEventType;
  data?: any;
  timestamp?: string;
}

export type MessageHandler = (msg: RealtimeMessage) => void;

// ---------------------------------------------------------------
// App-Wide Shared WebSocket Singleton
// Guarantees exactly 1 active socket per browser tab, preventing
// connection churn and port exhaustion.
// ---------------------------------------------------------------

let sharedSocket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let globalIsConnected = false;
const messageListeners = new Set<(msg: RealtimeMessage) => void>();
const statusListeners = new Set<(connected: boolean) => void>();

function setConnectedStatus(connected: boolean) {
  globalIsConnected = connected;
  statusListeners.forEach((fn) => {
    try {
      fn(connected);
    } catch (_) {}
  });
}

function ensureSharedConnection() {
  if (typeof window === "undefined") return;

  if (
    sharedSocket &&
    (sharedSocket.readyState === WebSocket.OPEN ||
      sharedSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000/ws";
    const ws = new WebSocket(wsUrl);
    sharedSocket = ws;

    ws.onopen = () => {
      setConnectedStatus(true);
      if (!pingTimer) {
        pingTimer = setInterval(() => {
          if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) {
            sharedSocket.send("ping");
          }
        }, 25000);
      }
    };

    ws.onmessage = (event) => {
      try {
        const parsed: RealtimeMessage = JSON.parse(event.data);
        messageListeners.forEach((fn) => {
          try {
            fn(parsed);
          } catch (e) {
            console.error("Realtime listener error:", e);
          }
        });
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnectedStatus(false);
      sharedSocket = null;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (messageListeners.size > 0 || statusListeners.size > 0) {
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            ensureSharedConnection();
          }, 3000);
        }
      }
    };

    ws.onerror = () => {
      setConnectedStatus(false);
      try {
        ws.close();
      } catch (_) {}
    };
  } catch (err) {
    setConnectedStatus(false);
  }
}

/**
 * Shared React hook subscribing to the global singleton WebSocket connection.
 */
export function useRealtime(onMessage?: MessageHandler) {
  const [isConnected, setIsConnected] = useState<boolean>(globalIsConnected);
  const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
  const onMessageRef = useRef<MessageHandler | undefined>(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const handleStatusChange = (status: boolean) => {
      setIsConnected(status);
    };

    const handleMessage = (msg: RealtimeMessage) => {
      setLastMessage(msg);
      if (onMessageRef.current) {
        onMessageRef.current(msg);
      }
    };

    statusListeners.add(handleStatusChange);
    messageListeners.add(handleMessage);
    setIsConnected(globalIsConnected);

    ensureSharedConnection();

    return () => {
      statusListeners.delete(handleStatusChange);
      messageListeners.delete(handleMessage);
    };
  }, []);

  return { isConnected, lastMessage };
}
