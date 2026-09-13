# AlphaForge AI

Autonomous investment research and paper trading. A deterministic market-data core
does the maths, Gemini agents interpret it, and a LangGraph workflow turns it into
one explained BUY / HOLD / SELL call per ticker. You can paper-trade that call, and
the system learns from the trade once you close it.

> Educational analysis on a paper book. Not financial advice.

![System diagram](docs/system.png)

## What it does

- **Scanner.** Discovers today's movers on NSE, BSE and US markets. Rule-based entry
  signals find candidates, and one LLM call ranks the whole shortlist.
- **Deep analysis.** A LangGraph workflow gathers technicals, fundamentals, news and
  risk in parallel, recalls past lessons, and writes a research view.
  - If the signals agree, it decides directly.
  - Otherwise a Bull vs Bear committee debates. The result streams live over SSE.
- **Paper trading.** Per-user INR book with multi-currency positions, live price
  charts and an LLM portfolio advisor.
- **Learning loop.** Every sell triggers a reflection that stores a lesson in Atlas
  Vector Search. Later analyses recall it, on the same ticker and on similar setups.
- **Daily report.** On-demand book risk, market scan and allocation plan.

## Analysis workflow

Five data nodes run in parallel. `recall` then pulls past lessons, `research` writes a
view. `gate` then routes the run. If all four directional agents agree and the stock
isn't high-risk, it takes `quick_decision`; anything else goes to the Bull vs Bear
`debate`. See
[Architecture](docs/architecture.md#analysis-workflow) for the rules.

![Agent workflow graph](docs/mermaid.png)

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind v4, shadcn/ui (Base UI), TanStack Query, Zustand, lightweight-charts |
| Backend | FastAPI, Python 3.12, uv, LangGraph |
| Data | MongoDB + Beanie, Atlas Vector Search |
| AI | Gemini (`gemini-3.5-flash-lite`, `gemini-embedding-2`) |
| Market data | yfinance, pandas-ta, Google News RSS, Frankfurter FX |
| Hosting | Cloud Run via Cloud Build |

## Quick start

Requires Node.js 22, Python 3.12, [uv](https://docs.astral.sh/uv/) and MongoDB.
Memory recall needs Atlas.

```powershell
cd backend
uv sync
copy .env.example .env
uv run uvicorn app.main:app --reload --port 8000
```

Before starting the server, set `GOOGLE_API_KEY` and `JWT_SECRET` in `backend/.env`.

```powershell
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:3000`, and the API on `http://localhost:8000`
(`/docs` for OpenAPI).

## Documentation

| Doc | Covers |
| --- | --- |
| [Architecture](docs/architecture.md) | System overview, analysis workflow and gate rules, committee debate, checkpointing, SSE events |
| [Agents and memory](docs/agents.md) | Every LLM agent, the shared `chat_json` path, reflection, recall and Atlas Vector Search |
| [Market data and quota](docs/market-data.md) | Data sources, news/benchmark/FX rules, live prices, rate limiting and daily quota |
| [API and accounts](docs/api.md) | Endpoint reference, auth, token handling |
| [Frontend](docs/frontend.md) | Routes, mobile shell, stock page and analysis stream, currency and theme notes |
| [Configuration and setup](docs/setup.md) | Environment variables, gotchas, local and Docker Compose setup |
| [Deployment and CI](docs/deployment.md) | Cloud Run pipeline, one-time GCP setup, CI jobs, regenerating diagrams |
| [`backend/README.md`](backend/README.md) | Backend layout, conventions, Atlas index definition |
| [`frontend/README.md`](frontend/README.md) | Frontend layout, scripts, conventions |
