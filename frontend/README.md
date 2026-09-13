# AlphaForge frontend

Next.js 16 app for AlphaForge. Product behaviour, routes and architecture are
described in [`docs/frontend.md`](../docs/frontend.md); this file covers working on
the frontend itself.

> This Next.js version has breaking changes from older releases. Check
> `node_modules/next/dist/docs/` before relying on remembered APIs (see `AGENTS.md`).

## Layout

```
src/
  app/
    layout.tsx         dark root layout, <Providers>
    login/             sign in / sign up (outside the shell)
    (app)/             everything behind the session gate; layout renders <AppShell>
      page.tsx         / · look up, watchlist, recent calls
      stock/[symbol]/  one stock: header, chart, trade, analysis
      scanner/ portfolio/ transactions/ reports/ settings/
  components/
    app-shell.tsx      auth gate, mobile header + bottom tabs, desktop rail
    account-sheet.tsx  account menu → reports, settings, sign out
    auth-provider.tsx  token state, /auth/me check, query-cache reset
    providers.tsx      React Query, auth, toaster
    page.tsx           PageTitle, Section, Empty, ErrorNote, Move primitives
    stock-screen.tsx   composes the stock page
    stock-header.tsx   quote, live price, watchlist star, Buy/Sell
    price-chart.tsx    lightweight-charts candles + live ticks
    trade-sheet.tsx    buy/sell sheet
    analysis-run.tsx   runs the workflow stream and renders its phases
    agent-progress.tsx one sentence per agent as it finishes
    debate-screen.tsx  full-screen committee sheet (debate-thread.tsx for rounds)
    verdict.tsx        verdict, risk caveat, routing note, evidence
    scan-list.tsx, positions.tsx, past-calls.tsx, advisor.tsx, rounds-picker.tsx, …
    ui/                shadcn (base-lyra) primitives
  lib/
    api.ts             axios client, typed endpoints, fetch-based SSE reader
    queries.ts         TanStack Query hooks and cache keys
    live.ts            live-price WebSocket with reconnect
    auth.ts            token storage (localStorage) and change events
    format.ts          money / percent / time formatting
  store/watchlist.ts   persisted Zustand watchlist
```

## Run locally

```powershell
npm install
npm run dev
```

Opens on `http://localhost:3000`, talking to the API at `NEXT_PUBLIC_API_URL`
(default `http://localhost:8000`; override in `.env.local`).

`NEXT_PUBLIC_API_URL` is inlined into the client bundle **at build time**. For Docker
and Cloud Run it must be passed as a build arg:

```powershell
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t alphaforge-frontend .
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (`output: "standalone"`) |
| `npm run start` | Serve the build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check (run in CI) |

## Conventions

- Pass an explicit currency code to `money()`; never default to USD.
- Use `up` / `down` for gains and losses, `live` for live data and `primary` for
  "working" — never the brand colour for direction.
- Server state goes through hooks in `lib/queries.ts`, not ad-hoc `useQuery` calls.
- Chart colours mirror the tokens as hex — lightweight-charts can't read CSS colours.
- Never put the auth token in a URL: SSE goes through `fetch`, the WebSocket uses a
  subprotocol.
