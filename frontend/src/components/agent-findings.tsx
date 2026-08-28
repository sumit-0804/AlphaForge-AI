"use client";

import { type ReactNode } from "react";
import type { WorkflowNode } from "@/lib/api";
import { compact, currency, dateTime, number, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ActionBadge,
  ConfidenceBadge,
  HealthBadge,
  RiskBadge,
  SentimentBadge,
} from "@/components/status-badges";

type Dict = Record<string, unknown>;

/* ---------- the shape each node already puts on the wire ---------- */

type Profile = {
  name?: string;
  sector?: string;
  currency?: string;
  currentPrice?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
};

type Technical = {
  price?: number;
  rsi?: number;
  ema_20?: number;
  ema_50?: number;
  macd?: number;
  adx?: number;
};

type Fundamental = {
  currency?: string;
  health?: { score?: number; label?: string };
  revenue?: Dict;
  valuation?: Dict;
  debt?: Dict;
  cashFlow?: Dict;
};

type Narrative = {
  summary?: string;
  revenue_analysis?: string;
  debt_analysis?: string;
  cash_flow_analysis?: string;
  strengths?: string[];
  weaknesses?: string[];
  verdict?: string;
};

type News = {
  articles?: { title?: string; link?: string; source?: string; published?: string }[];
  analysis?: {
    summary?: string;
    overall_sentiment?: string;
    sentiment_score?: number;
    highlights?: string[];
  };
};

type Risk = { volatility?: number; beta?: number; risk_level?: string; benchmark?: string };

type Memory = {
  prior_lessons?: string[];
  cross_ticker_lessons?: { ticker?: string; content?: string }[];
  past_recommendations?: { action?: string; confidence?: string; rationale?: string; at?: string }[];
  status?: string;
};

type Research = {
  report?: {
    summary?: string;
    strengths?: string[];
    weaknesses?: string[];
    recommendation?: string;
    confidence?: string;
    rationale?: string;
  };
};

/* ---------- shared presentation ---------- */

// The format helpers render null as an em dash; these keep it null so Metrics can drop the row.
const num = (v: unknown) => (typeof v === "number" ? number(v) : null);
const pct = (v: unknown) => (typeof v === "number" ? percent(v) : null);
const money = (v: unknown, code: string) => (typeof v === "number" ? currency(v, code) : null);
const big = (v: unknown, code: string) => (typeof v === "number" ? compact(v, code) : null);

type Metric = [string, ReactNode | null | undefined];

// Providers leave plenty of fields empty, so show the ones that came back rather than a wall of dashes.
function Metrics({ items }: { items: Metric[] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
      {shown.map(([label, value]) => (
        <div key={label}>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="tabular mt-0.5 text-xs">{value}</p>
        </div>
      ))}
    </div>
  );
}

function Prose({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function Section({ title, children }: { title: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Bullets({
  title,
  items,
  tone,
}: {
  title: string;
  items?: string[];
  tone?: "positive" | "negative";
}) {
  if (!items?.length) return null;
  return (
    <Section title={title}>
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-relaxed">
            <span
              className={cn(
                "select-none",
                tone === "positive"
                  ? "text-positive"
                  : tone === "negative"
                    ? "text-negative"
                    : "text-primary"
              )}
            >
              {tone === "positive" ? "+" : tone === "negative" ? "–" : "·"}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ---------- per-agent renderers ---------- */

function ProfileFindings({ d }: { d: Dict }) {
  const p = (d.profile ?? {}) as Profile;
  const code = p.currency ?? "USD";
  const { currentPrice: price, fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high } = p;
  // Where in the yearly range it sits, which the bare high and low do not tell you.
  const range =
    price != null && low != null && high != null && high > low
      ? `${(((price - low) / (high - low)) * 100).toFixed(0)}% of 52-week range`
      : null;
  return (
    <Metrics
      items={[
        ["Company", p.name],
        ["Sector", p.sector],
        ["Price", money(price, code)],
        ["52-week high", money(high, code)],
        ["52-week low", money(low, code)],
        ["Position", range],
      ]}
    />
  );
}

function TechnicalFindings({ d }: { d: Dict }) {
  const t = (d.technical ?? {}) as Technical;
  const { price, ema_20: e20, ema_50: e50, rsi } = t;
  // Same rule the routing gate votes on, so this panel and the vote badge cannot disagree.
  const trend =
    price != null && e20 != null && e50 != null
      ? price > e20 && e20 > e50
        ? "Uptrend — price is above both EMAs."
        : price < e20 && e20 < e50
          ? "Downtrend — price is below both EMAs."
          : "Mixed — the EMAs are not aligned, so this signal casts no vote."
      : null;
  const rsiRead = rsi == null ? null : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";
  return (
    <div className="space-y-3">
      <Metrics
        items={[
          ["Price", num(price)],
          ["RSI (14)", rsi != null ? `${number(rsi)} · ${rsiRead}` : null],
          ["EMA 20", num(e20)],
          ["EMA 50", num(e50)],
          ["MACD", num(t.macd)],
          ["ADX (14)", num(t.adx)],
        ]}
      />
      <Prose>{trend}</Prose>
    </div>
  );
}

function FundamentalFindings({ d }: { d: Dict }) {
  const f = (d.fundamental ?? {}) as Fundamental;
  const n = (d.fundamental_narrative ?? {}) as Narrative;
  const code = f.currency ?? "USD";
  const rev = (f.revenue ?? {}) as Dict;
  const val = (f.valuation ?? {}) as Dict;
  const debt = (f.debt ?? {}) as Dict;
  const cash = (f.cashFlow ?? {}) as Dict;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {f.health?.label && <HealthBadge value={f.health.label} />}
        {f.health?.score != null && (
          <span className="text-[11px] text-muted-foreground">Health score {f.health.score}/100</span>
        )}
      </div>
      <Prose>{n.summary}</Prose>
      <Metrics
        items={[
          ["Revenue", big(rev.totalRevenue, code)],
          ["Revenue growth", pct(rev.revenueGrowth)],
          ["Profit margin", pct(rev.profitMargin)],
          ["Trailing P/E", num(val.trailingPE)],
          ["Price / book", num(val.priceToBook)],
          ["Return on equity", pct(val.returnOnEquity)],
          ["Debt / equity", num(debt.debtToEquity)],
          ["Current ratio", num(debt.currentRatio)],
          ["Free cash flow", big(cash.freeCashflow, code)],
        ]}
      />
      <Section title="Revenue">
        <Prose>{n.revenue_analysis}</Prose>
      </Section>
      <Section title="Debt">
        <Prose>{n.debt_analysis}</Prose>
      </Section>
      <Section title="Cash flow">
        <Prose>{n.cash_flow_analysis}</Prose>
      </Section>
      <Bullets title="Strengths" items={n.strengths} tone="positive" />
      <Bullets title="Weaknesses" items={n.weaknesses} tone="negative" />
    </div>
  );
}

function NewsFindings({ d }: { d: Dict }) {
  const news = (d.news ?? {}) as News;
  const a = news.analysis ?? {};
  const articles = news.articles ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {a.overall_sentiment && <SentimentBadge value={a.overall_sentiment} />}
        {a.sentiment_score != null && (
          <span className="text-[11px] text-muted-foreground">
            Score {a.sentiment_score.toFixed(2)}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          · {articles.length} {articles.length === 1 ? "headline" : "headlines"}
        </span>
      </div>
      <Prose>{a.summary}</Prose>
      <Bullets title="Highlights" items={a.highlights} />
      {articles.length > 0 && (
        <Section title="Headlines read">
          <ul className="space-y-1.5">
            {articles.map((art, i) => (
              <li key={i} className="text-xs leading-relaxed">
                <a
                  href={art.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary hover:underline"
                >
                  {art.title}
                </a>
                {art.source && (
                  <span className="text-[10px] text-muted-foreground"> — {art.source}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function RiskFindings({ d }: { d: Dict }) {
  const r = (d.risk ?? {}) as Risk;
  return (
    <div className="space-y-3">
      <RiskBadge value={r.risk_level} />
      <Metrics
        items={[
          ["Annualised volatility", r.volatility != null ? `${number(r.volatility)}%` : null],
          ["Beta", num(r.beta)],
          ["Benchmark", r.benchmark],
        ]}
      />
      {/* Worth saying out loud: the gate treats risk as a veto, not as another vote. */}
      {r.risk_level === "HIGH" && (
        <Prose>
          A high-risk name always gets the full committee, however aligned the other signals are.
        </Prose>
      )}
    </div>
  );
}

function MemoryFindings({ d }: { d: Dict }) {
  const m = (d.memory ?? {}) as Memory;
  const cross = m.cross_ticker_lessons ?? [];
  const past = m.past_recommendations ?? [];
  if (!m.prior_lessons?.length && !cross.length && !past.length) {
    return (
      <Prose>
        Nothing recalled for this stock yet{m.status ? ` (${m.status})` : ""} — lessons get written
        after a position closes.
      </Prose>
    );
  }
  return (
    <div className="space-y-3">
      <Bullets title="Lessons from this stock" items={m.prior_lessons} />
      {cross.length > 0 && (
        <Section title="Lessons from similar setups elsewhere">
          <ul className="space-y-1">
            {cross.map((c, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-relaxed">
                <span className="shrink-0 font-medium text-primary">{c.ticker}</span>
                <span className="text-muted-foreground">{c.content}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Past calls on this stock">
          <ul className="space-y-2">
            {past.map((p, i) => (
              <li key={i} className="text-xs leading-relaxed">
                <div className="flex items-center gap-1.5">
                  {p.action && <ActionBadge value={p.action} />}
                  {p.confidence && (
                    <span className="text-[10px] text-muted-foreground">{p.confidence}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">{dateTime(p.at)}</span>
                </div>
                {p.rationale && <p className="mt-0.5 text-muted-foreground">{p.rationale}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ResearchFindings({ d }: { d: Dict }) {
  const rep = ((d.research ?? {}) as Research).report ?? {};
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {rep.recommendation && <ActionBadge value={rep.recommendation} />}
        {rep.confidence && <ConfidenceBadge value={rep.confidence} />}
      </div>
      <Prose>{rep.summary}</Prose>
      <Bullets title="Strengths" items={rep.strengths} tone="positive" />
      <Bullets title="Weaknesses" items={rep.weaknesses} tone="negative" />
      <Section title="Rationale">
        <Prose>{rep.rationale}</Prose>
      </Section>
    </div>
  );
}

const RENDERERS: Record<WorkflowNode, (p: { d: Dict }) => ReactNode> = {
  profile: ProfileFindings,
  technical: TechnicalFindings,
  fundamental: FundamentalFindings,
  news: NewsFindings,
  risk: RiskFindings,
  recall: MemoryFindings,
  research: ResearchFindings,
};

/** What one agent found, rendered from the payload its node already streams. */
export function AgentFindings({ node, data }: { node: WorkflowNode; data: Dict }) {
  const Renderer = RENDERERS[node];
  return <Renderer d={data} />;
}
