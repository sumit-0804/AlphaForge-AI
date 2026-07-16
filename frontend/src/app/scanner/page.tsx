"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
    fetchScan,
    type ScanCandidate,
    type TriageEntry,
    type UniverseKey,
} from "@/lib/api";
import { currency, number } from "@/lib/format";
import { useWatchlist } from "@/store/watchlist";
import { WorkflowStreamView, useWorkflowStream } from "@/components/analysis-stream";
import { AdvisorPanel } from "@/components/advisor-panel";
import { MarketSessions } from "@/components/market-sessions";
import {
    StarIcon,
    ArrowClockwiseIcon,
    MagnifyingGlassIcon,
    WarningCircleIcon,
} from "@phosphor-icons/react";

const CONVICTION_STYLE: Record<string, string> = {
    HIGH: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    MEDIUM: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    LOW: "border-muted bg-muted/30 text-muted-foreground",
};

const UNIVERSES: { key: UniverseKey; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "IN", label: "India" },
    { key: "NSE", label: "NSE" },
    { key: "BSE", label: "BSE" },
    { key: "US", label: "US" },
];

export default function ScannerPage() {
    const watchlist = useWatchlist();
    const [analysing, setAnalysing] = useState<string | null>(null);
    const [market, setMarket] = useState<UniverseKey>("ALL");
    const { state: analysis, run, cancel } = useWorkflowStream();

    const scan = useQuery({
        queryKey: ["scan", market],
        queryFn: () => fetchScan(10, true, market),
    });

    // Deep analysis is the expensive tier (~15 model calls) — it runs only when
    // the user picks a candidate, never automatically across the whole scan.
    function analyse(symbol: string) {
        setAnalysing(symbol);
        run(symbol, { news: false, rounds: 2 });
    }

    const triageBySymbol = new Map<string, TriageEntry>(
        (scan.data?.triage?.ranked ?? []).map((r) => [r.symbol, r]),
    );

    // Present in the agent's ranked order when triage succeeded, else rule score.
    const candidates = [...(scan.data?.candidates ?? [])].sort((a, b) => {
        const ra = triageBySymbol.get(a.symbol)?.rank;
        const rb = triageBySymbol.get(b.symbol)?.rank;
        if (ra != null && rb != null) return ra - rb;
        return b.score - a.score;
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Scanner</h1>
                    <p className="text-sm text-muted-foreground">
                        Candidates the agent surfaced — you choose which earn a full analysis.
                    </p>
                </div>
                <button
                    onClick={() => scan.refetch()}
                    disabled={scan.isFetching}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                    <ArrowClockwiseIcon size={16} className={scan.isFetching ? "animate-spin" : ""} />
                    Rescan
                </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
                    {UNIVERSES.map((u) => (
                        <button
                            key={u.key}
                            onClick={() => setMarket(u.key)}
                            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                                market === u.key
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent"
                            }`}
                        >
                            {u.label}
                        </button>
                    ))}
                </div>
                <MarketSessions sessions={scan.data?.sessions} />
            </div>

            {scan.isLoading && <p className="text-muted-foreground">Scanning the universe…</p>}
            {scan.isError && <p className="text-red-600">{(scan.error as Error).message}</p>}

            {scan.data && (
                <div className="rounded-lg border bg-card">
                    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                        <MagnifyingGlassIcon size={16} className="text-muted-foreground" />
                        <span className="text-sm">
                            <strong>{scan.data.matched}</strong> of {scan.data.scanned} scanned
                        </span>
                        {scan.data.triage?.valid === false && (
                            <span className="ml-auto flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                                <WarningCircleIcon size={14} />
                                Ranked by rule score — agent triage unavailable
                            </span>
                        )}
                    </div>

                    {scan.data.triage?.summary && (
                        <p className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                            {scan.data.triage.summary}
                        </p>
                    )}

                    {candidates.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                            Nothing triggered a setup in this scan.
                        </p>
                    ) : (
                        <div className="divide-y">
                            {candidates.map((c: ScanCandidate) => {
                                const t = triageBySymbol.get(c.symbol);
                                return (
                                    <div key={c.symbol} className="px-4 py-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-lg font-semibold">{c.symbol}</span>
                                            {t && (
                                                <span
                                                    className={`rounded-full border px-2 py-0.5 text-xs ${
                                                        CONVICTION_STYLE[t.conviction] ?? ""
                                                    }`}
                                                >
                                                    {t.conviction}
                                                </span>
                                            )}
                                            <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                                {c.market === "IN" ? "NSE/BSE" : "NASDAQ/NYSE"}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                score {c.score}
                                            </span>
                                            <button
                                                onClick={() => watchlist.toggle(c.symbol)}
                                                title="Toggle watchlist"
                                                className="text-muted-foreground hover:text-amber-500"
                                            >
                                                <StarIcon
                                                    size={18}
                                                    weight={watchlist.has(c.symbol) ? "fill" : "regular"}
                                                />
                                            </button>
                                            <span className="ml-auto text-lg font-semibold">
                                                {/* Indian names price in INR, US in USD. */}
                                                {currency(c.price, c.currency)}
                                            </span>
                                        </div>

                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {c.signals.map((s) => (
                                                <span
                                                    key={s}
                                                    className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300"
                                                >
                                                    {s.replaceAll("_", " ")}
                                                </span>
                                            ))}
                                        </div>

                                        <p className="mt-2 text-xs text-muted-foreground">
                                            RSI {c.rsi} · EMA20 {c.ema_20} · EMA50 {c.ema_50} · vol{" "}
                                            {number(c.volume)} ({c.volume_ratio}×)
                                        </p>

                                        {t && (
                                            <>
                                                <p className="mt-2 text-sm">{t.thesis}</p>
                                                {t.invalidation && (
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        <span className="font-medium">Invalidated if:</span>{" "}
                                                        {t.invalidation}
                                                    </p>
                                                )}
                                            </>
                                        )}

                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                                onClick={() => analyse(c.symbol)}
                                                disabled={analysis.running}
                                                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                                            >
                                                {analysing === c.symbol && analysis.running
                                                    ? "Analysing…"
                                                    : "Deep analysis"}
                                            </button>
                                            {/* Trading deliberately routes through Market so the
                                                price, quantity and cash impact are confirmed
                                                before anything executes. */}
                                            <Link
                                                href={`/market?ticker=${c.symbol}`}
                                                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                                            >
                                                Trade
                                            </Link>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {analysing && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-medium">Deep analysis · {analysing}</h2>
                        {analysis.running && (
                            <button
                                onClick={cancel}
                                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                            >
                                Stop
                            </button>
                        )}
                    </div>
                    <WorkflowStreamView state={analysis} />
                </div>
            )}

            <AdvisorPanel />
        </div>
    );
}
