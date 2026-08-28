"use client";

import { CheckIcon, WarningIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { num, percent } from "@/lib/format";
import type { WorkflowNode } from "@/lib/api";

export type NodeState = {
  status: "waiting" | "running" | "done" | "error";
  data?: Record<string, unknown>;
  warnings?: string[];
};

export type NodeMap = Record<WorkflowNode, NodeState>;

export const NODE_ORDER: WorkflowNode[] = [
  "profile",
  "technical",
  "fundamental",
  "news",
  "risk",
  "recall",
  "research",
];

const LABEL: Record<WorkflowNode, string> = {
  profile: "Company",
  technical: "Price action",
  fundamental: "Financials",
  news: "News",
  risk: "Risk",
  recall: "Memory",
  research: "Research",
};

// One face per agent, so a repeating row becomes scannable rather than decorated.
const EMOJI: Record<WorkflowNode, string> = {
  profile: "🏢",
  technical: "📈",
  fundamental: "📊",
  news: "📰",
  risk: "⚠️",
  recall: "🧠",
  research: "🔬",
};

export function emptyNodes(): NodeMap {
  return NODE_ORDER.reduce((acc, n) => {
    acc[n] = { status: "waiting" };
    return acc;
  }, {} as NodeMap);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function n(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function summarise(node: WorkflowNode, data?: Record<string, unknown>): string | null {
  const text = build(node, data);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}

/** One plain sentence per agent, built from whatever the node actually returned. */
function build(node: WorkflowNode, data?: Record<string, unknown>): string | null {
  if (!data) return null;

  if (node === "profile") {
    const p = obj(data.profile);
    if (!p) return null;
    const name = str(p.name);
    const sector = str(p.sector);
    if (name && sector) return `${name}, in ${sector.toLowerCase()}.`;
    return name ?? sector ?? null;
  }

  if (node === "technical") {
    const t = obj(data.technical);
    if (!t) return null;
    const parts: string[] = [];
    const rsi = n(t.rsi);
    if (rsi != null) parts.push(`RSI ${rsi.toFixed(0)}`);
    const price = n(t.price);
    const ema50 = n(t.ema_50);
    if (price != null && ema50 != null) {
      parts.push(price >= ema50 ? "above its 50-day average" : "below its 50-day average");
    }
    const adx = n(t.adx);
    if (adx != null) parts.push(adx >= 25 ? "trending" : "no clear trend");
    return parts.length ? `${parts.join(", ")}.` : null;
  }

  if (node === "fundamental") {
    const health = obj(obj(data.fundamental)?.health);
    const score = n(health?.score);
    const label = str(health?.label);
    if (score == null) return label ? `Financial health looks ${label.toLowerCase()}.` : null;
    return `Health scores ${score.toFixed(0)} out of 100${label ? `, which is ${label.toLowerCase()}` : ""}.`;
  }

  if (node === "news") {
    const news = obj(data.news);
    const analysis = obj(news?.analysis);
    const count = list(news?.articles).length;
    const tone = str(analysis?.overall_sentiment);
    if (!tone && !count) return null;
    if (!count) return tone ? `Tone is ${tone.toLowerCase()}, but nothing recent turned up.` : null;
    return `${num(count)} recent ${count === 1 ? "item" : "items"}${tone ? `, reading ${tone.toLowerCase()}` : ""}.`;
  }

  if (node === "risk") {
    const r = obj(data.risk);
    if (!r) return null;
    const parts: string[] = [];
    const vol = n(r.volatility);
    if (vol != null) parts.push(`volatility ${percent(vol, 0)}`);
    const beta = n(r.beta);
    if (beta != null) parts.push(`beta ${beta.toFixed(1)}`);
    const level = str(r.risk_level);
    if (!parts.length) return level ? `Risk looks ${level.toLowerCase()}.` : null;
    return `${parts.join(", ")}${level ? ` — ${level.toLowerCase()} risk` : ""}.`;
  }

  if (node === "recall") {
    const m = obj(data.memory);
    if (!m) return null;
    const lessons = list(m.prior_lessons).length + list(m.cross_ticker_lessons).length;
    const past = list(m.past_recommendations).length;
    if (!lessons && !past) return "Nothing learned about this one yet.";
    const bits: string[] = [];
    if (lessons) bits.push(`${num(lessons)} ${lessons === 1 ? "lesson" : "lessons"} from closed trades`);
    if (past) bits.push(`${num(past)} earlier ${past === 1 ? "call" : "calls"}`);
    return `Recalled ${bits.join(" and ")}.`;
  }

  if (node === "research") {
    const report = obj(obj(data.research)?.report);
    return str(report?.summary) ?? str(report?.rationale);
  }

  return null;
}

export function AgentProgress({ nodes, includeNews }: { nodes: NodeMap; includeNews: boolean }) {
  const shown = NODE_ORDER.filter((node) => includeNews || node !== "news");

  return (
    <ul className="flex flex-col">
      {shown.map((node) => {
        const state = nodes[node];
        const summary = summarise(node, state.data);
        return (
          <li
            key={node}
            className="flex min-h-12 items-start gap-3 border-b border-border py-2.5 last:border-0"
          >
            <span className="mt-0.5 flex w-[6.5rem] shrink-0 items-center gap-1.5 text-[13px] text-ink-3">
              <Dot status={state.status} />
              <span aria-hidden>{EMOJI[node]}</span>
              {LABEL[node]}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 text-sm",
                state.status === "done" ? "text-ink-2" : "text-ink-3"
              )}
            >
              {state.status === "error"
                ? "Couldn't load this one, so the rest carried on without it."
                : state.status === "running"
                  ? "Working…"
                  : state.status === "waiting"
                    ? "Waiting"
                    : (summary ?? "Done.")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Dot({ status }: { status: NodeState["status"] }) {
  if (status === "done") return <CheckIcon size={13} className="text-up" weight="bold" />;
  if (status === "error") return <WarningIcon size={13} className="text-down" />;
  return (
    <span
      className={cn(
        status === "running" ? "dot-accent breathe" : "size-1.5 rounded-full bg-border"
      )}
    />
  );
}
