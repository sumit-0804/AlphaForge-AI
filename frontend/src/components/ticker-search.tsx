"use client";

import { useEffect, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { searchSymbols } from "@/lib/api";
import { cn } from "@/lib/utils";

// A ticker/company search box with a live dropdown of matches.
export function TickerSearch({
  value,
  onChange,
  onSelect,
  placeholder = "Search name or ticker e.g. Apple",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");

  // Wait 250ms after typing stops before hitting the API.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(t);
  }, [value]);

  const search = useQuery({
    queryKey: ["symbol-search", debounced],
    queryFn: () => searchSymbols(debounced),
    enabled: debounced.length >= 2,
  });

  function pick(sym: string) {
    onSelect(sym.toUpperCase());
    setOpen(false);
  }

  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlassIcon
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={15}
      />
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="h-9 w-full bg-input/40 pl-9 pr-3 text-sm outline-none ring-1 ring-inset ring-border transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
      />

      {open && debounced.length >= 2 && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-auto bg-popover shadow-lg ring-1 ring-border animate-in fade-in-0 slide-in-from-top-1"
        >
          {search.isLoading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
          )}
          {search.isError && (
            <p className="px-3 py-2 text-xs text-negative">{(search.error as Error).message}</p>
          )}
          {!search.isLoading && search.data?.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
          )}
          {search.data?.map((r) => (
            <button
              key={r.symbol}
              type="button"
              onClick={() => pick(r.symbol)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-medium">{r.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{r.name}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {r.exchange ?? ""}
                {r.type ? ` · ${r.type}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
