"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { fetchStockInfo } from "@/lib/api";
import { useWatchlist } from "@/store/watchlist";
import { currency, compact } from "@/lib/format";
import { StarIcon, PlusIcon } from "@phosphor-icons/react";

export default function WatchlistPage() {
  const { tickers, add, remove } = useWatchlist();
  const [input, setInput] = useState("");

  const results = useQueries({
    queries: tickers.map((t) => ({
      queryKey: ["stock", t],
      queryFn: () => fetchStockInfo(t),
    })),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(input);
          setInput("");
        }}
        className="flex gap-2 max-w-sm"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add ticker…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button type="submit" className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          <PlusIcon size={16} /> Add
        </button>
      </form>

      {tickers.length === 0 ? (
        <p className="text-muted-foreground">Your watchlist is empty.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tickers.map((t, i) => {
            const q = results[i];
            const d = q.data;
            return (
              <div key={t} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between">
                  <Link href="/market" className="font-semibold hover:underline">
                    {t}
                  </Link>
                  <button
                    onClick={() => remove(t)}
                    className="text-amber-500 hover:text-muted-foreground"
                    title="Remove"
                  >
                    <StarIcon size={18} weight="fill" />
                  </button>
                </div>
                {q.isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
                {q.isError && <p className="mt-2 text-xs text-red-600">Not found</p>}
                {d && (
                  <>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{d.shortName}</p>
                    <p className="mt-2 text-xl font-semibold">{currency(d.currentPrice)}</p>
                    <p className="text-xs text-muted-foreground">Mkt cap {compact(d.marketCap)}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}