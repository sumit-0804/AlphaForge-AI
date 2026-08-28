"use client";

import Link from "next/link";
import { XIcon } from "@phosphor-icons/react";

import { PageTitle, Section } from "@/components/page";
import { PastCalls } from "@/components/past-calls";
import { TickerSearch } from "@/components/ticker-search";
import { useAuth } from "@/components/auth-provider";
import { tickerName } from "@/lib/format";
import { useWatchlist } from "@/store/watchlist";

export default function HomePage() {
  const { user } = useAuth();
  const watchlist = useWatchlist();
  const name = user?.email?.split("@")[0] ?? "";

  return (
    <>
      <PageTitle>{name ? `Hello, ${name}` : "Look up"}</PageTitle>

      <Section>
        <TickerSearch />
      </Section>

      {watchlist.symbols.length > 0 && (
        <Section title="Watching">
          <ul className="flex flex-wrap gap-2">
            {watchlist.symbols.map((symbol) => (
              <li key={symbol} className="flex items-center rounded-lg bg-muted">
                <Link href={`/stock/${encodeURIComponent(symbol)}`} className="py-2.5 pr-1.5 pl-3 text-sm">
                  {tickerName(symbol)}
                </Link>
                <button
                  type="button"
                  aria-label={`Stop watching ${tickerName(symbol)}`}
                  onClick={() => watchlist.remove(symbol)}
                  className="flex size-9 items-center justify-center text-ink-3"
                >
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recent calls">
        <PastCalls limit={8} />
      </Section>
    </>
  );
}
