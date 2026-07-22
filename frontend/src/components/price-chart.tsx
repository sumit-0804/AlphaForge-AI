"use client";

import { useEffect, useRef } from "react";
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
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// lightweight-charts only parses hex/rgb colours — it throws on the oklch() our
// design tokens use (the browser hands them back as lab(...)). So keep a small
// hex palette here that mirrors the tokens for each theme.
const PALETTE = {
  dark: {
    up: "#3fd39b",
    down: "#f4626a",
    grid: "rgba(255,255,255,0.08)",
    text: "#9aa4b2",
  },
  light: {
    up: "#2f9e6e",
    down: "#d9483f",
    grid: "rgba(0,0,0,0.08)",
    text: "#6b7280",
  },
} as const;

export function PriceChart({ ticker }: { ticker: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const { resolvedTheme } = useTheme();

  const history = useQuery({
    queryKey: ["history", ticker],
    queryFn: () => fetchHistory(ticker, "6mo", "1d"),
    enabled: !!ticker,
  });

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
    chartRef.current?.timeScale().fitContent();
  }, [history.data, resolvedTheme]);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Price · 6M
        </h3>
        {history.isError && <span className="text-[11px] text-negative">chart failed to load</span>}
      </div>
      {/* The container must always be mounted — the chart is created against this
          ref on mount, so swapping it out for a skeleton would leave it null. */}
      <div className="relative h-[360px] w-full">
        <div ref={containerRef} className="h-full w-full" />
        {history.isLoading && <Skeleton className="absolute inset-0" />}
      </div>
    </Card>
  );
}
