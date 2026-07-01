"use client";

import { create} from "zustand";
import {persist} from "zustand/middleware"

type WatchlistState = {
    tickers: string[];
    add: (ticker: string) => void;
    remove: (ticker: string) => void;
    toggle: (ticker: string) => void;
    has: (ticker : string) => boolean;
}

export const useWatchlist = create<WatchlistState>()(
    persist(
        (set,get)=>({
            tickers: ["AAPL", "MSFT", "NVDA"],
            add : (t)=>{
                const ticker = t.trim().toUpperCase();
                if(!ticker || get().tickers.includes(ticker)) return;
                set({tickers: [...get().tickers, ticker]})
            },
            remove: (t)=>
                set({tickers: get().tickers.filter((x) => x !== t.toUpperCase())}),
            toggle: (t)=> 
                get().has(t) ? get().remove(t) : get().add(t),
            has: (t) =>
                get().tickers.includes(t.toUpperCase()),
        }),
        {name: "alphaforge-watchlist"}
    )
);

