"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStockInfo, executeTrade } from "@/lib/api";
import { currency, compact, number, percent } from "@/lib/format";
import { useWatchlist } from "@/store/watchlist";
import { StackIcon, MagnifyingGlassIcon, StarIcon } from "@phosphor-icons/react";


export default function MarketPage() {
    const [input, setInput] = useState("");
    const [ticker, setTicker] = useState("");
    const [qty, setQty] = useState(1);
    const qc = useQueryClient()
    const watchlist = useWatchlist()

    const info = useQuery({
        queryKey: ["stock", ticker],
        queryFn: () => fetchStockInfo(ticker),
        enabled: !!ticker,
    })

    const trade = useMutation({
        mutationFn: (action: "buy" | "sell") =>
            executeTrade({ ticker, action, quantity: qty }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["portfolio"] });
            qc.invalidateQueries({ queryKey: ["transactions"] });
        },
    });
    const data = info.data;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold tracking-tight">Market</h1>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    setTicker(input.trim().toUpperCase());
                    trade.reset();
                }}
                className="flex gap-2 max-w-md"
            >
                <div className="relative flex-1">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Search ticker e.g. AAPL"
                        className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                    Search
                </button>
            </form>

            {info.isLoading && <p className="text-muted-foreground">Loading…</p>}
            {info.isError && <p className="text-red-600">{(info.error as Error).message}</p>}

            {data && (
                <div className="grid gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2 rounded-lg border bg-card p-5">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-xl font-semibold">{data.symbol}</h2>
                                    <button
                                        onClick={() => watchlist.toggle(data.symbol ?? ticker)}
                                        className="text-muted-foreground hover:text-amber-500"
                                        title="Toggle watchlist"
                                    >
                                        <StarIcon size={20} weight={watchlist.has(data.symbol ?? ticker) ? "fill" : "regular"} />
                                    </button>
                                </div>
                                <p className="text-sm text-muted-foreground">{data.longName ?? data.shortName}</p>
                                <p className="text-xs text-muted-foreground">
                                    {data.sector} · {data.industry}
                                    {data.exchange ? ` · ${data.exchange}` : ""}
                                </p>
                            </div>
                            <p className="text-2xl font-semibold">{currency(data.currentPrice, data.currency)}</p>
                        </div>

                        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                            <Field label="Market Cap" value={compact(data.marketCap)} />
                            <Field label="Volume" value={number(data.volume)} />
                            <Field label="Avg Volume" value={number(data.averageVolume)} />
                            <Field label="52W High" value={currency(data.fiftyTwoWeekHigh, data.currency)} />
                            <Field label="52W Low" value={currency(data.fiftyTwoWeekLow, data.currency)} />
                        </dl>
                    </div>

                    {/* Trade panel */}
                    <div className="rounded-lg border bg-card p-5 space-y-4 h-fit">
                        <h3 className="font-medium">Paper Trade</h3>
                        <label className="block text-sm">
                            <span className="text-muted-foreground">Quantity</span>
                            <input
                                type="number"
                                min={1}
                                value={qty}
                                onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                                className="mt-1 w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
                            />
                        </label>
                        <p className="text-sm text-muted-foreground">
                            Est. cost: {currency((data.currentPrice ?? 0) * qty, data.currency)}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                disabled={trade.isPending}
                                onClick={() => trade.mutate("buy")}
                                className="rounded-md bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                Buy
                            </button>
                            <button
                                disabled={trade.isPending}
                                onClick={() => trade.mutate("sell")}
                                className="rounded-md bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                                Sell
                            </button>
                        </div>
                        {trade.isSuccess && (
                            <p className="text-sm text-emerald-600">
                                {trade.data.action.toUpperCase()} {trade.data.quantity} {trade.data.ticker} @ {currency(trade.data.price, data.currency)}
                            </p>
                        )}
                        {trade.isError && <p className="text-sm text-red-600">{(trade.error as Error).message}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
        </div>
    );
}