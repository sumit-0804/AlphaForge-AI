# AlphaForge AI

Local-first autonomous investment research & paper trading platform.

## Stack

- Frontend: Next.js, TypeScript, TailwindCSS
- Backend: FastAPI, Python 3.12
- Database: MongoDB (Beanie) + FAISS (vector memory)
- AI: Google Gemini + LangGraph

## System overview

Nine LLM agents, but only some of them live inside the LangGraph workflow. This
view is organised by what **triggers** each agent, which is the thing the graph
diagrams can't show:

![System diagram](docs/system.png)

The layering is deliberate. A deterministic core does all the market maths with
no LLM involved, agents sit on top of it to interpret and explain, and the cost
of each agent is very different:

| Agent | Trigger | Cost |
| --- | --- | --- |
| Scanner triage | Scanner page / scheduled scan | 1 call per scan |
| Portfolio advisor | Scanner page | 1 call per book |
| LangGraph workflow | User picks a candidate | ~15 calls per ticker |
| Reflection | A paper trade is closed | 1 call per closed trade |
| Risk + allocation narration | Daily report, 16:00 IST | 2 calls per day |

That gap is why scanning is tiered — running the full workflow across a 45-name
universe would be ~700 model calls, so the scan shortlists cheaply and the user
chooses which candidates earn the expensive analysis.

## Per-agent flows

There are nine agents but only five distinct shapes — the four narration agents
share one. Each diagram below is a different *kind* of agent, not a different
name for the same thing.

### Research — the only autonomous tool loop

![Research agent](docs/agent-research.png)

The model is bound to five tools and decides at run time which to call and in
what order, looping until it stops asking for data or hits the 6-iteration cap
(where a tool-free synthesis is forced so callers never get a dangling tool
request). Tools never raise — they return `{error}` so the agent can proceed on
partial evidence. This is the one agent whose control flow the model owns.

### Scanner triage — batch fan-in

![Scanner agent](docs/agent-scanner.png)

One LLM call ranks the **entire** shortlist. The validator enforces exact
coverage: a dropped symbol would silently shrink your shortlist, and an invented
one would render an "Analyze" button for a stock that never scanned.

### Portfolio advisor — bounded actions

![Advisor agent](docs/agent-advisor.png)

Deterministic exit signals are computed first, then one call reasons over the
whole book. The validator caps `suggested_quantity` at shares actually held —
without it the UI could render a Sell button that can only fail at execution.

### Reflection — the learning loop

![Reflection agent](docs/agent-reflection.png)

Fires on a closed trade and writes a distilled lesson into FAISS, which is then
injected into every future moderator prompt for that ticker. Note this is the
one agent still on bare `chat` + `_parse` rather than the self-correcting
`chat_json` path, so an unstructured reply here becomes a permanent prior.

### Narration agents — shared shape

![Narration agents](docs/agent-narrators.png)

`fundamental`, `news`, `risk` and `portfolio` all take pre-computed numbers and
produce a plain-language read through the same self-correcting loop: on invalid
JSON or a failed semantic check, the model is shown its own bad output and asked
to fix it, up to twice, before falling back with `valid: false`.

## Agent workflow

Every per-ticker analysis runs through a single LangGraph workflow — there is no
other path that produces a recommendation.

![Agent workflow graph](docs/mermaid.png)

Four data-gathering nodes fan out in parallel, then `gate` acts as a fan-in
barrier and scores how strongly the signals agree:

- **research** — an autonomous ReAct loop; the model picks which tools to call
  (profile, technicals, fundamentals, news, memory) and in what order
- **technical** — deterministic `pandas_ta` indicators, no LLM
- **fundamental** — computed metrics plus a plain-language read
- **news** — RSS headlines summarised and scored for sentiment

`gate` then routes conditionally. If the *independent* signals are unanimous and
the research agent doesn't dissent, the expensive committee is skipped via
`quick_decision`. Otherwise the debate runs. The research agent's vote is
deliberately excluded from the unanimity test — it reads the same underlying
evidence as the other three nodes, so counting it as a peer would double-count
that evidence and manufacture agreement.

### Committee subgraph

When signals conflict, `debate` runs a cyclic Bull vs Bear subgraph:

![Debate subgraph](docs/debate-subgraph.png)

Bull and Bear argue concurrently, then `rebut` loops — the self-edge is the
cycle — until the analysts converge (one concedes, or neither has new points) or
the round cap is hit. `moderate` issues the final verdict, which is validated
rather than silently falling back, so a real HOLD is distinguishable from a
parse failure.

## Regenerating the diagrams

```powershell
cd backend
.\.venv\Scripts\python.exe ..\docs\generate_diagrams.py
```

| Diagram | Source | Drift risk |
| --- | --- | --- |
| `mermaid.png` | Exported from the compiled workflow graph | None — derived from code |
| `debate-subgraph.png` | Exported from the compiled debate graph | None — derived from code |
| `system.png` | Hand-authored `system.mmd` | **Can drift** — update when the architecture changes |
| `agent-*.png` | Hand-authored `agent-*.mmd` | **Can drift** — update when an agent's flow changes |

The two graph exports are generated by LangGraph from the compiled objects, so
they always match the code. The system diagram is maintained by hand, because
there is no single graph object that spans the scheduler, the standalone agents
and the trade-close reflection path.

> `draw_mermaid_png()` renders via the mermaid.ink web service unless
> `pyppeteer` is installed locally. Pass `--mmd-only` to refresh just the text
> sources with no network call. The `.mmd` files are committed alongside the
> images so every diagram stays reviewable in plain text.

## Prerequisites

- Node.js 20+
- Python 3.12+
- MongoDB running on `localhost:27017` (or update `MONGODB_URI`)

## Setup

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Set `GOOGLE_API_KEY` in `backend/.env` — it powers both the reasoning agents and
the FAISS memory embeddings.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:3000` and expects the API on
`http://localhost:8000`. CORS is pinned to that origin via `CORS_ORIGIN`.