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

**Current status:** Milestone 4 (mood check-in), built on M3 (consent and profile) and M2
(Supabase auth). There is no AI companion yet. See
[docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

---

## Architecture

The system is a **modular monolith**: no microservices and no multi-agent AI.

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript (strict), Tailwind CSS 4, `@supabase/ssr` |
| Backend | Python 3.12, FastAPI, Pydantic, PyJWT, SQLAlchemy 2 + Alembic, psycopg 3 |
| Auth | Supabase Auth (email/password, required email confirmation) |
| Database | PostgreSQL 17: Supabase in the cloud, a local container for dev, test and CI. App tables live in schema `app`. |
| Planned | pgvector (approved knowledge only), Redis only when there is a real need |
| Ops | Docker, Docker Compose, GitHub Actions |

Backend modules live in `backend/app/`. `core`, `common`, `auth`, `users`, `consent`,
`audit` and `mood` contain code; the rest are boundaries only:

```text
core  auth  users  consent  conversations
ai/{provider,language,prompts,evaluation}
safety  knowledge  memory  mood  wellness  journal  analytics  audit  common
```

Every future chat message must pass through this pipeline, in this order. There is never a
direct `request → LLM` path. M2 implemented authentication and authorisation (identity
from the verified token). M3 adds the consent check (`ConsentedUser`, which answers 403
until the current consent version is accepted).

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

### Password recovery (M6.0)

```text
/sign-in ─▶ /forgot-password ──(resetPasswordForEmail)──▶ "If an account exists…" (same for every email)
email link ──▶ Supabase verify ──▶ /auth/confirm?code=… ──(recovery verified)──▶ /reset-password
/reset-password ──(updateUser({ password }))──▶ signOut({ scope: "global" }) ──▶ /sign-in?status=password-updated
```

- **What authorises the reset page and its action.** Three checks must all pass:
  1. A valid access token (`getClaims()`), giving the user id and Supabase session id.
  2. A live session according to the Auth server (`getUser()`). `getClaims()` alone can't
     see a revoked session, because an access token stays valid until it expires.
  3. A **signed recovery marker** (`aw_password_reset`: `httpOnly`, `SameSite=Lax`, path
     `/reset-password`, 10 minutes). It is HMAC-SHA256-signed with the server-only
     `RECOVERY_MARKER_SECRET` and binds the user id, the session id, an expiry and a random
     token id. Signatures are compared in constant time.
- **Only `/auth/confirm` issues the marker**, and only after Supabase has verified a
  recovery. That means either the PKCE verifier created by `resetPasswordForEmail`, or a
  `type=recovery` token hash. The marker is bound to the session in the token Supabase just
  returned, verified with `getClaims(token)`. `next=/reset-password` alone grants nothing.
- **Without a valid secret, recovery fails closed.** No reset email is sent, and the reset
  page and action refuse every request.
- **Not strictly single-use.** Nothing server-side records that a marker was used, so it is
  **short-lived, signed and session-bound, not single-use**:
  - Before a successful reset, the same session can use it more than once, for example
    after a validation error.
  - Two simultaneous submissions from that session could both reach Supabase.
  - After a successful reset, the app calls `signOut({ scope: "global" })`. Supabase then
    revokes the refresh tokens and sessions, so a replay with that session fails the
    `getUser()` check. This relies on the Auth server rejecting revoked sessions
    (`session_not_found`). It was tested against a mock and still needs a manual check
    against the real project. If the sign-out call fails, the session stays valid until the
    marker expires.
- **Residual risk: an already stolen session.** The marker only controls this app's
  recovery page. Anyone holding a valid Supabase session, which means its access and
  refresh tokens, can call Supabase's `updateUser` directly with them, without using this
  page. Supabase's own controls are what limit that: session lifetime, and the project
  setting **"Secure password change"**, which requires a recent sign-in. Enabling that
  setting is a project decision, and it is not changed here.
- Invalid, expired, reused or other-browser links go to `/forgot-password?status=link-invalid`.
  Redirects stay on this site (`safeNextPath`). The "sent" message is identical whether or
  not an account exists. Passwords, markers and tokens are never echoed or logged.

**Development setup for recovery (and sign-up) links:**

- Open the app on **the same host as `SITE_URL`** (default `http://localhost:3000`). The
  PKCE verifier cookie belongs to the host where the email was requested; a link opened on
  `127.0.0.1` when `SITE_URL` is `localhost` (or the reverse) can't complete. In
  development, `/forgot-password` shows a note when the hosts differ.
- If the browser upgrades `http://localhost` to HTTPS ("localhost sent an invalid
  response"), it has an HSTS entry for `localhost`. Either remove that entry yourself
  (Edge/Chrome: `edge://net-internals/#hsts` → "Delete domain security policies" →
  `localhost`), or use `http://127.0.0.1:3000` with `SITE_URL=http://127.0.0.1:3000`, which
  also needs that URL in the Supabase redirect allow-list.
- The Supabase project's **Redirect URLs** must allow
  `<SITE_URL>/auth/confirm?next=/reset-password` (for example `<SITE_URL>/**`). If they
  don't, Supabase sends the user to the Site URL instead and the reset can't finish.
- Set `RECOVERY_MARKER_SECRET` in `frontend/.env.local` (see `frontend/.env.example`). It is
  read by the Next.js server only; never give it a `NEXT_PUBLIC_` prefix or commit it.
- Automated tests use a mock auth server. The real email flow, and Supabase's rejection of
  revoked sessions, must be checked by hand against the Supabase project.

## Onboarding, profile and consent (M3)

```text
sign-in / email confirmation ─▶ /dashboard ─(GET /consents/me)─▶ status?
   missing  ─▶ /onboarding          (optional display name, can be skipped)
            ─▶ /onboarding/consent  (read, tick the box, "Agree and continue")
   declined / outdated ─▶ /onboarding/consent
   granted  ─▶ dashboard
```

- **Profile** (`GET/PATCH /profile`) is created on the first authenticated request and is
  keyed only on the verified Supabase `sub`. There is no way to address another user's
  profile.
- **Consent is always explicit.** Creating an account records nothing. The user must tick a
  box and press "Agree"; declining is recorded too. A decision covers exactly one version.
  When a new version is published, everyone's status becomes `outdated` until they
  accept again.
- **Audit:** profile creation, profile changes (field names only) and every consent
  decision are written to the append-only `audit_events` table, in the same transaction.
- The current consent text is a **draft placeholder** pending legal review (OPEN_DECISIONS
  D-24), shown with a prominent "DRAFT, NOT FINAL" notice.

## Mood check-in (M4)

```text
consent accepted ─▶ /check-in (1–5 scale, "Skip for now") ─(POST /mood/checkins)─▶ /dashboard
/dashboard ─(GET /mood/history?limit=7)─▶ recent check-ins (date + score)
```

- Both endpoints are self-only and require the current consent (`403 consent_required`).
- The score is a strict JSON integer from 1 to 5. Tags accept only `[]` until a vocabulary
  is approved (OPEN_DECISIONS D-30). **Notes are temporarily rejected server-side** (any
  `note` string → 422; omitted or `null` is fine) and the UI offers no note field, until
  D-32 is decided.
- The 1–5 scale is keyboard-operable (Tab, then the arrow keys) and has a visible focus
  outline that is separate from the "selected" style.
- The check-in is described as "not a medical assessment". The UI copy is provisional
  (D-31).

## Repository layout

```text
backend/     FastAPI app (app/), Alembic (alembic.ini, migrations/), tests/, Dockerfile
frontend/    Next.js app (app/, components/, lib/, proxy.ts), Vitest tests (*.test.ts[x])
docs/        Architecture, contracts, open decisions, implementation status
.github/     CI workflow
docker-compose.yml   Local dev: Postgres 17, one-shot migrations, API
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

# Database: start the local Postgres, then apply migrations
docker compose up -d db            # from the repository root
# in backend/.env: DATABASE_URL=postgresql://wellness:local-dev-only@127.0.0.1:5432/wellness
alembic upgrade head

uvicorn app.main:app --reload      # add --port 8001 if 8000 is taken

python -m pytest -q                # starts a throwaway Postgres 17 via Docker (testcontainers),
                                   # or uses TEST_DATABASE_URL if set; no real credentials needed
ruff check .
ruff format --check .
mypy app --show-error-codes        # strict (CI also checks tests/)
```

- `GET /health` returns exactly `{"status": "ok"}`.
- `GET /me`, `/profile` and `/consents/me` need `Authorization: Bearer <Supabase access token>`.
  `GET /consents/current` is public.
- Without `DATABASE_URL`, profile and consent endpoints return `503` (fail closed).
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

Compose runs Postgres, applies migrations once (`migrate` service), then starts the API.
It reads `SUPABASE_URL` from the root `.env`. The local database password is a
development-only value (`LOCAL_DB_PASSWORD`), and Postgres binds to `127.0.0.1`.

## CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

- **backend:** ruff lint, ruff format check, mypy (strict), pytest against a Postgres 17
  service container, all on Python 3.12
- **frontend:** `npm ci`, lint, typecheck, Vitest, production build, on Node 22
- **guards:** no tracked `.env` files; no server-only secret names in `frontend/`; no
  secret-looking `NEXT_PUBLIC_` variables
- **docker:** `docker compose config`, image build, Postgres, migrations (must exit 0),
  API start, `/health` returns exactly `{"status":"ok"}`, `/consents/current` is served,
  and `/me` returns 401 anonymously and 503 without Supabase configuration
