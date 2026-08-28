"use client";

import { useEffect, useRef, useState } from "react";
import { CaretRightIcon, XIcon } from "@phosphor-icons/react";

import { DebateThread, type DebateRound } from "@/components/debate-thread";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { sentence, tickerName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DebateDecision } from "@/lib/api";

function toneFor(action: string): string {
  const a = action.toUpperCase();
  if (a === "BUY") return "text-up";
  if (a === "SELL") return "text-down";
  return "text-foreground";
}

function subtitle(rounds: DebateRound[], running: boolean): string {
  if (running) return "Still arguing…";
  const n = rounds.length;
  const converged = rounds.some((r) => r.converged);
  return `${n} ${n === 1 ? "round" : "rounds"}${converged ? " · they converged" : ""}`;
}

export function DebateScreen({
  ticker,
  rounds,
  decision,
  running,
}: {
  ticker: string;
  rounds: DebateRound[];
  decision: DebateDecision | null;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (rounds.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="glow-accent mt-6 flex w-full items-center gap-3 rounded-lg border border-primary/45 bg-tint-accent px-4 py-3 text-left transition-colors hover:bg-primary/12"
          />
        }
      >
        <span aria-hidden className="text-[17px]">
          🗣️
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium text-primary">See the debate</span>
          <span className="block text-[12px] text-ink-3">{subtitle(rounds, running)}</span>
        </span>
        <CaretRightIcon size={16} className="text-primary" />
      </SheetTrigger>

      <SheetContent fullScreen>
        <Header ticker={ticker} rounds={rounds} />
        <Body rounds={rounds} decision={decision} running={running} />
      </SheetContent>
    </Sheet>
  );
}

function Header({ ticker, rounds }: { ticker: string; rounds: DebateRound[] }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
      <SheetClose
        render={<Button variant="ghost" size="icon-sm" aria-label="Close the debate" />}
      >
        <XIcon />
      </SheetClose>
      <SheetTitle className="text-base">Committee · {tickerName(ticker)}</SheetTitle>
      <span className="tnum ml-auto pr-1 text-[12px] text-ink-3">
        {rounds.length} {rounds.length === 1 ? "round" : "rounds"}
      </span>
    </div>
  );
}

function Body({
  rounds,
  decision,
  running,
}: {
  rounds: DebateRound[];
  decision: DebateDecision | null;
  running: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow a live debate only while the reader is already at the bottom, never yank them back.
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    // Instant, not smooth: an in-flight animation keeps scrolling and re-pins itself past the guard.
    el.scrollTop = el.scrollHeight;
  }, [rounds.length, decision]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <DebateThread rounds={rounds} />

      {running && !decision && (
        <p className="py-4 text-center text-[12px] text-ink-3">
          <span className="dot-live breathe mr-1.5 inline-block align-middle" />
          Waiting for the next argument
        </p>
      )}

      {decision && <Moderator decision={decision} />}
    </div>
  );
}

function Moderator({ decision }: { decision: DebateDecision }) {
  return (
    <div className="mt-5 rounded-2xl bg-card p-4">
      <p className="text-[12px] text-ink-3">
        <span aria-hidden>⚖️</span> The moderator
      </p>
      <p
        className={cn(
          "glow-text mt-1 text-[26px] leading-tight font-medium tracking-tight",
          toneFor(decision.decision)
        )}
      >
        {sentence(decision.decision)}
      </p>
      {decision.rationale && (
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{decision.rationale}</p>
      )}
    </div>
  );
}
