"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

import { Input } from "@/components/ui/input";
import { useSymbolSearch } from "@/lib/queries";
import { tickerName } from "@/lib/format";

export function TickerSearch() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const router = useRouter();

  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);

  const results = useSymbolSearch(query);

  function open(symbol: string) {
    setText("");
    setQuery("");
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  }

  return (
    <div>
      <div className="relative">
        <MagnifyingGlassIcon
          size={18}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3"
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) open(text.trim().toUpperCase());
          }}
          placeholder="Search any ticker"
          aria-label="Search for a ticker"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="pl-10"
        />
      </div>

      {query.length >= 2 && (
        <div className="mt-2 flex flex-col">
          {results.isPending && <p className="py-3 text-sm text-ink-3">Looking…</p>}
          {results.isError && (
            <p className="py-3 text-sm text-ink-3">Search is unavailable right now.</p>
          )}
          {results.data?.length === 0 && (
            <p className="py-3 text-sm text-ink-3">Nothing matched “{query}”.</p>
          )}
          {results.data?.map((r) => (
            <button
              key={r.symbol}
              type="button"
              onClick={() => open(r.symbol)}
              className="flex min-h-14 items-center gap-3 border-b border-border py-2.5 text-left last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{tickerName(r.symbol)}</span>
                <span className="block truncate text-[13px] text-ink-3">{r.name}</span>
              </span>
              {r.exchange && <span className="shrink-0 text-[13px] text-ink-3">{r.exchange}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
