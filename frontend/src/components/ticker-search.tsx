"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { searchSymbols } from "@/lib/api";

export function TickerSearch({
    value,
    onChange,
    onSelect,
    placeholder = "Search name or ticker e.g. Apple",
    className = "",
}: {
    value: string;
    onChange: (v: string) => void;
    onSelect: (symbol: string) => void;
    placeholder?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [debounced, setDebounced] = useState("");

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
        <div className={`relative ${className}`}>
            <MagnifyingGlassIcon
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={16}
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
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            {open && debounced.length >= 2 && (
                <div
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border bg-card shadow-md"
                >
                    {search.isLoading && (
                        <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                    )}
                    {search.isError && (
                        <p className="px-3 py-2 text-sm text-red-600">
                            {(search.error as Error).message}
                        </p>
                    )}
                    {!search.isLoading && search.data?.length === 0 && (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
                    )}
                    {search.data?.map((r) => (
                        <button
                            key={r.symbol}
                            type="button"
                            onClick={() => pick(r.symbol)}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                            <span className="flex min-w-0 items-baseline gap-2">
                                <span className="font-medium">{r.symbol}</span>
                                <span className="truncate text-muted-foreground">{r.name}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
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
