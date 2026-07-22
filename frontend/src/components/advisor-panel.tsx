"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchAdvisorSuggestions,
  executeTrade,
  type AdvisorPosition,
  type AdvisorSuggestion,
} from "@/lib/api";
import { currency, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionBadge, UrgencyBadge } from "@/components/status-badges";
import { EmptyState } from "@/components/ui-bits";
import { WarningCircleIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";

// What the advisor thinks the user should do with positions they already hold.
export function AdvisorPanel() {
  const qc = useQueryClient();
  const [done, setDone] = useState<Record<string, string>>({});

  const advice = useQuery({ queryKey: ["advisor-suggestions"], queryFn: fetchAdvisorSuggestions });

  const trade = useMutation({
    mutationFn: (v: { ticker: string; action: "buy" | "sell"; quantity: number }) => executeTrade(v),
    onSuccess: (tx) => {
      const msg = `${tx.action.toUpperCase()} ${tx.quantity} ${tx.ticker} @ ${currency(tx.price, tx.currency ?? "USD")}`;
      setDone((d) => ({ ...d, [tx.ticker]: msg }));
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["advisor-suggestions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const byTicker = new Map<string, AdvisorPosition>(
    (advice.data?.positions ?? []).map((p) => [p.ticker, p])
  );

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-sm font-medium">Portfolio suggestions</h2>
          <p className="text-[11px] text-muted-foreground">
            What the advisor thinks you should do with what you hold.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => advice.refetch()} disabled={advice.isFetching}>
          <ArrowClockwiseIcon size={14} className={advice.isFetching ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {advice.isLoading && <p className="p-4 text-xs text-muted-foreground">Reviewing your positions…</p>}
      {advice.isError && <p className="p-4 text-xs text-negative">{(advice.error as Error).message}</p>}

      {advice.data && advice.data.suggestions.length === 0 && (
        <EmptyState title="No open positions to advise on." />
      )}

      {advice.data && advice.data.suggestions.length > 0 && (
        <>
          <p className="border-b bg-muted/30 p-4 text-xs/relaxed text-muted-foreground">
            {advice.data.portfolio_summary}
          </p>
          {!advice.data.valid && (
            <p className="flex items-center gap-1.5 border-b bg-amber-500/5 px-4 py-2 text-[11px] text-amber-600 dark:text-amber-400">
              <WarningCircleIcon size={14} />
              Rule-based fallback — the advisor could not produce a structured read.
            </p>
          )}
          <div className="divide-y">
            {advice.data.suggestions.map((s: AdvisorSuggestion) => {
              const p = byTicker.get(s.ticker);
              const actionable = s.action !== "HOLD" && s.suggested_quantity > 0;
              const side = s.action === "ADD" ? "buy" : "sell";
              return (
                <div key={s.ticker} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.ticker}</span>
                    <ActionBadge value={s.action} />
                    <UrgencyBadge value={s.urgency} />
                    {p && (
                      <span className={cn("tabular ml-auto text-sm font-medium", p.pnl >= 0 ? "text-positive" : "text-negative")}>
                        {percent(p.pnl_percent)}
                      </span>
                    )}
                  </div>

                  {p && (
                    <p className="tabular mt-1 text-[11px] text-muted-foreground">
                      {p.quantity} sh · avg {currency(p.avg_buy_price, p.currency ?? "USD")} · now{" "}
                      {currency(p.current_price, p.currency ?? "USD")} · {p.weight_pct}% of book
                    </p>
                  )}

                  {p && p.bearish_signals.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.bearish_signals.map((sig) => (
                        <span key={sig} className="bg-negative/8 px-1.5 py-0.5 text-[10px] text-negative ring-1 ring-inset ring-negative/20">
                          {sig.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="mt-1.5 text-xs/relaxed">{s.rationale}</p>

                  {done[s.ticker] ? (
                    <p className="mt-2 text-xs text-positive">✓ {done[s.ticker]}</p>
                  ) : (
                    actionable && (
                      <Button
                        variant={side === "sell" ? "destructive" : "default"}
                        size="sm"
                        className="mt-2"
                        disabled={trade.isPending}
                        onClick={() => trade.mutate({ ticker: s.ticker, action: side, quantity: s.suggested_quantity })}
                      >
                        {s.action} {s.suggested_quantity} {s.ticker}
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
