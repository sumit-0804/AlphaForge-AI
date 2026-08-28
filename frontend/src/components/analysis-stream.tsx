"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamWorkflow,
  type Consensus,
  type Recommendation,
  type WorkflowEvent,
  type WorkflowNode,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CircleNotchIcon,
  CheckCircleIcon,
  CircleIcon,
  WarningCircleIcon,
  MinusCircleIcon,
  MagnifyingGlassIcon,
  ChartLineIcon,
  BuildingsIcon,
  NewspaperIcon,
  ShieldWarningIcon,
  IdentificationCardIcon,
  BrainIcon,
  CaretDownIcon,
  type Icon,
} from "@phosphor-icons/react";
import { AgentFindings } from "@/components/agent-findings";
import {
  CommitteeDebate,
  debateReduce,
  initialDebateState,
  type DebateState,
} from "@/components/committee-debate";
import { RecommendationCard } from "@/components/recommendation-card";
import { Card } from "@/components/ui/card";
import { VoteBadge } from "@/components/status-badges";

/* ---------- streaming state ---------- */

type NodeStatus = "pending" | "running" | "done" | "error" | "skipped";

export type WorkflowStreamState = {
  running: boolean;
  ticker: string | null;
  status: string;
  nodes: Record<WorkflowNode, NodeStatus>;
  // Each agent's own output, kept so the pipeline can show what it actually found.
  findings: Partial<Record<WorkflowNode, Record<string, unknown>>>;
  routing: Consensus | null;
  debate: DebateState;
  recommendation: Recommendation | null;
  errors: string[];
  error: string | null;
};

function initial(includeNews: boolean, ticker: string | null): WorkflowStreamState {
  return {
    running: Boolean(ticker),
    ticker,
    status: ticker ? "Starting…" : "",
    nodes: {
      profile: "pending",
      technical: "pending",
      fundamental: "pending",
      news: includeNews ? "pending" : "skipped",
      risk: "pending",
      recall: "pending",
      research: "pending",
    },
    findings: {},
    routing: null,
    debate: { ...initialDebateState },
    recommendation: null,
    errors: [],
    error: null,
  };
}

function reduceWf(prev: WorkflowStreamState, ev: WorkflowEvent): WorkflowStreamState {
  switch (ev.type) {
    case "status":
      return { ...prev, status: ev.message };
    case "node":
      return {
        ...prev,
        status: ev.status === "running" ? `Analysing ${ev.node}…` : prev.status,
        nodes: { ...prev.nodes, [ev.node]: ev.status },
        findings: ev.data ? { ...prev.findings, [ev.node]: ev.data } : prev.findings,
        errors: ev.warnings?.length ? [...prev.errors, ...ev.warnings] : prev.errors,
      };
    case "routing":
      return {
        ...prev,
        routing: ev.consensus,
        status:
          ev.consensus.route === "quick"
            ? "Independent signals unanimous — fast path"
            : ev.consensus.risk_veto
              ? "High-risk name — convening committee"
              : ev.consensus.incomplete?.length
                ? "Some signals unavailable — convening committee"
                : ev.consensus.research_dissent
                  ? "Research agent dissents — convening committee"
                  : "Signals conflict — convening committee",
      };
    case "quick_decision":
      return { ...prev, debate: { ...prev.debate, memory: ev.memory } };
    case "debate_start":
      return { ...prev, debate: { ...initialDebateState, running: true, ticker: prev.ticker } };
    case "debate": {
      const seeded =
        prev.debate.ticker == null
          ? { ...initialDebateState, running: true, ticker: prev.ticker }
          : prev.debate;
      return { ...prev, debate: debateReduce(seeded, ev.event) };
    }
    case "recommendation":
      return { ...prev, recommendation: ev.recommendation, debate: { ...prev.debate, running: false } };
    case "warn":
      return { ...prev, errors: [...prev.errors, ev.message] };
    case "done":
      return {
        ...prev,
        running: false,
        status: "Complete",
        errors: ev.errors ? [...prev.errors, ...ev.errors] : prev.errors,
      };
    case "error":
      return { ...prev, running: false, error: ev.message };
    default:
      return prev;
  }
}

/** Hook that runs one streaming analysis and tracks pipeline + debate + result. */
export function useWorkflowStream() {
  const [state, setState] = useState<WorkflowStreamState>(() => initial(false, null));
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback((ticker: string, opts: { news?: boolean; rounds?: number }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState(initial(opts.news ?? true, ticker.toUpperCase()));

    streamWorkflow(ticker, opts, (ev) => setState((prev) => reduceWf(prev, ev)), ac.signal)
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

/* ---------- pipeline UI ---------- */

// Gathering nodes first, then the two that read their output.
const STEPS: { key: WorkflowNode; label: string; icon: Icon }[] = [
  { key: "profile", label: "Profile", icon: IdentificationCardIcon },
  { key: "technical", label: "Technical", icon: ChartLineIcon },
  { key: "fundamental", label: "Fundamentals", icon: BuildingsIcon },
  { key: "news", label: "News", icon: NewspaperIcon },
  { key: "risk", label: "Risk", icon: ShieldWarningIcon },
  { key: "recall", label: "Memory", icon: BrainIcon },
  { key: "research", label: "Research", icon: MagnifyingGlassIcon },
];

function StatusIcon({ status }: { status: NodeStatus }) {
  switch (status) {
    case "running":
      return <CircleNotchIcon size={14} className="animate-spin text-primary" weight="bold" />;
    case "done":
      return <CheckCircleIcon size={14} className="text-positive" weight="fill" />;
    case "error":
      return <WarningCircleIcon size={14} className="text-amber-500" weight="fill" />;
    case "skipped":
      return <MinusCircleIcon size={14} className="text-muted-foreground" />;
    default:
      return <CircleIcon size={14} className="text-muted-foreground/40" />;
  }
}

function Pipeline({ state }: { state: WorkflowStreamState }) {
  const r = state.routing;
  // One agent's findings at a time, opened by clicking its chip.
  const [open, setOpen] = useState<WorkflowNode | null>(null);
  const openStep = STEPS.find((s) => s.key === open);
  const openData = open ? state.findings[open] : undefined;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn("inline-block size-2 rounded-full", state.running ? "animate-pulse bg-positive" : "bg-muted-foreground")}
        />
        <p className="text-sm font-medium">{state.ticker}</p>
        <p className="text-xs text-muted-foreground">· {state.status}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map(({ key, label, icon: Icon }) => {
          const st = state.nodes[key];
          const hasFindings = Boolean(state.findings[key]);
          const isOpen = open === key;
          return (
            <button
              key={key}
              type="button"
              disabled={!hasFindings}
              aria-expanded={isOpen}
              title={hasFindings ? `Show what the ${label.toLowerCase()} agent found` : undefined}
              onClick={() => setOpen(isOpen ? null : key)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-[11px] ring-1 ring-inset transition-colors",
                hasFindings ? "cursor-pointer hover:ring-primary/40" : "cursor-default",
                isOpen
                  ? "bg-primary/15 ring-primary/50"
                  : st === "running"
                    ? "bg-primary/8 ring-primary/30"
                    : st === "done"
                      ? "bg-positive/8 ring-positive/25"
                      : "ring-border"
              )}
            >
              <Icon size={13} className="text-muted-foreground" />
              <span>{label}</span>
              <StatusIcon status={st} />
              {hasFindings && (
                <CaretDownIcon
                  size={11}
                  className={cn("text-muted-foreground transition-transform", isOpen && "rotate-180")}
                />
              )}
            </button>
          );
        })}

        {r && (
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-[11px] ring-1 ring-inset",
              r.route === "quick" ? "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400" : "bg-primary/10 text-primary ring-primary/25"
            )}
            title={
              r.route === "quick"
                ? "Independent signals unanimous and research agrees — committee skipped."
                : r.risk_veto
                  ? "High volatility or beta — a risky name always gets the full committee, however aligned the signals."
                  : r.incomplete?.length
                    ? `Ran with incomplete data (${r.incomplete.join(", ")}) — full committee debate.`
                    : r.research_dissent
                      ? "Independent signals agreed but the research agent dissents — full committee debate."
                      : "Signals conflict — full committee debate."
            }
          >
            {r.route === "quick" ? "⚡ Fast path" : "⚖️ Committee"}
          </div>
        )}
      </div>

      {openStep && openData && (
        <div className="animate-in fade-in slide-in-from-top-1 border-t pt-3 duration-200">
          <div className="mb-2.5 flex items-center gap-1.5">
            <openStep.icon size={14} className="text-primary" />
            <p className="text-xs font-medium">{openStep.label}</p>
          </div>
          <AgentFindings node={openStep.key} data={openData} />
        </div>
      )}

      {r && Object.keys(r.votes).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(r.votes).map(([sig, vote]) => (
            <VoteBadge key={sig} signal={sig} vote={vote} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Full streaming-analysis view: live pipeline → committee chat → recommendation. */
export function WorkflowStreamView({ state }: { state: WorkflowStreamState }) {
  if (!state.ticker) return null;

  const isDebate = state.routing?.route === "debate";
  const isQuick = state.routing?.route === "quick";

  return (
    <div className="space-y-4">
      {/* Keyed so a new run starts with no panel open instead of the last stock's. */}
      <Pipeline key={state.ticker} state={state} />

      {state.error && (
        <div className="bg-negative/10 p-3 text-xs text-negative ring-1 ring-inset ring-negative/25">{state.error}</div>
      )}

      {isDebate && state.debate.ticker && <CommitteeDebate state={state.debate} />}

      {isQuick && !state.recommendation && (
        <div className="border border-dashed bg-card p-6 text-center text-xs text-muted-foreground">
          ⚡ Independent signals were unanimous — skipping the committee and issuing the call directly…
        </div>
      )}

      {state.recommendation && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          <RecommendationCard rec={state.recommendation} />
        </div>
      )}

      {state.errors.length > 0 && (
        <div className="bg-amber-500/10 p-3 text-[11px] text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
          <p className="mb-1 font-medium">Some steps had issues:</p>
          <ul className="list-inside list-disc">
            {state.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
