"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamDebate,
  type DebateArgument,
  type DebateDecision,
  type DebateEvent,
  type DebateMemory,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { ActionBadge, ConfidenceBadge } from "@/components/status-badges";
import { LearningStatusNote } from "@/components/learning-status";

/* ---------- streaming state (unchanged logic) ---------- */

type RoundView = { round: number; bull: DebateArgument; bear: DebateArgument; converged?: boolean };

export type DebateState = {
  running: boolean;
  ticker: string | null;
  status: string;
  memory: DebateMemory | null;
  rounds: RoundView[];
  decision: DebateDecision | null;
  model: string | null;
  error: string | null;
};

export const initialDebateState: DebateState = {
  running: false,
  ticker: null,
  status: "",
  memory: null,
  rounds: [],
  decision: null,
  model: null,
  error: null,
};

export function debateReduce(prev: DebateState, ev: DebateEvent): DebateState {
  switch (ev.type) {
    case "status":
      return { ...prev, status: ev.message };
    case "memory":
      return { ...prev, memory: ev.memory };
    case "opening":
      return { ...prev, status: "Opening statements", rounds: [{ round: ev.round, bull: ev.bull, bear: ev.bear }] };
    case "rebuttal":
      return {
        ...prev,
        status: `Rebuttal round ${ev.round}`,
        rounds: [...prev.rounds, { round: ev.round, bull: ev.bull, bear: ev.bear, converged: ev.converged }],
      };
    case "decision":
      return { ...prev, decision: ev.decision, model: ev.model, status: "Verdict" };
    case "done":
      return { ...prev, running: false, status: "Complete" };
    case "error":
      return { ...prev, running: false, error: ev.message };
    default:
      return prev;
  }
}

/** Hook that drives one streaming debate and accumulates its rounds. */
export function useDebateStream() {
  const [state, setState] = useState<DebateState>(initialDebateState);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback((ticker: string, opts: { news?: boolean; rounds?: number }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ ...initialDebateState, running: true, ticker: ticker.toUpperCase() });

    streamDebate(ticker, opts, (ev) => setState((prev) => debateReduce(prev, ev)), ac.signal)
      .then(() => setState((prev) => ({ ...prev, running: false })))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState((prev) => ({ ...prev, running: false, error: (e as Error).message }));
      });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, running: false, status: "Cancelled" }));
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, run, cancel };
}

/* ---------- chat pieces ---------- */

function Avatar({ side }: { side: "bull" | "bear" }) {
  const bull = side === "bull";
  return (
    <div
      className={cn(
        "grid size-7 shrink-0 place-items-center text-sm ring-1 ring-inset",
        bull ? "bg-positive/12 ring-positive/25" : "bg-negative/12 ring-negative/25"
      )}
      aria-hidden
    >
      {bull ? "🐂" : "🐻"}
    </div>
  );
}

function TypingDots({ side }: { side: "bull" | "bear" }) {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className={cn("size-1.5 animate-bounce rounded-full", side === "bull" ? "bg-positive" : "bg-negative")}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

// One analyst's turn as a group of chat bubbles.
function MessageGroup({ side, arg, isOpening }: { side: "bull" | "bear"; arg: DebateArgument; isOpening: boolean }) {
  const bull = side === "bull";
  const points = isOpening ? arg.arguments ?? [] : arg.rebuttals ?? arg.arguments ?? [];
  const label = bull ? "Bull analyst" : "Bear analyst";
  const bubble = "w-fit max-w-full px-3 py-2 text-xs/relaxed animate-in fade-in duration-300";
  const tone = bull ? "bg-positive/10" : "bg-negative/10";

  return (
    <div className={cn("flex gap-2", bull ? "justify-start" : "flex-row-reverse justify-start")}>
      <Avatar side={side} />
      <div className={cn("flex min-w-0 max-w-[82%] flex-col gap-1", bull ? "items-start" : "items-end")}>
        <div className={cn("flex items-center gap-2 px-1", bull ? "" : "flex-row-reverse")}>
          <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
          {arg.concede && (
            <span className="bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-600">concedes</span>
          )}
          {arg.has_new_points === false && !arg.concede && (
            <span className="bg-muted px-1.5 py-px text-[10px] text-muted-foreground">rests case</span>
          )}
        </div>

        {points.length === 0 && <div className={cn(bubble, tone, "text-muted-foreground")}>…</div>}
        {points.map((p, i) => (
          <div key={i} className={cn(bubble, tone)} style={{ animationDelay: `${i * 90}ms` }}>
            {!isOpening && i === 0 && <span className={cn("mr-1", bull ? "text-positive" : "text-negative")}>↳</span>}
            {p}
          </div>
        ))}

        {arg.key_point && (
          <div className={cn(bubble, bull ? "bg-positive/20" : "bg-negative/20", "font-medium")}>
            <span className={bull ? "text-positive" : "text-negative"}>★ </span>
            {arg.key_point}
          </div>
        )}
      </div>
    </div>
  );
}

function RoundDivider({ round }: { round: number }) {
  return (
    <div className="my-1 flex justify-center">
      <span className="bg-muted px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {round === 1 ? "Opening statements" : `Rebuttal · round ${round}`}
      </span>
    </div>
  );
}

// What the committee remembered before arguing: this stock's own lessons, plus
// transferable lessons from other tickers in a similar setup.
function MemoryNote({ memory }: { memory: DebateMemory }) {
  const prior = memory.prior_lessons ?? [];
  const cross = memory.cross_ticker_lessons ?? [];
  const hasAny = prior.length > 0 || cross.length > 0;

  return (
    <div className="mx-auto w-full max-w-lg animate-in fade-in duration-500">
      <div className="bg-primary/8 px-3 py-2.5 text-xs ring-1 ring-inset ring-primary/20">
        {hasAny ? (
          <>
            <p className="mb-1.5 font-medium text-primary">🧠 The committee recalls past trades</p>
            {prior.length > 0 && (
              <ul className="space-y-0.5">
                {prior.map((l, i) => (
                  <li key={`p${i}`} className="leading-snug text-muted-foreground">
                    • {l}
                  </li>
                ))}
              </ul>
            )}
            {cross.length > 0 && (
              <div className="mt-1.5 border-t border-primary/15 pt-1.5">
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  From similar setups on other stocks
                </p>
                <ul className="space-y-0.5">
                  {cross.map((c, i) => (
                    <li key={`c${i}`} className="leading-snug text-muted-foreground">
                      • <span className="font-medium text-foreground">{c.ticker ?? "—"}</span>: {c.content}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-center text-muted-foreground">
            🧠 <LearningStatusNote status={memory.status} empty="No prior memory for this setup — starting fresh." />
          </p>
        )}
      </div>
    </div>
  );
}

function Verdict({ decision, model }: { decision: DebateDecision; model: string | null }) {
  return (
    <div className="mx-auto w-full max-w-lg animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="flex justify-center">
        <span className="bg-muted px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          ⚖️ The moderator delivers the verdict
        </span>
      </div>
      <div className="mt-2 bg-card p-4 text-center ring-1 ring-inset ring-border">
        <div className="mb-2 flex items-center justify-center gap-2">
          <ActionBadge value={decision.decision} />
          <ConfidenceBadge value={decision.confidence} />
        </div>
        {decision.rationale && <p className="text-xs/relaxed text-muted-foreground">{decision.rationale}</p>}

        {((decision.key_catalysts?.length ?? 0) > 0 || (decision.key_risks?.length ?? 0) > 0) && (
          <div className="mt-3 grid gap-3 text-left sm:grid-cols-2">
            {(decision.key_catalysts?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Catalysts</p>
                <ul className="space-y-1 text-xs">
                  {decision.key_catalysts!.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-positive">↑</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(decision.key_risks?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Risks</p>
                <ul className="space-y-1 text-xs">
                  {decision.key_risks!.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-negative">↓</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {model && <p className="mt-3 text-[10px] text-muted-foreground">decided by {model}</p>}
      </div>
    </div>
  );
}

/* ---------- the chat view ---------- */

export function CommitteeDebate({ state }: { state: DebateState }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the newest message, but only if already near the bottom.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [state.rounds.length, state.decision, state.memory, state.running, state.error]);

  if (!state.ticker) {
    return (
      <div className="bg-card p-12 text-center ring-1 ring-inset ring-border">
        <div className="mb-2 text-3xl">🐂 ⚖️ 🐻</div>
        <p className="text-xs text-muted-foreground">
          Pick a ticker and open the floor — the Bull and Bear argue it out live.
        </p>
      </div>
    );
  }

  const waitingForNextRound = state.running && !state.decision && state.rounds.length > 0;

  return (
    <div className="flex flex-col overflow-hidden bg-card ring-1 ring-inset ring-border">
      {/* chat header */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="flex -space-x-2">
          <span className="grid size-6 place-items-center bg-positive/15 text-[11px] ring-2 ring-card">🐂</span>
          <span className="grid size-6 place-items-center bg-negative/15 text-[11px] ring-2 ring-card">🐻</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{state.ticker} committee</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn("inline-block size-1.5 rounded-full", state.running ? "animate-pulse bg-positive" : "bg-muted-foreground")}
            />
            {state.status || (state.running ? "live" : "idle")}
          </p>
        </div>
        {state.rounds.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {state.rounds.length} round{state.rounds.length > 1 ? "s" : ""}
            {state.rounds.at(-1)?.converged ? " · converged" : ""}
          </span>
        )}
      </div>

      {/* conversation */}
      <div ref={bodyRef} className="flex max-h-[65vh] min-h-[22rem] flex-col gap-3 overflow-y-auto bg-muted/20 p-4">
        {state.memory && <MemoryNote memory={state.memory} />}

        {state.rounds.length === 0 && state.running && (
          <p className="mx-auto animate-pulse text-xs text-muted-foreground">
            {state.status || "gathering evidence…"}
          </p>
        )}

        {state.rounds.map((r) => (
          <div key={r.round} className="flex flex-col gap-3">
            <RoundDivider round={r.round} />
            <MessageGroup side="bull" arg={r.bull} isOpening={r.round === 1} />
            <MessageGroup side="bear" arg={r.bear} isOpening={r.round === 1} />
          </div>
        ))}

        {waitingForNextRound && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Avatar side="bull" />
              <div className="w-fit bg-positive/10 px-3 py-2">
                <TypingDots side="bull" />
              </div>
            </div>
            <div className="flex flex-row-reverse gap-2">
              <Avatar side="bear" />
              <div className="w-fit bg-negative/10 px-3 py-2">
                <TypingDots side="bear" />
              </div>
            </div>
          </div>
        )}

        {state.decision && <Verdict decision={state.decision} model={state.model} />}

        {state.error && (
          <div className="mx-auto max-w-md bg-negative/10 px-3 py-2 text-center text-xs text-negative">
            {state.error}
          </div>
        )}
      </div>
    </div>
  );
}
