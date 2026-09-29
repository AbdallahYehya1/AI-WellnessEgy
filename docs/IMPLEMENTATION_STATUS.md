# Implementation Status

Last updated: 2026-09-29

Status values used: **COMPLETE — VERIFIED**, **IMPLEMENTED — NOT VERIFIED**, **BLOCKED**,
**DEFERRED**.

| Milestone | Status |
|---|---|
| **M1: Repository and engineering foundation** | **COMPLETE — VERIFIED** (locally; see §4 for the one item that is not verified) |
| M2 and later | Not started. Awaiting approval. |

---

## 1. Starting point

- The GitHub repository `AbdallahYehya1/AI-WellnessEgy` was **empty**: `git clone`
  reported "You appear to have cloned an empty repository" and there were no commits.
- None of the required source documents were in the repository. Earlier planning material
  was in the local parent folder (`../files4/mental-wellness-platform-m1gate/docs/`):
  `ARCHITECTURE.md`, `API_CONTRACT.md`, `DATA_MODEL.md`, `SME_COUNCIL_DECISIONS.md`,
  `PHASE_1_IMPLEMENTATION_PLAN.md`, and older `OPEN_DECISIONS.md` and
  `IMPLEMENTATION_STATUS.md` files. They were read, and the first five were copied into
  `docs/`, each with a provenance note at the top. `OPEN_DECISIONS.md` and this file were
  rewritten from scratch. Their open clinical, legal and crisis items were carried forward.
- `Architecture_V2_Phase_1_Build_Spec.docx` was **not found** anywhere. This is recorded as
  OPEN_DECISIONS D-0.
- That folder also held earlier, unverified M1 code. It was used only as a reference. All
  code here was written fresh and verified.

## 2. Files created

All paths are relative to the repository root. No existing files were changed, because the
repository was empty.

**Repository and operations:** `.env.example`, `.gitignore`, `.dockerignore`,
`docker-compose.yml`, `README.md`, `.github/workflows/ci.yml`

**Docs:** `docs/IMPLEMENTATION_STATUS.md`, `docs/OPEN_DECISIONS.md` (both new), and
`docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `docs/DATA_MODEL.md`,
`docs/SME_COUNCIL_DECISIONS.md`, `docs/PHASE_1_IMPLEMENTATION_PLAN.md` (imported, with a
provenance note added)

**Backend:**
- `backend/pyproject.toml`, `backend/Dockerfile`, `backend/.dockerignore`
- `backend/app/__init__.py`, `backend/app/main.py`
- `backend/app/core/__init__.py`, `config.py`, `health.py`, `logging.py`
- Module boundaries (a docstring-only `__init__.py` each): `auth`, `users`, `consent`,
  `conversations`, `ai`, `ai/provider`, `ai/language`, `ai/prompts`, `ai/evaluation`,
  `safety`, `knowledge`, `memory`, `mood`, `wellness`, `journal`, `analytics`, `audit`,
  `common`
- `backend/tests/__init__.py`, `conftest.py`, `test_app_startup.py`, `test_health.py`,
  `test_config.py`, `test_sensitive_data.py`

**Frontend:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/tsconfig.json`,
`frontend/next.config.ts`, `frontend/eslint.config.mjs`, `frontend/postcss.config.mjs`,
`frontend/.env.example`, `frontend/app/layout.tsx`, `frontend/app/page.tsx`,
`frontend/app/globals.css`

The following are generated locally and git-ignored: `backend/.venv/`,
`frontend/node_modules/`, `frontend/.next/`, `frontend/next-env.d.ts`, and tool caches.

## 3. Tasks completed and evidence

| Task | Status | Evidence |
|---|---|---|
| FastAPI app (`create_app` factory, lifespan, request-logging middleware) | COMPLETE — VERIFIED | `test_app_startup.py` (6 tests); real Uvicorn run; container run |
| `GET /health` → `{"status":"ok","environment":...}` (liveness only, typed response model) | COMPLETE — VERIFIED | `test_health.py` (5 tests); `curl` against Uvicorn (200) and against the container (200, healthy) |
| Environment-based config with safe defaults (`pydantic-settings`, `Literal`-validated environment and log level, `SecretStr` secrets) | COMPLETE — VERIFIED | `test_config.py` (10 tests: defaults, env override, case-insensitivity, `.env` loading and precedence, invalid values rejected, caching) |
| API docs (`/docs`, `/redoc`, `/openapi.json`) off in production | COMPLETE — VERIFIED | Tests; Uvicorn with `ENVIRONMENT=production` returned `/docs` 404 |
| Privacy-safe JSON logging: metadata only, no headers, bodies or query strings; sensitive keys and `SecretStr` values redacted; Uvicorn access log and HTTP-client URL logs suppressed | COMPLETE — VERIFIED | `test_sensitive_data.py` (14 tests); a real Uvicorn run with a fake secret and a `?token=` query showed 0 occurrences of either in the log |
| Sensitive config never logged or exposed | COMPLETE — VERIFIED | Tests assert that fake secrets are absent from `repr`, `str`, `model_dump`, the JSON dump, captured stdout/stderr across the app lifecycle, and the `/health`, `/openapi.json` and `/docs` bodies and headers |
| Ruff lint (E, W, F, I, UP, B, SIM, S, N, RUF) and format config | COMPLETE — VERIFIED | `ruff check .` and `ruff format --check .` pass |
| Strict mypy (`strict = true`, `warn_unreachable`, pydantic plugin) | COMPLETE — VERIFIED | `mypy app` passes (24 files). `mypy app tests` also passes (30 files) and is what CI runs |
| Backend Dockerfile (Python 3.12-slim, non-root uid 10001, HEALTHCHECK, `.env` excluded from the image) | COMPLETE — VERIFIED | `docker build ./backend` succeeded; the container became `healthy`; `id` inside it shows `uid=10001(appuser)` |
| Next.js 16 + TypeScript strict + App Router + Tailwind 4, root layout (`lang="ar" dir="rtl"`), minimal non-clinical bilingual landing page | COMPLETE — VERIFIED | lint, typecheck and build pass; `/` is prerendered statically |
| Public and server config separated: root `.env.example` is server-only, `frontend/.env.example` is `NEXT_PUBLIC_*` only | COMPLETE — VERIFIED | Guard `grep` finds no service-role, JWT-secret or `DATABASE_URL` references in `frontend/` |
| Minimal Docker Compose (API only; host port configurable through `API_PORT`) | COMPLETE — VERIFIED | `docker compose config` passes; `compose up --wait` reached healthy; `/health` returned 200 |
| GitHub Actions CI (backend, frontend, guards, docker jobs) | **IMPLEMENTED — NOT VERIFIED** | The workflow has not run on GitHub yet because nothing is committed or pushed. Each step it runs was run locally and passed |
| No secrets committed | COMPLETE — VERIFIED | A pattern scan (OpenAI-style `sk-` keys, JWT `eyJ…`, AWS `AKIA…`, private keys) over all trackable files found nothing. `git add -A --dry-run` shows no `.env` file |

**Tests:** 35 passed, with 100% line coverage of `app/` (107 statements).

## 4. Commands run and results (real output, final run)

Environment: Windows 11, Git Bash. **Python 3.13.6** (see §5), Node v22.9.0, npm 10.8.3,
Docker 29.8.0.

```text
$ cd backend
$ python -m pytest -q
...................................                                      [100%]
TOTAL                             107      0   100%
35 passed in 0.87s                                         [exit 0]
$ ruff check .
All checks passed!                                         [exit 0]
$ ruff format --check .
30 files already formatted                                 [exit 0]
$ mypy app --show-error-codes
Success: no issues found in 24 source files                [exit 0]
$ mypy app tests --show-error-codes
Success: no issues found in 30 source files                [exit 0]

$ cd ../frontend
$ npm install
npm warn EBADENGINE Unsupported engine { package: 'ai-wellness-egypt-web@0.1.0',
  required: { node: '>=22.13.0' }, current: { node: 'v22.9.0' } }
npm warn EBADENGINE Unsupported engine { package: 'eslint-visitor-keys@5.0.1',
  required: { node: '^20.19.0 || ^22.13.0 || >=24' }, current: { node: 'v22.9.0' } }
up to date, audited 365 packages in 1s
found 0 vulnerabilities                                    [exit 0]
$ npm run lint
> eslint . --max-warnings=0                                [exit 0, no findings]
$ npm run typecheck
> next typegen && tsc --noEmit
✓ Types generated successfully                             [exit 0]
$ npm run build
▲ Next.js 16.3.6 (Turbopack)
✓ Compiled successfully in 3.0s
✓ Generating static pages using 4 workers (3/3) in 618ms
Route (app)
┌ ○ /
└ ○ /_not-found                                            [exit 0]

$ cd ..
$ docker compose config
name: ai-wellness-egypt
services:
  api:
    build: { context: ...\backend, dockerfile: Dockerfile }
    environment: { ENVIRONMENT: development, LOG_LEVEL: INFO }
    ports: [ { host_ip: 127.0.0.1, target: 8000, published: "8000" } ]
    restart: unless-stopped                                [exit 0]
```

Additional checks, beyond the required list:

```text
$ docker build ./backend                                   [exit 0]
$ docker compose up --build --detach --wait --wait-timeout 60
Error response from daemon: ports are not available: exposing port TCP 127.0.0.1:8000
... bind: An attempt was made to access a socket in a way forbidden by its access permissions.
                                                           [exit 1]
  → Cause: a local Apache `httpd` (PID 4868) already listens on port 8000 on this machine.
    This is an environment conflict, not a code defect. Fix: the host port was made
    configurable (API_PORT). The Apache process was not touched.
$ API_PORT=8001 docker compose up --build --detach --wait --wait-timeout 60
Container ai-wellness-egypt-api-1 Healthy                  [exit 0]
$ curl --fail --silent http://127.0.0.1:8001/health
{"status":"ok","environment":"development"}                [exit 0]
$ docker compose exec api id
uid=10001(appuser) gid=10001(appuser) groups=10001(appuser)
$ docker compose down                                      [exit 0]

$ SUPABASE_JWT_SECRET=live-smoke-secret-xyz ENVIRONMENT=production uvicorn app.main:app --port 8765
$ curl -i "http://127.0.0.1:8765/health?token=qs-secret-abc"
HTTP/1.1 200 OK ... x-request-id: <uuid4> ... {"status":"ok","environment":"production"}
$ curl http://127.0.0.1:8765/docs   → 404
$ grep -cE "live-smoke-secret-xyz|qs-secret-abc" <server log>   → 0
```

### Failures found during development and how they were fixed

No test, lint rule or type setting was weakened.

1. **Pytest collection failed on all three TestClient test files.** Starlette 1.7 deprecates
   `httpx` as the TestClient transport in favour of `httpx2`, and `filterwarnings = error`
   turned the warning into an error. Fix: the dev dependency is now `httpx2`, which is what
   Starlette asks for. The warnings-as-errors setting was kept.
2. **A real privacy leak, caught by `test_request_log_omits_query_string_and_headers`.**
   The HTTP client library logs full request URLs, query-string tokens included, at INFO.
   Fix: `configure_logging` raises the `httpx`, `httpx2` and `httpcore` loggers to WARNING.
   This matters from M2 onward, when the backend makes outbound calls to Supabase.
3. **`test_only_milestone_one_routes_are_exposed` failed.** FastAPI 0.141 wraps included
   routers, so `route.path` is no longer exposed on `app.routes`. Fix: the test now asserts
   on the generated OpenAPI paths (`{"/health"}`), which checks the same thing more
   robustly.

## 5. Blockers and environment deviations

| Item | Status | Impact |
|---|---|---|
| Python 3.12 is not installed locally (the `py` launcher lists 3.14, 3.13 and 3.10; no `uv`). Backend checks ran on **3.13.6**. | Deviation, recorded | Low. Ruff targets `py312` and mypy checks as `python_version = "3.12"`. The Docker image runs Python 3.12 and started healthy. CI runs pytest and mypy on 3.12. The first CI run will confirm this. |
| Local Node is v22.9.0; the dependency tree needs ≥ 22.13 (`EBADENGINE` warnings) | Deviation, recorded | Low. Every frontend command succeeded. CI uses the latest Node 22. Upgrading Node locally is recommended. |
| CI has not run on GitHub | IMPLEMENTED — NOT VERIFIED | The workflow will run on the first push or PR. Nothing was committed or pushed, because that needs your approval. |
| Port 8000 is taken by a local Apache | Worked around | Use `API_PORT=8001 docker compose up`, or `uvicorn ... --port 8001`. |
| Docker daemon | Resolved | It was unreachable at the start of the session and running later. All Docker checks then passed. |

There are no blockers to M1 itself.

## 6. Open decisions

Full list: [OPEN_DECISIONS.md](OPEN_DECISIONS.md). The most important ones:

- **D-0:** the `Architecture_V2_Phase_1_Build_Spec.docx` source spec is missing.
- **D-3 / D-4 / D-5:** Supabase project, auth methods, local database strategy, and hosting
  and region.
- **D-7:** clinical reviewer, risk taxonomy and thresholds, Egyptian Arabic reviewer, and
  the anti-dependence policy.
- **D-8 to D-12:** Egyptian regulatory status, data residency, retention periods,
  accountability and disclaimers (the landing-page disclaimer is placeholder copy), and
  minimum age.
- **D-13:** crisis escalation content and emergency resources. None are invented, and this
  blocks any real-user AI access.
- **D-14:** ESLint is kept on 9 because Next's plugins don't support ESLint 10 yet.
- **D-15:** confirm that `/health` may expose the environment name.

## 7. Security notes

- **Secrets:** no real secrets exist in the repository. The root `.env.example` holds only
  server-side settings. `frontend/.env.example` holds only `NEXT_PUBLIC_*` values and warns
  that they are public. `.env` and `.env.*` are git-ignored, except `.env.example`.
- **Service-role key:** it appears only as a server-side `SecretStr` setting and is never
  referenced in `frontend/`. A CI guard fails the build if `service_role`, `jwt_secret` or
  `DATABASE_URL` appears in the frontend. Compose passes the container an explicit
  allowlist of variables, and no secrets are passed in M1.
- **Logging:** JSON lines containing metadata only (method, path, status, duration, request
  id). No headers, query strings or bodies are logged. Sensitive-looking keys and
  `SecretStr` values are redacted as a second line of defence. The Uvicorn access log is
  disabled (`--no-access-log`, and the logger is disabled in code).
  - Uvicorn's own startup lines ("Started server process…") are still plain text, because
    Uvicorn configures them before the app loads. They contain no sensitive data. A later
    milestone can pass `--log-config` to make them JSON as well.
- **Attack surface:** the only route is `/health`. API docs and the OpenAPI schema are off
  in production. The container runs as non-root, and Compose binds to `127.0.0.1` only.
- **Dependencies:** `npm install` reports 0 vulnerabilities. Python dependencies have
  major-version upper bounds.
- **Product safety:** no LLM integration, chat, safety classifier or crisis content exists.
  The landing page makes no clinical claims and states that the product does not diagnose,
  does not recommend medication, and is not a replacement for professional care.

## 8. Recommended next step

1. **Review and commit** the M1 foundation on a branch, push it, and confirm that all four
   CI jobs pass on GitHub (Python 3.12, Node 22). That closes the one IMPLEMENTED — NOT
   VERIFIED item.
2. **Resolve the prerequisites for M2:** add the V2 spec (D-0), confirm the scope of M2
   (D-2), and provide a Supabase dev project and the enabled auth methods (D-3). Settle
   minimum age (D-12) before sign-up is built.
3. **Only after approval,** start M2. Per the imported plan that is Supabase Auth: backend
   JWT verification and identity derivation, with no client-supplied user ids.

**M2 has not been started.**
