"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";

import {
  AgentProgress,
  NODE_ORDER,
  emptyNodes,
  type NodeMap,
} from "@/components/agent-progress";
import { DebateScreen } from "@/components/debate-screen";
import type { DebateRound } from "@/components/debate-thread";
import { ErrorNote, Section } from "@/components/page";
import { RoundsPicker } from "@/components/rounds-picker";
import { DecisionSummary, Evidence, RiskCaveat, RoutingNote, Verdict } from "@/components/verdict";
import { Button } from "@/components/ui/button";
import { keys } from "@/lib/queries";
import {
  streamWorkflow,
  type Consensus,
  type DebateDecision,
  type DebateEvent,
  type Recommendation,
  type WorkflowEvent,
} from "@/lib/api";

type Phase = "idle" | "running" | "done" | "failed";

type State = {
  phase: Phase;
  message: string;
  nodes: NodeMap;
  consensus: Consensus | null;
  rounds: DebateRound[];
  decision: DebateDecision | null;
  recommendation: Recommendation | null;
  warnings: string[];
  error: string | null;
};

function initial(): State {
  return {
    phase: "idle",
    message: "",
    nodes: emptyNodes(),
    consensus: null,
    rounds: [],
    decision: null,
    recommendation: null,
    warnings: [],
    error: null,
  };
}

type Action = { kind: "start" } | { kind: "event"; event: WorkflowEvent } | { kind: "failed"; message: string };

function reduce(state: State, action: Action): State {
  if (action.kind === "start") return { ...initial(), phase: "running", message: "Starting…" };
  if (action.kind === "failed") return { ...state, phase: "failed", error: action.message };

  const ev = action.event;
  switch (ev.type) {
    case "status":
      return { ...state, message: ev.message };
    case "node":
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [ev.node]: { status: ev.status, data: ev.data, warnings: ev.warnings },
        },
      };
    case "routing":
      return { ...state, consensus: ev.consensus };
    case "quick_decision":
      return { ...state, decision: ev.decision };
    case "debate":
      return applyDebate(state, ev.event);
    case "recommendation":
      return { ...state, recommendation: ev.recommendation };
    case "warn":
      return { ...state, warnings: [...state.warnings, ev.message] };
    case "done":
      return { ...state, phase: "done", message: "" };
    case "error":
      return { ...state, phase: "failed", error: ev.message };
    default:
      return state;
  }
}

function applyDebate(state: State, ev: DebateEvent): State {
  if (ev.type === "opening") {
    return { ...state, rounds: [...state.rounds, { round: ev.round, bull: ev.bull, bear: ev.bear }] };
  }
  if (ev.type === "rebuttal") {
    return {
      ...state,
      rounds: [
        ...state.rounds,
        { round: ev.round, bull: ev.bull, bear: ev.bear, converged: ev.converged },
      ],
    };
  }
  if (ev.type === "decision") return { ...state, decision: ev.decision };
  return state;
}

export function AnalysisRun({ ticker }: { ticker: string }) {
  const [state, dispatch] = useReducer(reduce, undefined, initial);
  const [rounds, setRounds] = useState(2);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const run = useCallback(
    (fresh: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ kind: "start" });

      streamWorkflow(ticker, { fresh, rounds }, (event) => dispatch({ kind: "event", event }), controller.signal)
        .then(() => queryClient.invalidateQueries({ queryKey: keys.calls(ticker) }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          dispatch({
            kind: "failed",
            message: err instanceof Error ? err.message : "The analysis stopped early.",
          });
        });
    },
    [ticker, rounds, queryClient]
  );

  // Leaving the page mid-run must close the stream, or the server keeps writing into nothing.
  useEffect(() => () => abortRef.current?.abort(), []);

  const includeNews = true;
  const finished = useMemo(
    () => NODE_ORDER.filter((n) => ["done", "error"].includes(state.nodes[n].status)).length,
    [state.nodes]
  );

  // Before a run there is nothing to head up, so the button just joins the Buy/Sell group.
  if (state.phase === "idle") {
    return (
      <>
        <Button variant="tinted" className="mt-2 w-full" onClick={() => run(false)}>
          Run the analysis
        </Button>
        <div className="mt-4">
          <RoundsPicker value={rounds} onChange={setRounds} />
        </div>
      </>
    );
  }

  const running = state.phase === "running";
  const decision = state.recommendation
    ? {
        action: state.recommendation.action,
        confidence: state.recommendation.confidence,
        rationale: state.recommendation.rationale ?? state.recommendation.explanation?.debate_outcome?.rationale,
      }
    : state.decision
      ? {
          action: state.decision.decision,
          confidence: state.decision.confidence,
          rationale: state.decision.rationale,
        }
      : null;

  return (
    <>
      <Section
        title="Analysis"
        action={
          !running && (
            <Button variant="ghost" size="sm" onClick={() => run(true)}>
              <ArrowsClockwiseIcon />
              Run again
            </Button>
          )
        }
      >
        {running && (
          <div className="mb-4">
            <div className="flex items-baseline gap-3">
              <p className="text-[15px] text-ink-2">{state.message || "Working…"}</p>
              <p className="tnum ml-auto text-[13px] text-ink-3">
                {finished} of {NODE_ORDER.length}
              </p>
            </div>
            <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className="glow-accent h-full bg-primary transition-[width] duration-500"
                style={{ width: `${(finished / NODE_ORDER.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        <AgentProgress nodes={state.nodes} includeNews={includeNews} />

        {/* Still adjustable after a run, so "Run again" can argue it out for longer. */}
        {!running && (
          <div className="mt-4">
            <RoundsPicker value={rounds} onChange={setRounds} />
          </div>
        )}
      </Section>

      {state.consensus && (
        <Section title="How it decided">
          <RoutingNote consensus={state.consensus} />
        </Section>
      )}

      <DebateScreen
        ticker={ticker}
        rounds={state.rounds}
        decision={state.decision}
        running={running}
      />

      {decision && (
        <Section title="The call">
          <Verdict
            action={decision.action}
            confidence={decision.confidence}
            rationale={decision.rationale}
            lead={state.rounds.length > 0 ? "After the argument, the committee says" : "The committee says"}
          />
          <RiskCaveat risk={state.recommendation?.explanation?.risk} />
          {state.decision && (
            <div className="mt-4">
              <DecisionSummary decision={state.decision} />
            </div>
          )}
        </Section>
      )}

      {state.recommendation && (
        <Section title="What to watch">
          <Evidence recommendation={state.recommendation} />
        </Section>
      )}

      {state.warnings.length > 0 && (
        <Section>
          <p className="text-sm text-ink-3">{state.warnings.join(" ")}</p>
        </Section>
      )}

      {state.phase === "failed" && (
        <Section>
          <ErrorNote error={new Error(state.error ?? "The analysis stopped early.")} retry={() => run(true)} />
        </Section>
      )}
    </>
  );
}
