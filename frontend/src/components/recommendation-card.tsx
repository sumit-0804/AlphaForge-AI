import type { Recommendation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  ActionBadge,
  ConfidenceBadge,
  SentimentBadge,
  RiskBadge,
  VoteBadge,
} from "@/components/status-badges";
import { LearningStatusChip } from "@/components/learning-status";

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-2 p-4", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </Card>
  );
}

function Chip({ text, tone }: { text: string; tone: "pass" | "fail" }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 text-[11px]",
        tone === "pass" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
      )}
    >
      {text}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular text-sm font-medium">{value}</p>
    </div>
  );
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const e = rec.explanation;
  const f = e.fundamental_analysis;
  const d = e.debate_outcome;
  const routing = e.routing;
  const learned = e.learned_context;
  const risk = e.risk;
  const cross = learned?.cross_ticker_lessons ?? [];

  return (
    <div className="space-y-4">
      {/* Header: action + confidence + rationale */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">{rec.symbol}</h2>
          <ActionBadge value={rec.action} />
          <span className="text-[11px] text-muted-foreground">confidence</span>
          <ConfidenceBadge value={rec.confidence} />
          {routing && (
            <span
              className="ml-auto inline-flex items-center gap-1.5 bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              title={
                routing.path === "quick_decision"
                  ? "Signals were unanimous — the graph skipped the debate."
                  : "Signals conflicted — the graph ran the full committee."
              }
            >
              {routing.path === "quick_decision" ? "⚡ fast path" : "⚖️ committee"}
              {routing.unanimous ? " · unanimous" : ""}
            </span>
          )}
        </div>
        {rec.rationale && <p className="text-xs/relaxed text-muted-foreground">{rec.rationale}</p>}
        {routing && Object.keys(routing.signal_votes).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(routing.signal_votes).map(([sig, vote]) => (
              <VoteBadge key={sig} signal={sig} vote={vote} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Technical reasons */}
        <Section title="Technical reasons">
          {e.technical_reasons.length ? (
            <ul className="space-y-1.5 text-xs/relaxed">
              {e.technical_reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No technical data.</p>
          )}
        </Section>

        {/* Risk — the new per-ticker block */}
        {risk && (
          <Section title="Risk profile">
            <div className="mb-2 flex items-center gap-2">
              <RiskBadge value={risk.risk_level} />
              {risk.confidence_capped && (
                <span className="bg-amber-500/12 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  confidence capped → MEDIUM
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Volatility" value={risk.volatility != null ? `${risk.volatility}%` : "—"} />
              <Metric label="Beta" value={risk.beta != null ? String(risk.beta) : "—"} />
              <Metric label="Benchmark" value={risk.benchmark ?? "—"} />
            </div>
          </Section>
        )}

        {/* News */}
        <Section title="News summary">
          <div className="mb-1">
            <SentimentBadge value={e.news_sentiment} />
          </div>
          <p className="text-xs/relaxed text-muted-foreground">{e.news_summary}</p>
        </Section>

        {/* Fundamentals */}
        <Section title="Fundamental analysis">
          <p className="mb-2 text-xs">
            Health:{" "}
            <span className="font-medium">
              {f.health_score ?? "—"}
              {f.health_label ? ` (${f.health_label})` : ""}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {f.passed_checks.map((c) => (
              <Chip key={c} text={`✓ ${c}`} tone="pass" />
            ))}
            {f.failed_checks.map((c) => (
              <Chip key={c} text={`✕ ${c}`} tone="fail" />
            ))}
          </div>
        </Section>

        {/* Debate outcome */}
        <Section title="Debate outcome" className="lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <ActionBadge value={d.decision} />
            {typeof d.rounds === "number" && d.rounds > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {d.rounds} round{d.rounds > 1 ? "s" : ""}
                {d.converged ? " · converged early" : ""}
              </span>
            )}
          </div>
          {d.rationale && <p className="mb-2 text-xs/relaxed text-muted-foreground">{d.rationale}</p>}
          <div className="grid gap-2 text-xs/relaxed sm:grid-cols-2">
            {d.bull_case && (
              <p>
                <span className="font-medium text-positive">Bull: </span>
                {d.bull_case}
              </p>
            )}
            {d.bear_case && (
              <p>
                <span className="font-medium text-negative">Bear: </span>
                {d.bear_case}
              </p>
            )}
          </div>
        </Section>
      </div>

      {/* Learned context — the closed memory loop */}
      {learned && (learned.prior_lessons.length > 0 || cross.length > 0 || learned.status) && (
        <Section title="🧠 Learned from past trades">
          {learned.prior_lessons.length > 0 && (
            <ul className="space-y-1.5 text-xs/relaxed">
              {learned.prior_lessons.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span className="text-muted-foreground">{l}</span>
                </li>
              ))}
            </ul>
          )}
          {cross.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                From similar setups on other stocks
              </p>
              <ul className="space-y-1 text-xs/relaxed">
                {cross.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{c.ticker ?? "—"}</span>: {c.content}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {learned.past_recommendations.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {learned.past_recommendations.length} prior recommendation
                {learned.past_recommendations.length > 1 ? "s" : ""} on record — latest:{" "}
                <span className="font-medium">{learned.past_recommendations[0].action}</span>
              </p>
            )}
            {learned.prior_lessons.length === 0 && cross.length === 0 && (
              <LearningStatusChip status={learned.status} />
            )}
          </div>
        </Section>
      )}

      {/* Catalysts / Risks */}
      {(rec.catalysts.length > 0 || rec.risks.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {rec.catalysts.length > 0 && (
            <Section title="Catalysts">
              <ul className="space-y-1.5 text-xs/relaxed">
                {rec.catalysts.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-positive">↑</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {rec.risks.length > 0 && (
            <Section title="Key risks">
              <ul className="space-y-1.5 text-xs/relaxed">
                {rec.risks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-negative">↓</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
