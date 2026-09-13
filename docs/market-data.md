# Market data and quota

Where the numbers come from, and how model usage is kept inside the Gemini quota.

## Market data

- **Quotes, history, search** — yfinance, each cached for five minutes.
- **News** — Google News RSS over the last `NEWS_DAYS` (7), with the region taken from
  the ticker's exchange first. The query is `"Company Name" stock`, widened to
  `("Company Name" OR SYMBOL) stock` when the symbol is distinctive (four or more
  characters and not part of the name). Headlines are filtered to ones actually about
  the company — except when the name is unknown, where filtering would discard
  everything, and for non-Latin-script headlines, which the name filter can't judge.
- **Risk benchmark** — chosen per ticker: Nifty 50 (`^NSEI`) for `.NS`/`.BO`, S&P 500
  (`^GSPC`) for everything else. In the book-level risk report each position's beta
  is still measured against its own market's index.
- **FX** — Frankfurter (ECB rates), cached for an hour, handles pence-quoted listings
  (`GBp`, `ZAc`). When no rate is available a trade is refused with `503` rather than
  booked at a guessed rate.
- **Exchanges** — 25 Yahoo suffixes are recognised for currency. Market sessions exist
  for India (09:15–15:30 IST) and the US (09:30–16:00 ET), weekdays only; holidays are
  ignored.
- **Live prices** — one shared yfinance streaming WebSocket, reference-counted per
  symbol and seeded with 5 days of candles, fanned out to browsers over
  `WS /api/live`.
- **Paper trading** — a per-user book starting with ₹100,000 in `BASE_CURRENCY`
  (INR). Positions keep their listing currency and cost basis in base currency;
  transactions record the FX rate used. Allocation caps: 25% per position, 40% per
  sector, 10% cash reserve.

## Rate limiting and quota

Every outbound model call passes through a shared limiter (`app/core/ratelimit.py`)
enforcing requests-per-minute, tokens-per-minute and requests-per-day. Chat and
embeddings have separate budgets:

| Budget | RPM | TPM | RPD |
| --- | --- | --- | --- |
| Chat (`gemini-chat`) | 12 | 200,000 | 400 |
| Embeddings (`gemini-embed`) | 80 | 24,000 | 800 |

Token cost is estimated up front (about four characters per token plus a 1,200-token
output reservation) and corrected with the real count from the response.

The two horizons behave differently on purpose. **Per-minute** overruns make the
caller *wait* — a few seconds in a request that already takes tens of them. The
**daily** cap instead *rejects* with `429` and a `Retry-After` counting down to the
reset (midnight in `QUOTA_RESET_TIMEZONE`), because no browser should hold a
connection that long. A daily count that resets on redeploy is worthless, so it lives
in Mongo (`daily_quota_usage`) rather than in memory. Other model errors surface as
`502`.

Two consequences to keep in mind:

- **The per-minute window is per-process.** It is a plain in-memory deque behind an
  `asyncio.Lock`, so a second uvicorn worker or container means a second per-minute
  budget against one shared quota. The Dockerfile defaults to one worker
  (`WEB_CONCURRENCY`); on Cloud Run, keep the instance count and concurrency in mind.
- **SDK retries stay off.** `ChatGoogleGenerativeAI` defaults to six internal
  retries, each a real request the limiter never sees, triggered by exactly the 429s
  it is trying to avoid. `LLMService` sets `max_retries=1` (the SDK reads `0` as "use
  the default", not "none"); repair retries happen in `chat_json`, through the
  limiter.

The daily report adds its own guards: a second concurrent report from the same
account gets `409`; a precheck rejects with `429` (`Retry-After: 3600`) when fewer than
the two chat calls it needs remain today, rather than half-building a report; and at
most two reports build at once across the process (`429`, `Retry-After: 120`).

`GET /api/reports/quota` returns both budgets, per-minute and per-day, with the reset
time — cheap enough for the UI to poll.
