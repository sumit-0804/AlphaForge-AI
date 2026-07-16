"use client";

import { useState } from "react";
import { TickerSearch } from "@/components/ticker-search";
import { CommitteeDebate, useDebateStream } from "@/components/committee-debate";

export default function CommitteePage() {
    const [ticker, setTicker] = useState("");
    const [rounds, setRounds] = useState(3);
    const [includeNews, setIncludeNews] = useState(false);
    const { state, run, cancel } = useDebateStream();

    function submit(e: React.FormEvent) {
        e.preventDefault();
        const t = ticker.trim().toUpperCase();
        if (t) run(t, { news: includeNews, rounds });
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Critics Committee</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Watch a Bull and Bear analyst argue a stock in real time — opening statements,
                    live rebuttals, then a moderator&apos;s verdict. The committee remembers lessons
                    from past trades before it starts.
                </p>
            </div>

            {/* controls */}
            <form
                onSubmit={submit}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
            >
                <TickerSearch
                    value={ticker}
                    onChange={setTicker}
                    onSelect={setTicker}
                    placeholder="Search name or ticker e.g. Apple"
                    className="flex-1 min-w-48"
                />

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Rounds
                    <select
                        value={rounds}
                        onChange={(e) => setRounds(Number(e.target.value))}
                        className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                        {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={includeNews}
                        onChange={(e) => setIncludeNews(e.target.checked)}
                    />
                    Include news
                </label>

                {state.running ? (
                    <button
                        type="button"
                        onClick={cancel}
                        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                        Stop
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={!ticker.trim()}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                        Open the floor
                    </button>
                )}
            </form>

            <CommitteeDebate state={state} />
        </div>
    );
}
