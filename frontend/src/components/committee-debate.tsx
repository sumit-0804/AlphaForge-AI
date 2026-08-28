"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
import { AnimatedSpan, Terminal } from "@/components/ui/terminal";

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


/* ---------- terminal transcript ---------- */

const TONE = {
  bull: "text-positive",
  bear: "text-negative",
  sys: "text-primary",
} as const;

// One prefixed line. `stream` is what a shell prompt would be: who is speaking.
function Line({
  stream,
  marker = ">",
  tone = "sys",
  icon,
  children,
  className,
}: {
  stream?: string;
  marker?: string;
  tone?: keyof typeof TONE;
  icon?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatedSpan className={cn("text-xs/relaxed", className)}>
      <span className="flex gap-2">
        {/* Fixed width: emoji are double-width, so the text column must not shift. */}
        <span className="w-4 shrink-0 text-center leading-none">{icon}</span>
        <span className={cn("shrink-0 tabular", TONE[tone])}>
          {stream ? `${stream}${marker}` : marker}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</span>
      </span>
    </AnimatedSpan>
  );
}

function Command({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <AnimatedSpan className="mt-2 text-xs">
      <span className="flex gap-2">
        <span className="w-4 shrink-0 text-center leading-none">{icon}</span>
        <span className="shrink-0 text-primary">$</span>
        <span className="text-foreground">{children}</span>
      </span>
    </AnimatedSpan>
  );
}

function MemoryBlock({ memory }: { memory: DebateMemory }) {
  const prior = memory.prior_lessons ?? [];
  const cross = memory.cross_ticker_lessons ?? [];
  return (
    <>
      <Command icon="🧠">recall --lessons</Command>
      {prior.length === 0 && cross.length === 0 && (
        <Line marker="·" className="text-muted-foreground">
          <LearningStatusNote status={memory.status} empty="no prior memory for this setup — starting fresh" />
        </Line>
      )}
      {prior.map((l, i) => (
        <Line key={`p${i}`} marker="·" className="text-muted-foreground">
          {l}
        </Line>
      ))}
      {cross.map((c, i) => (
        <Line key={`c${i}`} marker="·" className="text-muted-foreground">
          <span className="text-foreground">{c.ticker ?? "—"}</span> {c.content}
        </Line>
      ))}
    </>
  );
}

// An analyst's turn: their points, then the one they lead with.
function Turn({ side, arg, opening }: { side: "bull" | "bear"; arg: DebateArgument; opening: boolean }) {
  const points = opening ? arg.arguments ?? [] : arg.rebuttals ?? arg.arguments ?? [];
  const face = side === "bull" ? "🐂" : "🐻";
  return (
    <>
      {points.length === 0 && (
        <Line stream={side} tone={side} icon={face} className="text-muted-foreground">
          …
        </Line>
      )}
      {points.map((pt, i) => (
        <Line key={i} stream={side} marker={opening ? ">" : "↳"} tone={side} icon={face}>
          {pt}
        </Line>
      ))}
      {arg.key_point && (
        <Line stream={side} marker="*" tone={side} icon={face} className="font-medium">
          {arg.key_point}
        </Line>
      )}
      {arg.concede && (
        <Line stream={side} marker="!" tone={side} icon={face} className="text-muted-foreground">
          concedes
        </Line>
      )}
      {arg.has_new_points === false && !arg.concede && (
        <Line stream={side} marker="!" tone={side} icon={face} className="text-muted-foreground">
          rests case
        </Line>
      )}
    </>
  );
}

function VerdictBlock({ decision, model }: { decision: DebateDecision; model: string | null }) {
  const catalysts = decision.key_catalysts ?? [];
  const risks = decision.key_risks ?? [];
  return (
    <>
      <Command icon="⚖️">moderate --verdict</Command>
      <AnimatedSpan className="mt-1">
        <span className="flex flex-wrap items-center gap-2 pl-5">
          <ActionBadge value={decision.decision} />
          <ConfidenceBadge value={decision.confidence} />
        </span>
      </AnimatedSpan>
      {decision.rationale && (
        <Line marker="·" className="text-muted-foreground">
          {decision.rationale}
        </Line>
      )}
      {catalysts.map((c, i) => (
        <Line key={`up${i}`} marker="↑" tone="bull" className="text-muted-foreground">
          {c}
        </Line>
      ))}
      {risks.map((r, i) => (
        <Line key={`dn${i}`} marker="↓" tone="bear" className="text-muted-foreground">
          {r}
        </Line>
      ))}
      {model && (
        <Line marker="#" className="text-muted-foreground">
          decided by {model}
        </Line>
      )}
    </>
  );
}

export function CommitteeDebate({ state }: { state: DebateState }) {
  const bodyRef = useRef<HTMLPreElement | null>(null);

  // Follow the newest line, but only when already near the bottom.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight;
  }, [state.rounds.length, state.decision, state.memory, state.running, state.error]);

  if (!state.ticker) return null;

  const rounds = state.rounds;
  const waiting = state.running && !state.decision && rounds.length > 0;

  return (
    <Terminal
      // sequence={false}: lines are driven by real SSE arrival, not a fake timer.
      sequence={false}
      className="max-h-[65vh] min-h-[20rem]"
      bodyRef={bodyRef}
      title={
        <>
          <span aria-hidden>🐂 ⚖️ 🐻</span>
          <span className="text-primary">{state.ticker}</span>
          <span className="text-muted-foreground">committee</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span
              className={cn("inline-block size-1.5", state.running ? "animate-pulse bg-positive" : "bg-muted-foreground")}
            />
            <span className="text-muted-foreground">{state.status || (state.running ? "live" : "idle")}</span>
            {rounds.length > 0 && (
              <span className="text-muted-foreground">
                · {rounds.length}r{rounds.at(-1)?.converged ? " · converged" : ""}
              </span>
            )}
          </span>
        </>
      }
    >
      {state.memory && <MemoryBlock memory={state.memory} />}

      {rounds.length === 0 && state.running && (
        <Line marker="·" className="animate-pulse text-muted-foreground">
          {state.status || "gathering evidence…"}
        </Line>
      )}

      {rounds.map((r) => (
        <Fragment key={r.round}>
          <Command>{r.round === 1 ? "open --statements" : `rebut --round ${r.round}`}</Command>
          <Turn side="bull" arg={r.bull} opening={r.round === 1} />
          <Turn side="bear" arg={r.bear} opening={r.round === 1} />
        </Fragment>
      ))}

      {waiting && (
        <Line marker="·" className="animate-pulse text-muted-foreground">
          committee deliberating…
        </Line>
      )}

      {state.decision && <VerdictBlock decision={state.decision} model={state.model} />}

      {state.error && (
        <Line marker="!" tone="bear">
          {state.error}
        </Line>
      )}
    </Terminal>
  );
}
