"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
} from "lightweight-charts";
import { fetchHistory, type Candle } from "@/lib/api";
import { useLivePrice, type Tick } from "@/lib/live";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { BorderBeam } from "@/components/ui/border-beam";
import { Skeleton } from "@/components/ui/skeleton";

// lightweight-charts throws on oklch(), so mirror the tokens as hex per theme.
const PALETTE = {
  dark: {
    // Soft lime and crimson, matching --positive / --negative exactly.
    up: "#a8d765",
    down: "#e93750",
    // A violet-tinted grid so it sits in the plum ground rather than on it.
    grid: "rgba(150,85,255,0.09)",
    text: "#9391a7",
    line: "#9655ff",
  },
  light: {
    up: "#508018",
    down: "#be1133",
    grid: "rgba(103,43,201,0.11)",
    text: "#636075",
    line: "#672bc9",
  },
} as const;

const STATUS_LABEL: Record<string, string> = {
  live: "LIVE",
  closed: "CLOSED",
  connecting: "CONNECTING",
  offline: "OFFLINE",
};

export function PriceChart({ ticker }: { ticker: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // The last live bar, replayed after a theme rebuild drops the series.
  const liveBarRef = useRef<CandlestickData | null>(null);
  const { resolvedTheme } = useTheme();

  const history = useQuery({
    queryKey: ["history", ticker],
    queryFn: () => fetchHistory(ticker, "6mo", "1d"),
    enabled: !!ticker,
  });
  const { tick, status } = useLivePrice(ticker || null);

  // Build the chart, and rebuild it when the theme flips so colours stay in sync.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const c = resolvedTheme === "light" ? PALETTE.light : PALETTE.dark;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.text,
        fontFamily: "var(--font-mono)",
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid },
      crosshair: { mode: 0 },
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
      borderVisible: false,
    });
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [resolvedTheme]);

  // Feed data whenever the query resolves (or the chart was rebuilt).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !history.data) return;
    const data = history.data.map((c: Candle) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })) as CandlestickData[];
    series.setData(data);
    // A rebuild wipes the live bar, so put the last one back on top of history.
    if (liveBarRef.current) series.update(liveBarRef.current);
    chartRef.current?.timeScale().fitContent();
  }, [history.data, resolvedTheme]);

  // Fold each tick into today's candle; update() throws if time goes backwards.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !tick || !history.data?.length) return;
    if (tick.symbol !== ticker) return;

    const lastHistory = history.data[history.data.length - 1].time;
    if (tick.session_date < lastHistory) return;

    const bar: CandlestickData = {
      time: tick.session_date,
      open: tick.open,
      high: tick.high,
      low: tick.low,
      close: tick.price,
    } as CandlestickData;
    liveBarRef.current = bar;
    series.update(bar);
  }, [tick, ticker, history.data]);

  return (
    <Card className="relative gap-2 p-0">
      {/* Only while the feed is actually live — it is a status signal, not decor. */}
      {status === "live" && <BorderBeam size={90} duration={7} borderWidth={1} />}
      <div className="flex items-center gap-3 border-b px-3 py-1.5 text-[10px] tracking-wide uppercase">
        <span className="text-primary">6M · 1D</span>
        {history.isError && <span className="text-negative">chart failed to load</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block size-1.5",
              status === "live"
                ? "animate-pulse bg-positive"
                : status === "closed"
                  ? "bg-muted-foreground"
                  : "bg-primary"
            )}
          />
          <span
            className={cn(
              status === "live" ? "text-positive" : "text-muted-foreground"
            )}
          >
            {STATUS_LABEL[status]}
          </span>
          {tick && <LivePrice tick={tick} />}
        </span>
      </div>
      {/* The container must always be mounted — the chart is created against this
          ref on mount, so swapping it out for a skeleton would leave it null. */}
      <div className="relative h-[340px] w-full px-1 pb-1">
        <div ref={containerRef} className="h-full w-full" />
        {history.isLoading && <Skeleton className="absolute inset-0" />}
      </div>
    </Card>
  );
}

/** Flash the cell in the direction of the move; digits stay readable. */
function LivePrice({ tick }: { tick: Tick }) {
  const up = (tick.change ?? 0) >= 0;
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const last = prev.current;
    prev.current = tick.price;
    if (last === null || last === tick.price) return;
    setFlash(tick.price > last ? "up" : "down");
    const id = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(id);
  }, [tick.price]);

  return (
    <span className="tabular flex items-center gap-2 border-l pl-2">
      <span
        className={cn(
          "px-1 text-foreground",
          flash === "up" && "tick-up",
          flash === "down" && "tick-down"
        )}
      >
        {tick.price.toFixed(2)}
      </span>
      {tick.change_percent != null && (
        <span className={up ? "text-positive" : "text-negative"}>
          {up ? "▲" : "▼"} {Math.abs(tick.change_percent).toFixed(2)}%
        </span>
      )}
    </span>
  );
}
