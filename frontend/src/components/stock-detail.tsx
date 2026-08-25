"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchStockInfo, executeTrade } from "@/lib/api";
import { currency, compact, number } from "@/lib/format";
import { useWatchlist } from "@/store/watchlist";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StarIcon } from "@phosphor-icons/react";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="tabular text-sm font-medium">{value}</dd>
    </div>
  );
}

/** Quote, figures and paper trade for one ticker; keyed on ticker so a new stock resets it. */
export function StockDetail({ ticker }: { ticker: string }) {
  const [qty, setQty] = useState(1);
  const qc = useQueryClient();
  const watchlist = useWatchlist();

  const info = useQuery({
    queryKey: ["stock", ticker],
    queryFn: () => fetchStockInfo(ticker),
    enabled: !!ticker,
  });

  const trade = useMutation({
    mutationFn: (action: "buy" | "sell") => executeTrade({ ticker, action, quantity: qty }),
    onSuccess: (tx) => {
      toast.success(
        `${tx.action.toUpperCase()} ${tx.quantity} ${tx.ticker} @ ${currency(tx.price, tx.currency ?? "USD")}`
      );
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (info.isLoading) return <Skeleton className="h-44 w-full" />;
  if (info.isError)
    return <p className="text-xs text-negative">{(info.error as Error).message}</p>;

  const data = info.data;
  if (!data) return null;
  const symbol = data.symbol ?? ticker;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="gap-4 p-5 lg:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{symbol}</h2>
              <button
                onClick={() => watchlist.toggle(symbol)}
                className="text-muted-foreground hover:text-primary"
                title="Toggle watchlist"
              >
                <StarIcon size={18} weight={watchlist.has(symbol) ? "fill" : "regular"} />
              </button>
            </div>
            <p className="truncate text-xs text-muted-foreground">{data.longName ?? data.shortName}</p>
            <p className="text-[11px] text-muted-foreground">
              {[data.sector, data.industry, data.exchange].filter(Boolean).join(" · ")}
            </p>
          </div>
          <p className="tabular shrink-0 text-2xl font-semibold">
            {currency(data.currentPrice, data.currency)}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Market cap" value={compact(data.marketCap, data.currency)} />
          <Field label="Volume" value={number(data.volume)} />
          <Field label="Avg volume" value={number(data.averageVolume)} />
          <Field label="52W high" value={currency(data.fiftyTwoWeekHigh, data.currency)} />
          <Field label="52W low" value={currency(data.fiftyTwoWeekLow, data.currency)} />
        </dl>
      </Card>

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
  );
}
