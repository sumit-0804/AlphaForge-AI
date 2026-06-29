# AlphaForge AI

Local-first autonomous investment research & paper trading platform.

## Stack

- Frontend: Next.js, TypeScript, TailwindCSS
- Backend: FastAPI, Python 3.12
- Database: MongoDB (Beanie)
- AI (later): Ollama + LangGraph

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