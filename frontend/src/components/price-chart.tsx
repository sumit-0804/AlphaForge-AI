"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

import { Skeleton } from "@/components/ui/skeleton";
import { useHistory } from "@/lib/queries";
import type { Tick } from "@/lib/live";
import { cn } from "@/lib/utils";

// lightweight-charts cannot parse oklch(), so the tokens are mirrored here as hex.
const UP = "#3fdc91";
const DOWN = "#ff5f70";
const GRID = "#1c1813";
const AXIS = "#8b8175";

// Three months of daily bars is about as dense as candles stay readable on a phone.
const PERIODS = [
  { value: "1mo", label: "1M" },
  { value: "3mo", label: "3M" },
  { value: "6mo", label: "6M" },
  { value: "1y", label: "1Y" },
];

export function PriceChart({ ticker, tick }: { ticker: string; tick: Tick | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // The last live bar, replayed after a period change swaps the whole series out.
  const liveBarRef = useRef<CandlestickData | null>(null);
  const [period, setPeriod] = useState("3mo");

  const history = useHistory(ticker, period);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: AXIS,
        fontFamily: "inherit",
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: 0 },
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineVisible: false,
    });
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !history.data) return;
    series.setData(
      history.data.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })) as CandlestickData[]
    );
    if (liveBarRef.current) series.update(liveBarRef.current);
    chartRef.current?.timeScale().fitContent();
  }, [history.data]);

  // Fold each tick into today's bar; update() throws if time ever goes backwards.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !tick || !history.data?.length) return;
    if (tick.symbol !== ticker) return;
    if (tick.session_date < history.data[history.data.length - 1].time) return;

    const bar = {
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
    <div>
      <div className="relative h-56 w-full">
        {/* The container stays mounted: the chart is created against this ref on mount. */}
        <div ref={containerRef} className="h-full w-full" />
        {history.isPending && <Skeleton className="absolute inset-0" />}
        {history.isError && (
          <p className="absolute inset-0 flex items-center text-sm text-ink-3">
            No price history for this one.
          </p>
        )}
      </div>

      <div className="mt-2 flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            aria-pressed={period === p.value}
            className={cn(
              "h-9 flex-1 rounded-md text-[13px] font-medium transition-colors",
              period === p.value ? "bg-muted text-foreground" : "text-ink-3"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
