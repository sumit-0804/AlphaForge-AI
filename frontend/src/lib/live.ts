"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";

/** One live trade, already merged into today's candle by the server. */
export type Tick = {
  type: "tick";
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number | null;
  change: number | null;
  change_percent: number | null;
  currency: string;
  session_date: string;
};

export type LiveStatus = "connecting" | "live" | "closed" | "offline";

type Subscribed = {
  type: "subscribed";
  symbol: string;
  market: { label: string; is_open: boolean };
};

function socketUrl(): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/api/live`;
}

/** Live prices for one ticker; reconnects, since Cloud Run cuts sockets at 60 min. */
export function useLivePrice(ticker: string | null) {
  // Stamped with its ticker so a stale symbol is filtered on read, not reset in an effect.
  const [state, setState] = useState<{
    ticker: string | null;
    tick: Tick | null;
    status: LiveStatus;
  }>({ ticker: null, tick: null, status: "offline" });

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ticker) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const token = getToken();
      if (!token) return;

      // No headers on a WebSocket, so the token rides in the subprotocol, not the URL.
      const ws = new WebSocket(socketUrl(), ["bearer", token]);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        ws.send(JSON.stringify({ subscribe: ticker }));
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as Tick | Subscribed;
        if (msg.type === "tick") {
          setState({ ticker, tick: msg, status: "live" });
        } else if (msg.type === "subscribed") {
          // Silence is normal out of hours; say so rather than sitting on "connecting".
          setState((s) => ({
            ticker,
            tick: s.ticker === ticker ? s.tick : null,
            status: msg.market?.is_open ? "live" : "closed",
          }));
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, ticker, status: "offline" }));
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [ticker]);

  // State from a previous symbol is not this symbol's state.
  const mine = state.ticker === ticker ? state : null;
  return {
    tick: mine?.tick ?? null,
    status: ticker ? (mine?.status ?? "connecting") : ("offline" as LiveStatus),
  };
}
