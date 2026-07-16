"use client";

import { useEffect, useRef } from "react";
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

export function PriceChart({ ticker }: { ticker: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

    const history = useQuery({
        queryKey: ["history", ticker],
        queryFn: () => fetchHistory(ticker, "6mo", "1d"),
        enabled: !!ticker,
    });

    // Create the chart once (client-only; createChart touches the DOM).
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const chart = createChart(el, {
            autoSize: true,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#9ca3af",
            },
            grid: {
                vertLines: { color: "rgba(148,163,184,0.1)" },
                horzLines: { color: "rgba(148,163,184,0.1)" },
            },
            rightPriceScale: { borderColor: "rgba(148,163,184,0.2)" },
            timeScale: { borderColor: "rgba(148,163,184,0.2)" },
        });

        seriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "#10b981",
            downColor: "#ef4444",
            wickUpColor: "#10b981",
            wickDownColor: "#ef4444",
            borderVisible: false,
        });
        chartRef.current = chart;

        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, []);

    // Feed data whenever the query resolves.
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
    }, [history.data]);

    return (
        <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Price · 6M</h3>
                {history.isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
                {history.isError && <span className="text-xs text-red-600">Chart failed to load</span>}
            </div>
            <div ref={containerRef} className="h-[360px] w-full" />
        </div>
    );
}
