"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type WatchlistState = {
  symbols: string[];
  toggle: (symbol: string) => void;
  remove: (symbol: string) => void;
  has: (symbol: string) => boolean;
};

// Newest first, so the last thing you looked at is the first chip on the home screen.
export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      symbols: [],
      toggle: (symbol) =>
        set((s) => ({
          symbols: s.symbols.includes(symbol)
            ? s.symbols.filter((x) => x !== symbol)
            : [symbol, ...s.symbols].slice(0, 24),
        })),
      remove: (symbol) => set((s) => ({ symbols: s.symbols.filter((x) => x !== symbol) })),
      has: (symbol) => get().symbols.includes(symbol),
    }),
    { name: "alphaforge.watchlist" }
  )
);
