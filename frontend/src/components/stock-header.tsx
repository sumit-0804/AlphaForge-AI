"use client";

import Link from "next/link";
import { ArrowLeftIcon, StarIcon } from "@phosphor-icons/react";

import { Move } from "@/components/page";
import { PriceChart } from "@/components/price-chart";
import { TradeSheet } from "@/components/trade-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStockInfo } from "@/lib/queries";
import { useLivePrice } from "@/lib/live";
import { money, signedPercent, tickerName } from "@/lib/format";
import { useWatchlist } from "@/store/watchlist";

const FEED: Record<string, string> = {
  live: "Live",
  closed: "Market closed",
  connecting: "Connecting",
  offline: "Reconnecting",
};

export function StockHeader({ ticker }: { ticker: string }) {
  const info = useStockInfo(ticker);
  const { tick, status } = useLivePrice(ticker);
  const watchlist = useWatchlist();
  const watched = watchlist.symbols.includes(ticker);

  const price = tick?.price ?? info.data?.currentPrice ?? null;
  const currency = tick?.currency ?? info.data?.currency ?? null;
  const name = info.data?.longName ?? info.data?.shortName ?? null;

  return (
    <>
      <div className="mb-4 flex items-center gap-1">
        <Link
          href="/"
          aria-label="Back"
          className="-ml-2 flex size-11 items-center justify-center text-ink-2"
        >
          <ArrowLeftIcon size={20} />
        </Link>
        <button
          type="button"
          aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={watched}
          onClick={() => watchlist.toggle(ticker)}
          className="ml-auto flex size-11 items-center justify-center text-ink-2"
        >
          <StarIcon size={20} weight={watched ? "fill" : "regular"} />
        </button>
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-xl font-medium">{tickerName(ticker)}</h1>
          {info.isPending ? (
            <Skeleton className="mt-1.5 h-4 w-40" />
          ) : (
            <p className="truncate text-sm text-ink-3">{name ?? ticker}</p>
          )}
        </div>
        <div className="text-right">
          <p className="tnum text-xl">{price != null ? money(price, currency) : "—"}</p>
          {tick?.change_percent != null && (
            <Move value={tick.change_percent}>
              <span className="text-sm">{signedPercent(tick.change_percent, 2)}</span>
            </Move>
          )}
        </div>
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-3">
        {/* Blue is reserved for state that is happening right now, so only a live feed lights up. */}
        {status === "live" ? (
          <span className="dot-live breathe" />
        ) : (
          status === "closed" && <span aria-hidden>🌙</span>
        )}
        <span className={status === "live" ? "text-live" : undefined}>{FEED[status]}</span>
        {info.data?.sector ? ` · ${info.data.sector}` : ""}
      </p>

      <div className="mt-4">
        <PriceChart ticker={ticker} tick={tick} />
      </div>

      <div className="mt-4 flex gap-2">
        <TradeSheet ticker={ticker} price={price} currency={currency} action="buy">
          <Button variant="buy" className="flex-1">Buy</Button>
        </TradeSheet>
        <TradeSheet ticker={ticker} price={price} currency={currency} action="sell">
          <Button variant="sell" className="flex-1">
            Sell
          </Button>
        </TradeSheet>
      </div>
    </>
  );
}
