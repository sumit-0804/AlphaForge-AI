"use client";

import { cn } from "@/lib/utils";
import { sentence } from "@/lib/format";
import type { Consensus, DebateDecision, Recommendation, RiskBlock } from "@/lib/api";

function toneFor(action: string): string {
  const a = action.toUpperCase();
  if (a === "BUY") return "text-up";
  if (a === "SELL") return "text-down";
  return "text-foreground";
}

const CONFIDENCE_LINE: Record<string, string> = {
  HIGH: "It is confident about this.",
  MEDIUM: "It is reasonably confident.",
  LOW: "It is not very confident.",
};

/** The headline call, in the same words a person would use out loud. */
export function Verdict({
  action,
  confidence,
  rationale,
  lead,
}: {
  action: string;
  confidence?: string | null;
  rationale?: string | null;
  lead?: string;
}) {
  return (
    <div>
      {lead && <p className="text-sm text-ink-3">{lead}</p>}
      <p className={cn("display glow-text mt-1", toneFor(action))}>{sentence(action)}</p>
      {confidence && (
        <p className="mt-1 text-sm text-ink-3">
          {CONFIDENCE_LINE[confidence.toUpperCase()] ?? `Confidence: ${sentence(confidence)}.`}
        </p>
      )}
      {rationale && <p className="mt-3 text-[15px] text-ink-2">{rationale}</p>}
    </div>
  );
}

export function RiskCaveat({ risk }: { risk?: RiskBlock }) {
  if (!risk?.confidence_capped) return null;
  return (
    <p className="mt-3 text-sm text-ink-3">
      Confidence was held back because this name moves a lot
      {risk.volatility != null ? ` — volatility runs near ${risk.volatility.toFixed(0)}%` : ""}.
    </p>
  );
}

const AGENT_NAME: Record<string, string> = {
  technical: "the price action",
  fundamental: "the financials",
  news: "the news",
  research: "the research agent",
};

// Reads the backend's node keys back as the words the rest of the screen already uses.
function AGENTS(keys: string[]): string {
  const names = keys.map((k) => AGENT_NAME[k] ?? k);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Says which path the run took and why, instead of showing a vote table. */
export function RoutingNote({ consensus }: { consensus: Consensus }) {
  const votes = Object.keys(consensus.votes ?? {}).length;

  if (consensus.route === "quick") {
    return (
      <p className="text-[15px] text-ink-2">
        All {votes} agents pointed the same way, so it decided without a debate.
      </p>
    );
  }

  const reasons: string[] = [];
  if (consensus.abstained?.length) {
    reasons.push(`${AGENTS(consensus.abstained)} had no clear opinion`);
  }
  if (consensus.research_dissent) reasons.push("the research agent disagreed with the indicators");
  if (consensus.risk_veto) reasons.push("this name is volatile enough to be worth arguing over");
  if (consensus.incomplete?.length) reasons.push(`${consensus.incomplete.join(" and ")} came back empty`);
  if (!consensus.unanimous && !reasons.length) reasons.push("the agents did not agree");

  return (
    <p className="text-[15px] text-ink-2">
      It ran a full debate{reasons.length ? ` because ${reasons.join(", and ")}` : ""}.
    </p>
  );
}

export function Evidence({ recommendation }: { recommendation: Recommendation }) {
  const { catalysts, risks } = recommendation;
  if (!catalysts?.length && !risks?.length) return null;

  return (
    <div className="flex flex-col gap-5">
      {catalysts?.length > 0 && (
        <div>
          <p className="text-[13px] text-ink-3">What would prove it right</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {catalysts.map((c, i) => (
              <li key={i} className="text-sm text-ink-2">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {risks?.length > 0 && (
        <div>
          <p className="text-[13px] text-ink-3">What would prove it wrong</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {risks.map((r, i) => (
              <li key={i} className="text-sm text-ink-2">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DecisionSummary({ decision }: { decision: DebateDecision }) {
  if (!decision.bull_summary && !decision.bear_summary) return null;
  return (
    <div className="flex flex-col gap-2">
      {decision.bull_summary && (
        <p className="text-sm text-ink-2">
          <span aria-hidden>🐂</span> <span className="text-up">Bull</span> · {decision.bull_summary}
        </p>
      )}
      {decision.bear_summary && (
        <p className="text-sm text-ink-2">
          <span aria-hidden>🐻</span> <span className="text-down">Bear</span> · {decision.bear_summary}
        </p>
      )}
    </div>
  );
}
