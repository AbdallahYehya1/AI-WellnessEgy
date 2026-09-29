# AI Wellness Egypt

A digital mental-wellness platform built for Egyptian Arabic speakers first.

The planned MVP includes a warm, culturally relevant Egyptian Arabic AI wellness
companion, daily mood check-ins, journaling, guided evidence-based exercises, basic progress
tracking, and approved psychoeducation content. A path to qualified human therapists is
planned for later.

> **This is a wellness-support product, not a therapist.** It must never diagnose, prescribe
> or recommend medication, claim clinical certainty, present itself as a licensed
> professional, replace emergency or professional care, or encourage dependence on the AI.
> For high-risk users, normal AI generation stops and a controlled escalation flow takes
> over. That flow's content is pending clinical and legal review
> ([docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md)).

**Current status:** Milestone 1 (repository and engineering foundation). No product features
exist yet. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

---

## Architecture

The system is a **modular monolith**: no microservices and no multi-agent AI.

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript (strict), Tailwind CSS 4 |
| Backend | Python 3.12, FastAPI, Pydantic |
| Planned | Supabase Auth, Supabase PostgreSQL, SQLAlchemy + Alembic, pgvector (approved knowledge only), Redis only when there is a real need |
| Ops | Docker, Docker Compose, GitHub Actions |

Backend modules live in `backend/app/`. As of M1 they are boundaries only:

```text
core  auth  users  consent  conversations
ai/{provider,language,prompts,evaluation}
safety  knowledge  memory  mood  wellness  journal  analytics  audit  common
```

Every future chat message must pass through this pipeline, in this order. There is never a
direct `request → LLM` path.

```text
request → authentication → authorization → consent/policy checks
→ safety assessment → safety decision → context retrieval → AI generation
→ output safety validation → response → audit/telemetry
```

Design documents: [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[API_CONTRACT](docs/API_CONTRACT.md) · [DATA_MODEL](docs/DATA_MODEL.md) ·
[OPEN_DECISIONS](docs/OPEN_DECISIONS.md)

## Repository layout

```text
backend/     FastAPI app (app/), tests (tests/), pyproject.toml, Dockerfile
frontend/    Next.js app (app/), ESLint/TS/Tailwind config
docs/        Architecture, contracts, open decisions, implementation status
.github/     CI workflow
docker-compose.yml   Local dev: API only
.env.example         Server-only settings (backend / Compose)
```

## Configuration and secrets

Server-side and browser-side settings are kept in **separate files**:

| File | Read by | Contents |
|---|---|---|
| `.env` (from `.env.example`) | Docker Compose | Server-only settings and secrets |
| `backend/.env` (from `.env.example`) | Backend run directly | Same as above |
| `frontend/.env.local` (from `frontend/.env.example`) | Next.js | `NEXT_PUBLIC_*` values only. These are public and embedded in browser JS |

- Never commit a real `.env` file. They are git-ignored, and CI fails if one is tracked.
- The Supabase **service-role key** and **JWT secret** are server-only. They must never
  appear in `frontend/` or carry a `NEXT_PUBLIC_` prefix. CI greps the frontend for them.
- Backend secrets are typed as `SecretStr`, so they are masked in `repr`, logs and
  serialisation. The log formatter also redacts sensitive-looking field names.
- M1 needs no configuration: every setting has a safe default.

## Prerequisites

- Python 3.12 (CI and the Docker image use 3.12; `pyproject.toml` accepts 3.12–3.13)
- Node.js ≥ 22.13 and npm
- Docker with Compose v2 (optional)

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows (Git Bash): source .venv/Scripts/activate
pip install -e ".[dev]"

uvicorn app.main:app --reload      # http://127.0.0.1:8000/health, docs at /docs

python -m pytest -q                # tests + coverage
ruff check .                       # lint
ruff format --check .              # formatting (run `ruff format .` to fix)
mypy app --show-error-codes        # strict type check (CI also checks tests/)
```

`GET /health` returns `{"status": "ok", "environment": "development"}`. It is a liveness check
only. Interactive API docs are turned off when `ENVIRONMENT=production`.

## Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run typecheck
npm run build
```

## Docker

```bash
docker compose config            # validate
docker compose up --build        # API on http://127.0.0.1:8000
API_PORT=8001 docker compose up  # if port 8000 is already taken
```

Compose runs the API only. A database, Redis, workers and AI services will be added only when
a milestone needs them.

## CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

- **backend:** ruff lint, ruff format check, mypy (strict), pytest, all on Python 3.12
- **frontend:** `npm ci`, lint, typecheck, production build, on Node 22
- **guards:** no tracked `.env` files; no server-only secret names in `frontend/`
- **docker:** `docker compose config`, image build, container start, `/health` check
