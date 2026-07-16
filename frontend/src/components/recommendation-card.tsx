import type { Recommendation } from "@/lib/api";

function badgeClass(kind: "action" | "confidence" | "sentiment", value: string): string {
    const v = (value ?? "").toUpperCase();
    const green = "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30";
    const red = "bg-red-500/15 text-red-600 ring-red-500/30";
    const amber = "bg-amber-500/15 text-amber-600 ring-amber-500/30";
    const muted = "bg-muted text-muted-foreground ring-border";

    if (kind === "action") return v === "BUY" ? green : v === "SELL" ? red : amber;
    if (kind === "confidence") return v === "HIGH" ? green : v === "MEDIUM" ? amber : muted;
    // sentiment
    return v === "BULLISH" ? green : v === "BEARISH" ? red : muted;
}

function Badge({ kind, value }: { kind: "action" | "confidence" | "sentiment"; value: string }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(
                kind,
                value
            )}`}
        >
            {value}
        </span>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {title}
            </p>
            {children}
        </div>
    );
}

function Chip({ text, tone }: { text: string; tone: "pass" | "fail" }) {
    const cls =
        tone === "pass"
            ? "bg-emerald-500/10 text-emerald-600"
            : "bg-red-500/10 text-red-600";
    return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
    const e = rec.explanation;
    const f = e.fundamental_analysis;
    const d = e.debate_outcome;
    const routing = e.routing;
    const learned = e.learned_context;

    return (
        <div className="space-y-4">
            {/* Header: action + confidence + rationale */}
            <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-semibold tracking-tight">{rec.symbol}</h2>
                    <Badge kind="action" value={rec.action} />
                    <span className="text-xs text-muted-foreground">confidence</span>
                    <Badge kind="confidence" value={rec.confidence} />
                    {routing && (
                        <span
                            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
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
                {rec.rationale && (
                    <p className="mt-3 text-sm text-muted-foreground">{rec.rationale}</p>
                )}
                {routing && Object.keys(routing.signal_votes).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {Object.entries(routing.signal_votes).map(([sig, vote]) => (
                            <span
                                key={sig}
                                className={`rounded px-2 py-0.5 text-xs ${
                                    vote > 0
                                        ? "bg-emerald-500/10 text-emerald-600"
                                        : vote < 0
                                          ? "bg-red-500/10 text-red-600"
                                          : "bg-muted text-muted-foreground"
                                }`}
                            >
                                {sig} {vote > 0 ? "▲" : vote < 0 ? "▼" : "–"}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* Technical reasons */}
                <Section title="Technical reasons">
                    {e.technical_reasons.length ? (
                        <ul className="space-y-1.5 text-sm">
                            {e.technical_reasons.map((r, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="text-muted-foreground">•</span>
                                    <span>{r}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">No technical data.</p>
                    )}
                </Section>

                {/* News */}
                <Section title="News summary">
                    <div className="mb-2">
                        <Badge kind="sentiment" value={e.news_sentiment} />
                    </div>
                    <p className="text-sm text-muted-foreground">{e.news_summary}</p>
                </Section>

                {/* Fundamentals */}
                <Section title="Fundamental analysis">
                    <p className="mb-3 text-sm">
                        Health:{" "}
                        <span className="font-medium">
                            {f.health_score ?? "-"}
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
                <Section title="Debate outcome">
                    <div className="mb-2 flex items-center gap-2">
                        <Badge kind="action" value={d.decision} />
                        {typeof d.rounds === "number" && d.rounds > 0 && (
                            <span className="text-xs text-muted-foreground">
                                {d.rounds} round{d.rounds > 1 ? "s" : ""}
                                {d.converged ? " · converged early" : ""}
                            </span>
                        )}
                    </div>
                    {d.rationale && (
                        <p className="mb-3 text-sm text-muted-foreground">{d.rationale}</p>
                    )}
                    <div className="space-y-2 text-sm">
                        {d.bull_case && (
                            <p>
                                <span className="font-medium text-emerald-600">Bull: </span>
                                {d.bull_case}
                            </p>
                        )}
                        {d.bear_case && (
                            <p>
                                <span className="font-medium text-red-600">Bear: </span>
                                {d.bear_case}
                            </p>
                        )}
                    </div>
                </Section>
            </div>

            {/* Learned context — the closed memory loop */}
            {learned && learned.prior_lessons.length > 0 && (
                <Section title="🧠 Learned from past trades">
                    <ul className="space-y-1.5 text-sm">
                        {learned.prior_lessons.map((l, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-violet-500">•</span>
                                <span className="text-muted-foreground">{l}</span>
                            </li>
                        ))}
                    </ul>
                    {learned.past_recommendations.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            {learned.past_recommendations.length} prior recommendation
                            {learned.past_recommendations.length > 1 ? "s" : ""} on record — latest:{" "}
                            <span className="font-medium">
                                {learned.past_recommendations[0].action}
                            </span>
                        </p>
                    )}
                </Section>
            )}

            {/* Catalysts / Risks */}
            {(rec.catalysts.length > 0 || rec.risks.length > 0) && (
                <div className="grid gap-4 lg:grid-cols-2">
                    {rec.catalysts.length > 0 && (
                        <Section title="Catalysts">
                            <ul className="space-y-1.5 text-sm">
                                {rec.catalysts.map((c, i) => (
                                    <li key={i} className="flex gap-2">
                                        <span className="text-emerald-600">↑</span>
                                        <span>{c}</span>
                                    </li>
                                ))}
                            </ul>
                        </Section>
                    )}
                    {rec.risks.length > 0 && (
                        <Section title="Risks">
                            <ul className="space-y-1.5 text-sm">
                                {rec.risks.map((r, i) => (
                                    <li key={i} className="flex gap-2">
                                        <span className="text-red-600">↓</span>
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
