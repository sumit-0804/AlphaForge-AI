# Configuration and local setup

Environment variables and running AlphaForge on your machine.

## Configuration

Backend settings come from `backend/.env` (pydantic-settings; names are
case-insensitive). The ones you're likely to touch:

| Variable | Default | Notes |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://localhost:27017` | Must be Atlas for memory recall to work |
| `MONGODB_DB` | `alphaforge` | |
| `GOOGLE_API_KEY` | — | Chat and embeddings |
| `JWT_SECRET` | `mysecret` | **Set this.** See below |
| `ACCESS_TOKEN_TTL_MINUTES` | `10080` | 7 days |
| `ALLOW_REGISTRATION` | `true` | |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated list. **Singular** name |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | |
| `EMBEDDING_MODEL` | `models/gemini-embedding-2` | |
| `EMBEDDING_DIMENSIONS` | `1536` | Must match the Atlas index |
| `VECTOR_INDEX_NAME` | `memory_vector_index` | |
| `GEMINI_RPM` / `GEMINI_TPM` / `GEMINI_RPD` | `12` / `200000` / `400` | Chat budget |
| `EMBEDDING_RPM` / `EMBEDDING_TPM` / `EMBEDDING_RPD` | `80` / `24000` / `800` | Embedding budget |
| `QUOTA_RESET_TIMEZONE` | `America/Los_Angeles` | When the daily count rolls over |
| `CHECKPOINT_TTL_SECONDS` | `259200` | 3 days |
| `STARTING_CASH` / `BASE_CURRENCY` | `100000` / `INR` | New books |
| `NEWS_LANG` / `NEWS_COUNTRY` / `NEWS_DAYS` | `en` / — / `7` | Country is a fallback only |

Two gotchas:

- **`JWT_SECRET`** signs session tokens. Leaving it unset falls back to a value
  published in this repo, so anyone could forge a token for any account; the server
  logs a warning at startup. Note that a *blank* `JWT_SECRET=` line (as in
  `.env.example`) overrides the default with an empty string and does **not** trigger
  that warning. Generate one per environment:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- **`CORS_ORIGIN` is singular.** A plural `CORS_ORIGINS` is silently ignored and the
  backend keeps its `localhost:3000` default — which shows up deployed as the browser
  blocking every request.

The frontend reads one variable, `NEXT_PUBLIC_API_URL` (default
`http://localhost:8000`). It is **inlined at build time**; setting it on a running
container does nothing.

## Local setup

Prerequisites: Node.js 22 (CI's version; 20+ works), Python 3.12, [uv](https://docs.astral.sh/uv/),
and a MongoDB. A local `mongod` runs everything except memory recall, which needs
Atlas Vector Search — point `MONGODB_URI` at an Atlas cluster for the full loop.

### Backend

```powershell
cd backend
uv sync
copy .env.example .env
uv run uvicorn app.main:app --reload --port 8000
```

Fill in `GOOGLE_API_KEY` and `JWT_SECRET` in `backend/.env`. On startup the app
connects to Mongo (retrying up to five times), builds Beanie indexes and compiles the
workflow against the checkpointer.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:3000` and expects the API on
`http://localhost:8000` (set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` to change
it).

### Docker Compose

```powershell
docker compose up --build
```

Compose reads a repo-root `.env`: the backend takes its settings from it, and it must
also define `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:8000`) — compose refuses to
build the frontend without it. The frontend starts once the backend passes its health
check.
