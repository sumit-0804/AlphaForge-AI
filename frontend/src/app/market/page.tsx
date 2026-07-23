"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchStockInfo, executeTrade } from "@/lib/api";
import { currency, compact, number } from "@/lib/format";
import { useWatchlist } from "@/store/watchlist";
import { PriceChart } from "@/components/price-chart";
import { TickerSearch } from "@/components/ticker-search";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { StarIcon, PlusIcon } from "@phosphor-icons/react";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="tabular text-sm font-medium">{value}</dd>
    </div>
  );
}

// The starred-tickers panel, folded into Market. Click a card to load its quote.
function WatchlistPanel({ onPick }: { onPick: (sym: string) => void }) {
  const { tickers, add, remove } = useWatchlist();
  const [input, setInput] = useState("");

  const results = useQueries({
    queries: tickers.map((t) => ({ queryKey: ["stock", t], queryFn: () => fetchStockInfo(t) })),
  });

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Watchlist</h2>
        <span className="text-[11px] text-muted-foreground">{tickers.length} tracked</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(input);
          setInput("");
        }}
        className="flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add ticker…"
          className="h-8 flex-1"
        />
        <Button type="submit" size="sm" variant="outline">
          <PlusIcon size={14} /> Add
        </Button>
      </form>

      {tickers.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Your watchlist is empty.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {tickers.map((t, i) => {
            const d = results[i]?.data;
            return (
              <div key={t} className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-2 ring-1 ring-inset ring-border">
                <button onClick={() => onPick(t)} className="min-w-0 text-left">
                  <p className="text-sm font-medium hover:text-primary">{t}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{d?.shortName ?? "…"}</p>
                </button>
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs font-medium">
                    {d ? currency(d.currentPrice, d.currency) : "—"}
                  </span>
                  <button onClick={() => remove(t)} className="text-primary hover:text-muted-foreground" title="Remove">
                    <StarIcon size={15} weight="fill" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function MarketView() {
  const params = useSearchParams();
  const router = useRouter();
  // The URL is the source of truth for which ticker is shown, so links like
  // /market?ticker=AAPL and the browser back button just work.
  const ticker = (params.get("ticker") ?? "").toUpperCase();

  const [input, setInput] = useState(ticker);
  const [qty, setQty] = useState(1);
  const qc = useQueryClient();
  const watchlist = useWatchlist();

  const info = useQuery({ queryKey: ["stock", ticker], queryFn: () => fetchStockInfo(ticker), enabled: !!ticker });

  const trade = useMutation({
    mutationFn: (action: "buy" | "sell") => executeTrade({ ticker, action, quantity: qty }),
    onSuccess: (tx) => {
      toast.success(`${tx.action.toUpperCase()} ${tx.quantity} ${tx.ticker} @ ${currency(tx.price, tx.currency ?? "USD")}`);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function selectSymbol(sym: string) {
    const s = sym.toUpperCase();
    if (!s) return;
    setInput(s);
    trade.reset();
    router.replace(`/market?ticker=${s}`);
  }

  const data = info.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Market" subtitle="Look up any listing, chart it, and paper-trade." />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          selectSymbol(input.trim());
        }}
        className="flex max-w-md gap-2"
      >
        <TickerSearch value={input} onChange={setInput} onSelect={selectSymbol} className="flex-1" />
        <Button type="submit">Search</Button>
      </form>

      {info.isError && <p className="text-xs text-negative">{(info.error as Error).message}</p>}
      {info.isLoading && <Skeleton className="h-40 w-full" />}

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="gap-4 p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{data.symbol}</h2>
                    <button
                      onClick={() => watchlist.toggle(data.symbol ?? ticker)}
                      className="text-muted-foreground hover:text-primary"
                      title="Toggle watchlist"
                    >
                      <StarIcon size={18} weight={watchlist.has(data.symbol ?? ticker) ? "fill" : "regular"} />
                    </button>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{data.longName ?? data.shortName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[data.sector, data.industry, data.exchange].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <p className="tabular shrink-0 text-2xl font-semibold">{currency(data.currentPrice, data.currency)}</p>
              </div>

              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Market cap" value={compact(data.marketCap, data.currency)} />
                <Field label="Volume" value={number(data.volume)} />
                <Field label="Avg volume" value={number(data.averageVolume)} />
                <Field label="52W high" value={currency(data.fiftyTwoWeekHigh, data.currency)} />
                <Field label="52W low" value={currency(data.fiftyTwoWeekLow, data.currency)} />
              </dl>
            </Card>

            {/* Trade panel */}
            <Card className="h-fit gap-4 p-5">
              <h3 className="text-sm font-medium">Paper trade</h3>
              <label className="block text-xs">
                <span className="text-muted-foreground">Quantity</span>
                <Input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                  className="mt-1"
                />
              </label>
              <p className="tabular text-xs text-muted-foreground">
                Est. cost: {currency((data.currentPrice ?? 0) * qty, data.currency)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  disabled={trade.isPending}
                  onClick={() => trade.mutate("buy")}
                  className="bg-positive text-white hover:bg-positive/90"
                >
                  Buy
                </Button>
                <Button variant="destructive" disabled={trade.isPending} onClick={() => trade.mutate("sell")}>
                  Sell
                </Button>
              </div>
            </Card>
          </div>

          <PriceChart ticker={data.symbol ?? ticker} />
        </>
      )}

      {!data && !info.isLoading && (
        <EmptyState title="Search a company or ticker to begin." hint="Try Apple, RELIANCE.NS, or TSLA." />
      )}

      <WatchlistPanel onPick={selectSymbol} />
    </div>
  );
}

export default function MarketPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground">Loading market…</p>}>
      <MarketView />
    </Suspense>
  );
}
