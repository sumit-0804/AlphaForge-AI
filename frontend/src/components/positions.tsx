"use client";

import Link from "next/link";

import { Move } from "@/components/page";
import { money, num, signedPercent, tickerName } from "@/lib/format";
import type { PositionSummary } from "@/lib/api";

export function PositionRow({ position }: { position: PositionSummary }) {
  return (
    <Link
      href={`/stock/${encodeURIComponent(position.ticker)}`}
      className="flex min-h-16 items-center gap-3 border-b border-border py-3 last:border-0"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{tickerName(position.ticker)}</span>
        <span className="tnum block text-[13px] text-ink-3">
          {num(position.quantity)} {position.quantity === 1 ? "share" : "shares"} at{" "}
          {money(position.average_buy_price, position.currency)}
        </span>
      </span>
      <span className="text-right">
        <span className="tnum block text-[15px]">
          {money(position.current_value, position.currency)}
        </span>
        <Move value={position.pnl_percent}>
          <span className="block text-[13px]">
            {position.pnl_percent < 0 ? "down" : "up"} {signedPercent(position.pnl_percent).slice(1)}
          </span>
        </Move>
      </span>
    </Link>
  );
}

export function PositionList({ positions }: { positions: PositionSummary[] }) {
  return (
    <div className="flex flex-col">
      {positions.map((p) => (
        <PositionRow key={p.ticker} position={p} />
      ))}
    </div>
  );
}
