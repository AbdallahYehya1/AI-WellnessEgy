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
> ([docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md)). The service is for **adults (18+)
> only**.

**Current status:** Milestone 2 (Supabase email/password authentication). No wellness
features exist yet. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

---

## Architecture

The system is a **modular monolith**: no microservices and no multi-agent AI.

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript (strict), Tailwind CSS 4, `@supabase/ssr` |
| Backend | Python 3.12, FastAPI, Pydantic, PyJWT |
| Auth | Supabase Auth (email/password, required email confirmation) |
| Planned | Supabase PostgreSQL, SQLAlchemy + Alembic, pgvector (approved knowledge only), Redis only when there is a real need |
| Ops | Docker, Docker Compose, GitHub Actions |

Backend modules live in `backend/app/`. `core`, `common`, `auth` and `users` contain code;
the rest are boundaries only:

```text
core  auth  users  consent  conversations
ai/{provider,language,prompts,evaluation}
safety  knowledge  memory  mood  wellness  journal  analytics  audit  common
```

Every future chat message must pass through this pipeline, in this order. There is never a
direct `request → LLM` path. M2 implements the first step, authentication.

```text
request → authentication → authorization → consent/policy checks
→ safety assessment → safety decision → context retrieval → AI generation
→ output safety validation → response → audit/telemetry
```

Design documents: [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[API_CONTRACT](docs/API_CONTRACT.md) · [DATA_MODEL](docs/DATA_MODEL.md) ·
[OPEN_DECISIONS](docs/OPEN_DECISIONS.md)

## How authentication works

```text
/sign-up ──(Server Action: supabase.auth.signUp)──▶ /auth/check-email
email link ──▶ Supabase verify ──▶ /auth/confirm?code=… ──(exchangeCodeForSession)──▶ /dashboard
/sign-in ──(Server Action: signInWithPassword)──▶ session cookies ──▶ /dashboard
/dashboard ──(server-side fetch, Bearer access token)──▶ FastAPI GET /me ──▶ verified identity
Sign out ──(Server Action: signOut)──▶ cookies cleared ──▶ /sign-in
```

- **Frontend:** `proxy.ts` (Next 16's replacement for middleware) refreshes the session on
  every request with `supabase.auth.getClaims()`. It sends signed-out visitors from
  `/dashboard` to `/sign-in`, and signed-in users away from the auth pages. The dashboard
  checks again on the server. Passwords only ever go to Supabase; this project stores none.
- **Backend:** `app/auth` verifies Supabase access tokens: signature via the project's JWKS
  (or the legacy HS256 secret if configured), expiry, issuer, audience, subject and role.
  `CurrentPrincipal` is the reusable FastAPI dependency. `GET /me` returns only
  token-derived identity. Every failure is a uniform `401`; if Supabase isn't configured,
  it fails closed with `503`.

## Repository layout

```text
backend/     FastAPI app (app/), tests (tests/), pyproject.toml, Dockerfile
frontend/    Next.js app (app/, components/, lib/, proxy.ts), Vitest tests (*.test.ts[x])
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
| `frontend/.env.local` (from `frontend/.env.example`) | Next.js | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public), plus `SITE_URL` and `API_BASE_URL` (server-side, not secret) |

To run authentication locally you need, from the Supabase dashboard (Project Settings → API):

- **Frontend:** the project URL and the **publishable** key (`sb_publishable_…`).
- **Backend:** `SUPABASE_URL` (the same project URL). Add `SUPABASE_JWT_SECRET` only if the
  project still uses the legacy shared JWT secret.

Rules:

- Never commit a real `.env` file. They are git-ignored, and CI fails if one is tracked.
- The Supabase **service-role / secret key**, the JWT secret, database passwords and access
  tokens are server-only. They must never appear in `frontend/` or carry a `NEXT_PUBLIC_`
  prefix. CI checks for both.
- Backend secrets are typed as `SecretStr`, so they are masked in `repr`, logs and
  serialisation. Blank values count as unset.
- Logs never contain tokens, `Authorization` headers, passwords or emails. Auth rejections
  log only a reason code, such as `expired`.

## Prerequisites

- Python 3.12 (CI and the Docker image use 3.12; `pyproject.toml` accepts 3.12–3.13)
- Node.js ≥ 22.22.2 and npm (the frontend test tooling requires it)
- Docker with Compose v2 (optional)

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows (Git Bash): source .venv/Scripts/activate
pip install -e ".[dev]"
cp ../.env.example .env            # then set SUPABASE_URL

uvicorn app.main:app --reload      # add --port 8001 if 8000 is taken

python -m pytest -q                # tests + coverage (no network, no real credentials)
ruff check .
ruff format --check .
mypy app --show-error-codes        # strict (CI also checks tests/)
```

- `GET /health` returns exactly `{"status": "ok"}`.
- `GET /me` needs `Authorization: Bearer <Supabase access token>`.
- Interactive API docs are turned off when `ENVIRONMENT=production`.

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local         # then set the two NEXT_PUBLIC_SUPABASE_* values
npm run dev                        # http://localhost:3000
npm run lint
npm run typecheck
npm test                           # Vitest; Supabase is mocked
npm run build
```

If the API runs on a port other than 8000, set `API_BASE_URL` in `frontend/.env.local`.

## Docker

```bash
docker compose config            # validate
docker compose up --build        # API on http://127.0.0.1:8000
API_PORT=8001 docker compose up  # if port 8000 is already taken
```

Compose runs the API only and reads `SUPABASE_URL` from the root `.env`.

## CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

- **backend:** ruff lint, ruff format check, mypy (strict), pytest, all on Python 3.12
- **frontend:** `npm ci`, lint, typecheck, Vitest, production build, on Node 22
- **guards:** no tracked `.env` files; no server-only secret names in `frontend/`; no
  secret-looking `NEXT_PUBLIC_` variables
- **docker:** `docker compose config`, image build, container start, `/health` returns
  exactly `{"status":"ok"}`, and `/me` returns 401 anonymously and 503 without Supabase
  configuration
