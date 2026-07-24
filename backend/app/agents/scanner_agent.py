"""Triage agent — turns raw scanner hits into a ranked, explained shortlist.

Deliberately ONE LLM call for the entire candidate list rather than one per
candidate. Running the full workflow graph over a 16-name universe would cost
roughly 300 model calls, which at the shared 10 req/min limiter is ~25 minutes
for a single scan. This pass is the cheap middle tier: it reads the whole set at
once, ranks it, and says why — so the user can decide which one or two names
actually deserve the expensive per-ticker analysis.
"""

import json

from fastapi import HTTPException

from app.services.llm_service import LLMService

SYSTEM_PROMPT = (
    "You are AlphaForge Scanner Agent. You are given a list of stocks that just "
    "triggered technical entry signals, each with a rule-based score and the "
    "indicator readings behind it. Rank them by how compelling the setup is, and "
    "say plainly what the pattern suggests and what would invalidate it. Be "
    "sceptical: a high rule score is not automatically a good setup, and you "
    "should mark weak or conflicted ones as such. Respond ONLY with a valid JSON "
    "object — no markdown:\n"
    "{\n"
    '  "ranked": [\n'
    "    {\n"
    '      "symbol": "TICKER",\n'
    '      "rank": 1,\n'
    '      "conviction": "HIGH | MEDIUM | LOW",\n'
    '      "thesis": "1-2 sentences on what the setup implies, citing the numbers",\n'
    '      "invalidation": "what would prove this setup wrong",\n'
    '      "worth_deep_analysis": true\n'
    "    }\n"
    "  ],\n"
    '  "summary": "1-2 sentences on the overall tone of this scan"\n'
    "}\n"
    "Rank EVERY symbol you are given, exactly once. "
    "This is educational analysis, not financial advice."
)


def _make_validator(symbols: set[str]):
    def _validate(obj: dict) -> str | None:
        ranked = obj.get("ranked")
        if not isinstance(ranked, list) or not ranked:
            return "The 'ranked' field must be a non-empty array."
        got = {r.get("symbol") for r in ranked if isinstance(r, dict)}
        missing = symbols - got
        unknown = got - symbols
        # The model must cover exactly the given candidates — no drops, no invented tickers.
        if missing:
            return f"These symbols are missing from 'ranked': {sorted(missing)}."
        if unknown:
            return f"These symbols were not in the candidate list: {sorted(unknown)}."
        return None

    return _validate


class ScannerAgentService:
    @classmethod
    async def triage(cls, candidates: list[dict]) -> dict:
        if not candidates:
            return {"ranked": [], "summary": "No candidates matched the scan.", "valid": True}

        symbols = {c["symbol"] for c in candidates}
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Scan candidates ({len(candidates)}):\n"
                    f"{json.dumps(candidates, indent=2, default=str)}\n\n"
                    "Return the JSON ranking now."
                ),
            },
        ]
        try:
            # Fall back to the rule-based ranking if the model can't return a clean list.
            result = await LLMService.chat_json(
                messages,
                fallback={
                    "ranked": [
                        {
                            "symbol": c["symbol"],
                            "rank": i + 1,
                            "conviction": "MEDIUM",
                            "thesis": f"Rule-based signals: {', '.join(c.get('signals', []))}.",
                            "invalidation": "",
                            "worth_deep_analysis": True,
                        }
                        for i, c in enumerate(candidates)
                    ],
                    "summary": "Ranked by rule score; the agent's read was unavailable.",
                },
                temperature=0.1,
                validate=_make_validator(symbols),
            )
            return {**result["data"], "valid": result["valid"]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Scanner agent failed: {e}")
