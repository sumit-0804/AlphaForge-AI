# Frontend

Routes and the behaviour worth knowing about. Source layout lives in [`frontend/README.md`](../frontend/README.md).

The app is mobile-first and dark-only. On phones there is a sticky header and a
bottom tab bar; from the `md` breakpoint up the same tabs move into a 240px left rail,
with content capped at a readable column width.

| Route | Tab | What it's for |
| --- | --- | --- |
| `/` | Look up | Ticker search, watchlist chips, recent calls |
| `/stock/[symbol]` | (Look up) | One stock: live price header, chart, watchlist star, Buy/Sell, deep analysis, earlier calls |
| `/scanner` | Ideas | Market sessions, ALL / IN / US universe, on-demand scan with LLM triage |
| `/portfolio` | Book | Total value, P&L, cash, positions, on-demand advisor, link to the daily report |
| `/transactions` | History | Executed paper trades |
| `/reports` | account sheet | Build and read the daily report: book, risk, allocation, scan |
| `/settings` | account sheet | Email, learning-loop health, model quota, change password, sign out |
| `/login` | — | Sign in / create an account; the only route outside the app shell |

Every stock anywhere in the app (search results, watchlist, scan rows, positions, past
calls) links to `/stock/[symbol]`, which is the one place analysis and trading happen.

Model-spending actions are always explicit clicks. The scanner doesn't scan on page
load, and the advisor doesn't run until you ask it to, so opening a tab never spends
quota.

Notes worth knowing:

- **Auth gate.** `(app)/layout.tsx` renders `AppShell`, which redirects anonymous users
  to `/login` and shows "Signing you in…" while a stored token is checked against
  `/auth/me`. It's a convenience only: the API rejects unauthenticated requests either
  way. Any 401 clears the token, and sign-in or sign-out clears the React Query cache,
  so the next account can't read the previous one's portfolio out of it.
- **Deep analysis.** `analysis-run.tsx` streams `/workflow/{ticker}/stream` with
  `streamWorkflow` in `src/lib/api.ts`. It reads SSE through `fetch` with a manual
  reader, because `EventSource` can't send an `Authorization` header. Each agent
  reports a one-sentence finding as it completes, followed by the routing note, the
  verdict, and any risk caveat. "Run again" passes `fresh=true`. You choose the
  number of debate rounds (1–5) before a run.
- **Committee debate.** There is no separate route. When a run takes the debate
  path, "See the debate" opens a full-screen sheet with chat-style Bull/Bear rounds
  and the moderator's verdict, all taken from the workflow stream.
  `/debate/{ticker}/stream` isn't used by the UI.
- **Data layer.** All server state goes through TanStack Query hooks in
  `src/lib/queries.ts` (30 s stale time, retry once). Trades invalidate the portfolio,
  transactions and advisor queries.
- **Live price.** `src/lib/live.ts` holds a WebSocket per stock header. The token
  travels as a subprotocol, and reconnects back off up to 15 s, because Cloud Run cuts
  sockets at 60 minutes. Ticks are folded into today's candle on the chart.
- **Watchlist** is a persisted Zustand store in `localStorage` (newest first, max 24).
  You star a stock on its page and it shows up on the Look up tab.
- **Currency is never assumed.** `money()` requires an explicit code; INR uses `en-IN`
  lakh/crore grouping. A position with no FX rate is excluded from the book total and
  named as unconverted rather than silently mis-added.
- **Theme.** "Neon forge" tokens in `globals.css`, one colour per job:
  - orange `--primary` means the app is working;
  - blue `--live` marks live data;
  - green `--up` and red `--down` mark gains and losses.

  Semantic `text-up` / `text-down` are kept separate from the brand accent, so "up" is
  never the same colour as "primary". The system font stack is used, with no web
  fonts.
- **Charts** mirror those tokens as hardcoded hex, because lightweight-charts can't
  parse CSS colour functions or variables.
