# AlphaForge backend

FastAPI + LangGraph service behind AlphaForge. Architecture, agent flows and the
full API reference are in [`docs/`](../docs/architecture.md); this file covers
working on the backend itself.

## Layout

```
app/
  main.py            app factory, lifespan (Mongo, workflow compile), CORS
  api/
    router.py        mounts every route module under /api
    deps.py          bearer-token auth → current_user / current_user_id
    routes/          auth, health, market, live (WebSocket), scanner, workflow,
                     debate, advisor, trading, memory, reports
  graph/
    workflow.py      the analysis StateGraph, gate/consensus rules, SSE translation
    checkpointer.py  async MongoDB checkpoint saver (TTL-indexed)
  agents/            one module per LLM agent; schemas.py holds every output schema
  services/          deterministic core: market data, technicals, fundamentals,
                     risk, scanner, trading, forex, portfolio allocation, reports,
                     memory, live prices, and LLMService
  core/              settings, JWT/bcrypt, rate limiter, exchange metadata
  models/            Beanie documents (users, portfolios, transactions, memories,
                     recommendations, daily_reports, daily_quota_usage)
  db/mongo.py        async client and Beanie init
```

Conventions worth keeping:

- Agents never call Gemini directly — always `LLMService.chat_json` with a schema
  from `agents/schemas.py`, a fallback, and (where cross-field rules exist) a
  validator.
- Services never raise to the graph for recoverable failures; workflow nodes catch
  and append to `errors`, which the stream surfaces as node warnings.
- Anything that must happen after a request is awaited in request scope — Cloud Run
  throttles CPU once the response is sent.
- Every read and write is scoped by `user_id` from the token.

## Run locally

```powershell
uv sync
copy .env.example .env
uv run uvicorn app.main:app --reload --port 8000
```

Set at least `GOOGLE_API_KEY` and `JWT_SECRET` in `.env` (all settings are listed in
[`docs/setup.md`](../docs/setup.md)). OpenAPI docs are served at
`http://localhost:8000/docs`.

## Atlas vector index

Memory recall uses `$vectorSearch`, which only exists on MongoDB Atlas. Create an
**Atlas Vector Search** index (not an Atlas Search index) on the `memories`
collection, named to match `VECTOR_INDEX_NAME`:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "user_id" },
    { "type": "filter", "path": "type" },
    { "type": "filter", "path": "ticker" }
  ]
}
```

`numDimensions` must equal `EMBEDDING_DIMENSIONS`. With a local `mongod` everything
else works; recall just reports `index_unavailable` once lessons exist.

Note that `backend/.env` and the deployed service can point at different databases —
check `MONGODB_URI` before running any one-off script against "the" data.

## Docker

```powershell
docker build -t alphaforge-backend .
docker run --env-file .env -p 8000:8000 alphaforge-backend
```

The image runs uvicorn as a non-root user with `WEB_CONCURRENCY` workers (default 1).
The per-minute rate limiter is in-process, so more workers means more per-minute
budget against the same Gemini quota.

## Diagrams

From this directory:

```powershell
.\.venv\Scripts\python.exe ..\docs\generate_diagrams.py
```

The workflow and debate diagrams are exported from the compiled graphs; update the
hand-authored `docs/*.mmd` files when an agent's flow changes.
