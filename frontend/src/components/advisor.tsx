"use client";

import { useState } from "react";

import { ErrorNote, RowsSkeleton } from "@/components/page";
import { TradeSheet } from "@/components/trade-sheet";
import { Button } from "@/components/ui/button";
import { useAdvisor } from "@/lib/queries";
import { tickerName } from "@/lib/format";
import type { AdvisorPosition, AdvisorSuggestion } from "@/lib/api";

const VERB: Record<AdvisorSuggestion["action"], string> = {
  SELL: "Sell",
  TRIM: "Trim",
  ADD: "Add to",
  HOLD: "Hold",
};

export function Advisor() {
  // One chat call per book, so it only runs when the user actually asks.
  const [asked, setAsked] = useState(false);
  const advisor = useAdvisor(asked);

  if (!asked) {
    return (
      <div>
        <Button variant="tinted" onClick={() => setAsked(true)}>
          Ask the advisor
        </Button>
      </div>
    );
  }

  if (advisor.isPending) return <RowsSkeleton rows={2} />;
  if (advisor.isError) return <ErrorNote error={advisor.error} retry={() => advisor.refetch()} />;

  const { portfolio_summary, suggestions, positions } = advisor.data;
  const actionable = suggestions.filter((s) => s.action !== "HOLD");

  return (
    <div className="flex flex-col gap-4">
      {portfolio_summary && <p className="text-[15px] text-ink-2">{portfolio_summary}</p>}

      {actionable.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing it would change today.</p>
      ) : (
        actionable.map((s) => (
          <Suggestion key={s.ticker} suggestion={s} position={positions.find((p) => p.ticker === s.ticker)} />
        ))
      )}
    </div>
  );
}

function Suggestion({
  suggestion,
  position,
}: {
  suggestion: AdvisorSuggestion;
  position?: AdvisorPosition;
}) {
  const side = suggestion.action === "ADD" ? "buy" : "sell";
  const quantity = suggestion.suggested_quantity;

  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-[15px]">
        <span className="font-medium">
          {VERB[suggestion.action]} {tickerName(suggestion.ticker)}
        </span>
        {quantity > 0 && <span className="tnum text-ink-2"> — {quantity} shares</span>}
      </p>
      <p className="mt-1.5 text-sm text-ink-2">{suggestion.rationale}</p>

      {position && (
        <p className="tnum mt-1.5 text-[13px] text-ink-3">
          {position.weight_pct.toFixed(0)}% of the book, {position.pnl_percent < 0 ? "down" : "up"}{" "}
          {Math.abs(position.pnl_percent).toFixed(1)}%.
        </p>
      )}

      {suggestion.action !== "HOLD" && (
        <div className="mt-3">
          <TradeSheet
            ticker={suggestion.ticker}
            price={position?.current_price ?? null}
            currency={position?.currency}
            held={position?.quantity}
            action={side}
            quantity={quantity > 0 ? quantity : undefined}
          >
            <Button size="sm" variant={side}>
              {VERB[suggestion.action]} {quantity > 0 ? quantity : ""}
            </Button>
          </TradeSheet>
        </div>
      )}
    </div>
  );
}
