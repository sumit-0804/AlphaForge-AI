"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    fetchAdvisorSuggestions,
    executeTrade,
    type AdvisorPosition,
    type AdvisorSuggestion,
} from "@/lib/api";
import { currency, percent } from "@/lib/format";
import { WarningCircleIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";

const ACTION_STYLE: Record<string, string> = {
    SELL: "bg-red-600 text-white",
    TRIM: "bg-amber-600 text-white",
    ADD: "bg-emerald-600 text-white",
    HOLD: "border text-muted-foreground",
};

const URGENCY_STYLE: Record<string, string> = {
    HIGH: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
    MEDIUM: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    LOW: "border-muted bg-muted/30 text-muted-foreground",
};

export function AdvisorPanel() {
    const qc = useQueryClient();
    const [done, setDone] = useState<Record<string, string>>({});

    const advice = useQuery({
        queryKey: ["advisor-suggestions"],
        queryFn: fetchAdvisorSuggestions,
    });

    const trade = useMutation({
        mutationFn: (v: { ticker: string; action: "buy" | "sell"; quantity: number }) =>
            executeTrade(v),
        onSuccess: (tx) => {
            setDone((d) => ({
                ...d,
                [tx.ticker]: `${tx.action.toUpperCase()} ${tx.quantity} @ ${currency(tx.price)}`,
            }));
            qc.invalidateQueries({ queryKey: ["portfolio"] });
            qc.invalidateQueries({ queryKey: ["transactions"] });
            qc.invalidateQueries({ queryKey: ["advisor-suggestions"] });
        },
    });

    const byTicker = new Map<string, AdvisorPosition>(
        (advice.data?.positions ?? []).map((p) => [p.ticker, p]),
    );

    return (
        <section className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                    <h2 className="font-medium">Portfolio suggestions</h2>
                    <p className="text-xs text-muted-foreground">
                        What the advisor thinks you should do with what you already hold.
                    </p>
                </div>
                <button
                    onClick={() => advice.refetch()}
                    disabled={advice.isFetching}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                    <ArrowClockwiseIcon size={14} className={advice.isFetching ? "animate-spin" : ""} />
                    Refresh
                </button>
            </div>

            {advice.isLoading && (
                <p className="px-4 py-6 text-sm text-muted-foreground">Reviewing your positions…</p>
            )}
            {advice.isError && (
                <p className="px-4 py-6 text-sm text-red-600">{(advice.error as Error).message}</p>
            )}

            {advice.data && advice.data.suggestions.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No open positions to advise on.
                </p>
            )}

            {advice.data && advice.data.suggestions.length > 0 && (
                <>
                    <p className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                        {advice.data.portfolio_summary}
                    </p>
                    {!advice.data.valid && (
                        <p className="flex items-center gap-1.5 border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                            <WarningCircleIcon size={14} />
                            Rule-based fallback — the advisor could not produce a structured read.
                        </p>
                    )}
                    <div className="divide-y">
                        {advice.data.suggestions.map((s: AdvisorSuggestion) => {
                            const p = byTicker.get(s.ticker);
                            const actionable = s.action !== "HOLD" && s.suggested_quantity > 0;
                            const side = s.action === "ADD" ? "buy" : "sell";
                            return (
                                <div key={s.ticker} className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{s.ticker}</span>
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                                ACTION_STYLE[s.action] ?? "border"
                                            }`}
                                        >
                                            {s.action}
                                        </span>
                                        <span
                                            className={`rounded-full border px-2 py-0.5 text-xs ${
                                                URGENCY_STYLE[s.urgency] ?? ""
                                            }`}
                                        >
                                            {s.urgency}
                                        </span>
                                        {p && (
                                            <span
                                                className={`ml-auto text-sm font-medium ${
                                                    p.pnl >= 0 ? "text-emerald-600" : "text-red-600"
                                                }`}
                                            >
                                                {percent(p.pnl_percent)}
                                            </span>
                                        )}
                                    </div>

                                    {p && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {p.quantity} sh · avg {currency(p.avg_buy_price)} · now{" "}
                                            {currency(p.current_price)} · {p.weight_pct}% of book
                                        </p>
                                    )}

                                    {p && p.bearish_signals.length > 0 && (
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                            {p.bearish_signals.map((sig) => (
                                                <span
                                                    key={sig}
                                                    className="rounded border border-red-500/30 bg-red-500/5 px-1.5 py-0.5 text-[11px] text-red-700 dark:text-red-300"
                                                >
                                                    {sig.replaceAll("_", " ")}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <p className="mt-1.5 text-sm">{s.rationale}</p>

                                    {done[s.ticker] ? (
                                        <p className="mt-2 text-sm text-emerald-600">✓ {done[s.ticker]}</p>
                                    ) : (
                                        actionable && (
                                            <button
                                                onClick={() =>
                                                    trade.mutate({
                                                        ticker: s.ticker,
                                                        action: side,
                                                        quantity: s.suggested_quantity,
                                                    })
                                                }
                                                disabled={trade.isPending}
                                                className={`mt-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                                                    side === "sell"
                                                        ? "bg-red-600 text-white"
                                                        : "bg-emerald-600 text-white"
                                                }`}
                                            >
                                                {s.action} {s.suggested_quantity} {s.ticker}
                                            </button>
                                        )
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {trade.isError && (
                        <p className="border-t px-4 py-2 text-sm text-red-600">
                            {(trade.error as Error).message}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
