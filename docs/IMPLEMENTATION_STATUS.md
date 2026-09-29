# Implementation Status

Last updated: 2026-09-29

Status values used: **COMPLETE — VERIFIED**, **IMPLEMENTED — NOT VERIFIED**, **BLOCKED**,
**DEFERRED**.

| Milestone | Status |
|---|---|
| **M1: Repository and engineering foundation** | **COMPLETE — VERIFIED** (`d525820`). |
| **M2: Supabase authentication** | **IMPLEMENTED; verified locally; real-Supabase verification PARTIAL** (`9474bbf`, plus evidence in `207fc13`). Against the real project, sign-up, email confirmation, dashboard access, backend verification of a real ES256 token, the anonymous redirect and the wrong-password message are all verified. A successful sign-in, reload persistence and sign-out have not been run against the real project (§9). |
| **M3: Consent and user-profile foundation** | **Implemented and COMPLETE — VERIFIED against local Postgres 17 and in CI** (`78de377`). All 21 DoD items are met with evidence (§5). **Not applied to the real Supabase database:** no `DATABASE_URL` has been provided (§7, OPEN_DECISIONS D-26). Not production-ready (see §7 and §8). |
| **CI (GitHub Actions)** | **PASSING on `main` at `78de377`**: run [36598112648](https://github.com/AbdallahYehya1/AI-WellnessEgy/actions/runs/36598112648), 4/4 jobs succeeded (§12). |
| M4 and later | Not started. Awaiting approval. |

**Repository:**
- **`main`** is the default branch and holds the full linear history:
  `d525820` (M1) → `9474bbf` (M2) → `207fc13` (M2 evidence) → `78de377` (M3).
- Milestone branches `m1-foundation`, `m2-supabase-auth` and `m3-consent-profile` are
  retained and pushed.
- There was no force-push and no history rewrite.

---

## 1. Step 1 of this pass: closing M2 operations

| Item | Result |
|---|---|
| Repository and branch state | `m2-supabase-auth` at `9474bbf`, pushed, working tree clean. `m1-foundation` and `m2-supabase-auth` are on GitHub; there is no `main` branch, so CI has never run. |
| Node ≥ 22.23.3 | Used via a portable Node 22.23.3 put first on `PATH`. The system Node is still 22.9.0. With it, `npm test` runs directly: **87/87** (M2 suite). |
| Full M2 verification suite, re-run | Backend 106 passed; ruff, format and mypy clean; frontend lint, typecheck, test (87/87) and build pass; `docker compose config` OK. |
| Live Supabase checklist | Credentials are in local, git-ignored env files; **no secret was printed**. Evidence from the founder's own browser run: sign-up → check-email → confirmation link (307) → dashboard (200) → API `/me` 200. The agent's inbox-free live checks: 3/3. See §9. |
| M2 commit | M2 code was already committed (`9474bbf`). The live evidence was committed as `207fc13` (`docs(auth): record live Supabase verification evidence for milestone 2`). Pushed with `main` in the M3 pass. |

---

## 2. What M3 adds

**Backend: database foundation**
- SQLAlchemy 2 with psycopg 3 and Alembic.
- All tables live in the Postgres schema **`app`**.
- One engine per database URL; one transaction per request, committed on success and
  rolled back on any error.
- Without `DATABASE_URL`, the endpoints return `503 service_unavailable` (fail closed).

**Migration `0001`** creates:
- `app.users`: the profile, exactly the `DATA_MODEL.md` fields.
- `app.consents`: append-only consent history.
- `app.audit_events`: append-only; a DB trigger rejects UPDATE and DELETE.

It also enables RLS on all three tables, revokes Supabase's `anon` and `authenticated`
roles when they exist, and has a working `downgrade`.

**Profile** (`users` module)
- `GET /me` and `GET /profile` create the profile on first use, race-safely.
- `PATCH /profile` updates `display_name` (validated), plus `goals` and `preferences`,
  which stay empty until decided (D-22, D-23).
- Unknown fields are rejected, so there is no way to send `user_id`.
- Ownership is structural: every lookup is keyed on the verified token's `sub`.

**Consent** (`consent` module)
- A catalog of published versions; the current one is a clearly flagged placeholder (D-24).
- `GET /consents/current` (public) and `GET /consents/me` (the caller's own status:
  `missing`, `granted`, `declined` or `outdated`).
- `POST /consents`:
  - strict boolean;
  - append-only;
  - idempotent for repeats, returning 200;
  - serialised per user with a row lock;
  - rejects unknown or superseded versions.
- `ConsentedUser` is the server-side gate for future feature endpoints (`403
  consent_required`).

**Audit** (`audit` module)
- `record_event` writes in the same transaction as the change.
- Metadata is restricted to reference tokens (versions, enum values, field names, UUIDs,
  booleans, integers), so free text, emails or tokens can't be stored.
- Actions: `user.created`, `user.profile_updated` (field names only), `consent.recorded`
  (version, type, granted).

**Errors:** validation errors use the standard error body with a `fields` list and never
echo submitted values.

**Frontend: onboarding**
- The flow is: authenticated user → `/onboarding` (optional display name, skippable) →
  `/onboarding/consent` (the draft notice, the version, an unticked "I have read and agree"
  box, then "Agree and continue" or "I don't agree") → `/dashboard`.
- The dashboard is gated on `GET /consents/me`:
  - `missing` → profile step;
  - `declined` or `outdated` → consent step;
  - API unavailable → an "unavailable" page, never the dashboard.
- The proxy protects `/onboarding/*`.
- The Server Actions use `getVerifiedSession()` (`getClaims()` first) and forward the token
  server-side only.

**Ops:**
- Compose runs `db` (Postgres 17), then `migrate` (`alembic upgrade head`, one-shot), then
  `api`.
- The Docker image ships `alembic.ini` and `migrations/`.
- CI's backend job gets a Postgres 17 service container.
- CI's Docker job checks that the migration exited 0 and that `/consents/current` is
  served.

## 3. Files changed in M3

57 paths in commit `78de377`, relative to the repository root.

**Backend: new**
- App code:
  - `app/core/db.py`;
  - `app/users/models.py`, `app/users/schemas.py`, `app/users/service.py`;
  - `app/consent/catalog.py`, `models.py`, `schemas.py`, `service.py`, `router.py`,
    `dependencies.py`;
  - `app/audit/models.py`, `app/audit/service.py`.
- Migrations: `alembic.ini`, `migrations/env.py`, `migrations/script.py.mako`,
  `migrations/versions/0001_profile_consent_audit.py`.
- Tests: `tests/test_profile.py` (30), `tests/test_consent.py` (26),
  `tests/test_audit_and_migrations.py` (14).

**Backend: changed**
- `app/main.py`: session factory, consent catalog, consent router, `database_configured`
  flag in the startup log.
- `app/users/router.py`: `/me` now uses the profile; adds `/profile`.
- `app/common/errors.py`: validation error handler with a `fields` list.
- `pyproject.toml`: adds sqlalchemy, alembic, psycopg[binary], and testcontainers[postgres]
  (dev).
- `Dockerfile`: copies the migrations.
- Tests: `tests/conftest.py` (migrated test database, truncation between tests),
  `tests/auth_helpers.py`, `tests/test_auth.py` (`/me` now returns `supabase_user_id`),
  `tests/test_app_startup.py` (route list).

**Frontend: new**
- Pages: `app/onboarding/page.tsx`, `app/onboarding/consent/page.tsx`.
- Components: `components/onboarding/profile-form.tsx`, `consent-form.tsx`,
  `service-unavailable.tsx`.
- Lib: `lib/auth/session.ts`, `lib/onboarding/actions.ts`, `steps.ts`, `validation.ts`.
- Tests: `app/onboarding/onboarding-pages.test.tsx` (11),
  `components/onboarding/onboarding-forms.test.tsx` (6), `lib/onboarding/actions.test.ts`
  (14), `lib/onboarding/onboarding-lib.test.ts` (11), `lib/api/backend.test.ts` (7), and
  `test/backend-mock.ts` (test support).

**Frontend: changed**
- `app/dashboard/page.tsx`: the consent gate.
- `lib/api/backend.ts`: a typed client for the profile and consent endpoints.
- `lib/supabase/proxy.ts`: protects `/onboarding`.
- Tests: `app/dashboard/page.test.tsx` (rewritten, 7), `lib/supabase/proxy.test.ts` (+1).

**Repository and docs**
- `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `README.md`.
- `docs/API_CONTRACT.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`,
  `docs/OPEN_DECISIONS.md`, and this file.

## 4. Migration

`backend/migrations/versions/0001_profile_consent_audit.py` (revision `0001`):

| Object | Details |
|---|---|
| schema `app` | Created by `env.py` before migrations run. It also holds `alembic_version`. |
| `app.users` | `id` PK, `supabase_user_id` UNIQUE, `display_name` (1–50 characters check), `goals` jsonb (array check), `preferences` jsonb (object check), `created_at`, `updated_at`, `deleted_at` |
| `app.consents` | `id`, `user_id` FK → users (RESTRICT), `version`, `consent_type` (check `required`/`optional`), `granted`, `recorded_at` (`clock_timestamp()`), `withdrawn_at` (check: optional only); index on (user_id, consent_type, recorded_at) |
| `app.audit_events` | `id`, `actor_user_id` FK → users (RESTRICT), `action`, `target_type`, `target_id`, `metadata` jsonb, `created_at`; index on (actor_user_id, created_at); **trigger rejects UPDATE and DELETE** |
| Security | RLS enabled on all three tables with no policies. `REVOKE ALL` on the schema and its tables from `anon`/`authenticated` if those roles exist. |

**Verified by tests:**
- the models and the migration match (Alembic autogenerate diff is empty);
- downgrade to base and upgrade again works;
- RLS is on and nothing is in `public`;
- with simulated Supabase roles that had been granted `USAGE`, the roles have no schema or
  table privileges after migrating;
- UPDATE and DELETE on `audit_events` fail with "append-only".

**Also verified on:** the Compose `migrate` service (exit 0) and a Python 3.12 container.

**Not yet run on:** the real Supabase database (D-26).

## 5. M3 Definition of Done

| Criterion | Status | Evidence |
|---|---|---|
| Profile model implemented | COMPLETE — VERIFIED | `app/users/models.py`; autogenerate diff is empty (`test_models_match_the_migration`) |
| Profile migration implemented | COMPLETE — VERIFIED | `0001`: upgrade, downgrade and re-upgrade tested; Compose `migrate` exit 0 |
| Profile API implemented | COMPLETE — VERIFIED | `GET/PATCH /profile` and `/me`: 30 profile tests (create/sync, retrieve, update, invalid input, concurrency) |
| Profile authorisation implemented | COMPLETE — VERIFIED | 401 without or with an invalid token; lookups keyed on the verified `sub`; extra fields → 422; soft-deleted → 403 |
| Cross-user isolation tested | COMPLETE — VERIFIED | `test_users_only_see_their_own_profile`, `test_client_supplied_user_id_cannot_select_another_profile`, `test_another_users_update_cannot_change_my_profile`, `test_consent_is_per_user`, `test_client_supplied_user_id_cannot_read_or_record_for_someone_else`. All five failed when the ownership filter was removed (mutation check, §6.2). |
| Consent model implemented | COMPLETE — VERIFIED | `app/consent/models.py` and DB checks; covered by the model/migration diff test |
| Consent migration implemented | COMPLETE — VERIFIED | `0001` (as above) |
| Consent API implemented | COMPLETE — VERIFIED | `GET /consents/current`, `GET /consents/me`, `POST /consents`: 26 consent tests |
| Current consent retrieval works | COMPLETE — VERIFIED | `test_current_consent_is_public_and_flags_pending_review`, `test_new_account_has_no_consent`, `test_grant_current_version` |
| Consent versioning works | COMPLETE — VERIFIED | `test_new_version_does_not_inherit_old_consent` (outdated; old version rejected; the new acceptance is a new row; the old row is untouched), `test_unknown_version_is_rejected`. It failed when the version check was removed (§6.2). |
| Consent changes are auditable | COMPLETE — VERIFIED | `test_consent_change_is_audited_with_minimal_metadata`, `test_every_decision_change_is_audited`, append-only trigger tests; E2E audit trail |
| Required consent gates the application flow | COMPLETE — VERIFIED | Server side: `ConsentedUser` tests (blocked before consent, after a decline and after a version change; allowed after acceptance). Frontend: dashboard gate tests, which failed when the gate was removed (§6.2); E2E: dashboard blocked before consent and after a decline. |
| Frontend onboarding works | COMPLETE — VERIFIED (local stand-in auth) | 38 onboarding and gate unit tests; browser E2E 18/18 (§6.3) |
| Backend tests pass | COMPLETE — VERIFIED | 176 passed (Python 3.13.6 and 3.12.14) |
| Frontend tests pass | COMPLETE — VERIFIED | 138 passed (Node 22.23.3) |
| Ruff passes | COMPLETE — VERIFIED | `ruff check .` and `ruff format --check .` (54 files) |
| Mypy passes | COMPLETE — VERIFIED | `mypy app` (41 files) and `mypy app tests` (52 files), strict |
| Typecheck passes | COMPLETE — VERIFIED | `npm run typecheck` |
| Production build passes | COMPLETE — VERIFIED | `npm run build`; `/onboarding` and `/onboarding/consent` are dynamic (`ƒ`) |
| Documentation matches implementation | COMPLETE — VERIFIED | API_CONTRACT (profile, consents, error shape), DATA_MODEL, ARCHITECTURE note, README, OPEN_DECISIONS D-22 to D-28, and this file |
| No secrets committed | COMPLETE — VERIFIED | `.env` and `.env.local` are git-ignored (checked with `git check-ignore`); scan in §8 |

## 6. Verification

### 6.1 Required commands: final run (real output, abridged)

Environment: Windows 11, Git Bash. Python 3.13.6 (the venv); Node **v22.23.3** on `PATH`;
Docker 29.8.0. The backend tests start `postgres:17-alpine` via testcontainers.

```text
$ cd backend
$ python -m pytest -q
176 passed in 12.57s        TOTAL 716 stmts, 11 missed, 98% coverage       [exit 0]
$ ruff check .                 All checks passed!                           [exit 0]
$ ruff format --check .        54 files already formatted                   [exit 0]
$ mypy app --show-error-codes        Success: no issues found in 41 source files [exit 0]
$ mypy app tests --show-error-codes  Success: no issues found in 52 source files [exit 0]

$ cd ../frontend
$ node --version               v22.23.3
$ npm install                  0 vulnerabilities (EBADENGINE warnings come from npm itself,
                               which still runs on the system Node 22.9)       [exit 0]
$ npm run lint                 eslint . --max-warnings=0, no findings          [exit 0]
$ npm run typecheck            next typegen && tsc --noEmit ✓                  [exit 0]
$ npm test                     Test Files 13 passed (13), Tests 138 passed (138) [exit 0]
$ npm run build                ✓ Compiled successfully
  Route (app): ○ /  ○ /auth/check-email  ƒ /auth/confirm  ƒ /dashboard
               ƒ /onboarding  ƒ /onboarding/consent  ƒ /sign-in  ○ /sign-up   [exit 0]

$ cd ..
$ docker compose config --quiet                                              [exit 0]
```

**Coverage gaps (11 lines):**
- `users/service.py` 60-61 and 65-66: the goals/preferences change branches, which can't
  be reached until D-22/D-23 define values;
- defensive error branches in `tokens.py`, `errors.py` and `users/schemas.py`.

### 6.2 Additional checks

- **Python 3.12.14** (`python:3.12-slim` container, against the Compose Postgres): 176
  passed; ruff and mypy clean.
- **Docker stack** (`API_PORT=8001 docker compose up --build --wait`):
  - `db` becomes healthy, `migrate` runs `0001` and exits 0, and `api` becomes healthy;
  - `/health` → `{"status":"ok"}`;
  - `/me`, `/profile` and `/consents/me` without a token → 401;
  - `/consents/current` → 200 with `pending_legal_review: true`;
  - `/me` with `Bearer a.b.c` and no `SUPABASE_URL` → 503;
  - `app` schema tables: `alembic_version`, `audit_events`, `consents`, `users`.
  - The two new CI shell checks (migrate exit code, consent version served) were dry-run
    locally and pass.
- **Mutation checks** (restored afterwards; the suites were re-run green). Two backend bugs
  were planted together:
  - consent status ignoring the version;
  - the profile lookup ignoring who is calling.

  Result: **7 backend tests failed**:
  - `test_new_version_does_not_inherit_old_consent`;
  - `test_feature_is_blocked_again_when_a_new_version_is_published`;
  - `test_consent_is_per_user`;
  - `test_client_supplied_user_id_cannot_read_or_record_for_someone_else`;
  - the three profile isolation tests.

  A third planted bug, the dashboard skipping its consent gate, made **3 frontend tests
  fail**.

### 6.3 End-to-end browser run (M3)

Headless Edge ran against the real Next.js app, the real FastAPI backend and the Compose
**Postgres 17**. Auth came from the local Supabase Auth stand-in, because the real project
needs an inbox. Afterwards, the database was inspected with `psql`.

```text
PASS  after confirmation, a new user lands on profile setup (not the dashboard)
PASS  no consent was assumed at account creation
PASS  dashboard redirects to onboarding before consent
PASS  profile saved, moved on to the consent step            (Arabic display name stored)
PASS  consent page shows the DRAFT / pending legal review notice
PASS  confirmation checkbox is not pre-ticked
PASS  agreeing without ticking the box records nothing
PASS  decline is recorded as granted=false
PASS  after declining, the dashboard is still blocked
PASS  after agreeing, the dashboard opens and greets the user by name
PASS  consent history is append-only: decline then grant, same version
PASS  consented user visiting the consent page goes to the dashboard
PASS  onboarding is protected when signed out
PASS  returning user goes straight to the dashboard
PASS  audit trail: user.created, profile update, two consent decisions
PASS  audit rows contain no email, name, token or JWT
PASS  profile row holds no email
PASS  API ignores a client-supplied user id without a token (401)
18/18 checks passed

Log leak scan (API log / Next log): email 0/0, display name 0/0, "eyJ" 0/0,
"Bearer " 0/0, password 0/0
```

### 6.4 Failures found and fixed during M3

No test, lint rule or type setting was weakened.

1. **The testcontainers import was deprecated.** `filterwarnings = error` caught it; the
   import was moved to `testcontainers.community.postgres`.
2. **A test read an expired ORM object after commit.** It was test code; the test session
   now uses `expire_on_commit=False`.
3. **Bandit S608 flagged f-string SQL** in the migration's role-revoke block and in a test.
   The inputs were constants, but both were rewritten as literal SQL rather than
   suppressed.
4. **Strict mypy flagged loose typing in two test assertions.** Fixed with typed helpers.
5. **The M2 `/me` assertions changed deliberately:** `user_id` is now the app profile id,
   and the token identity moved to `supabase_user_id`. The token-identity checks were
   kept, just moved to the new field.

## 7. Blockers

| Item | Status | What unblocks it |
|---|---|---|
| M3 migrations not applied to the real Supabase database | BLOCKED (founder) | Provide a server-only `DATABASE_URL` in `backend/.env`, run `alembic upgrade head`, then confirm `app` is not an exposed API schema (D-26). |
| Consent text is a placeholder | BLOCKED for public launch (legal) | Counsel's terms and privacy text (D-24, D-11). Publishing it is a new catalog version, which forces re-consent. |
| Remaining M2 live checks | Pending (founder) | Sign in, reload, sign out on the real project (§9). |
| CI | **Resolved.** `main` was created and pushed; the first run passed 4/4 (§12). | None |
| System Node 22.9 | Worked around locally | Upgrade to Node ≥ 22.22.2. Until then, **`npm` itself must also run on the newer Node**. Otherwise `npm ci` or `npm install` skips Rolldown's optional native binding and `npm test` can't start (seen and fixed during the M3 pre-commit run). CI is unaffected, since it uses Node 22.23.2. |

## 8. Security findings and notes

- **Identity and ownership:** every profile and consent lookup is keyed on the verified JWT
  `sub`. No endpoint takes a user id; bodies with `user_id`, `supabase_user_id` or `email`
  are rejected (422). Tests and mutation checks confirm this.
- **Explicit consent only:**
  - nothing is recorded at sign-up;
  - `granted` must be a JSON boolean;
  - the UI requires an unticked checkbox and a button press;
  - older-version acceptances show as `outdated` and are never upgraded;
  - duplicates are idempotent and concurrency-safe.
- **Fail closed:**
  - no `DATABASE_URL` → 503;
  - consent status unavailable → the dashboard shows an error page, not content;
  - soft-deleted profile → 403.
- **Audit:**
  - written in the same transaction as the change;
  - append-only, enforced by a DB trigger;
  - metadata limited to reference tokens by code;
  - the E2E run and tests confirm no email, name, token or JWT in audit rows.
- **Supabase exposure:** the tables are in schema `app`, with RLS on (no policies) and the
  Data API roles revoked. This was tested with simulated roles on plain Postgres, not yet
  on Supabase itself (D-26).
- **Logs:** the request log is metadata only; the M3 E2E leak scan was clean.
- **Secrets:**
  - `frontend/.env.local` and `backend/.env` contain real values and are git-ignored
    (`git check-ignore` confirmed);
  - only `.env.example` templates are tracked;
  - the Compose database password is a local-only development value;
  - the CI database password is for a throwaway CI container;
  - the service-role key is still unused and never referenced in `frontend/`, and the CI
    guards still apply.
- **Open, accepted for now:**
  - no admin or compliance access tooling (D-28);
  - no link to `auth.users` deletion (D-27);
  - auth cookies are not `HttpOnly` (D-20);
  - no app-level rate limiting (D-21);
  - the legacy JWT secret shared in chat should be rotated (D-17).

## 9. M2 record (for reference)

| M2 criterion | Status |
|---|---|
| Sign-up through Supabase Auth | COMPLETE — VERIFIED (live) |
| Email-confirmation-pending flow | COMPLETE — VERIFIED (live) |
| Email/password sign-in | IMPLEMENTED — NOT VERIFIED on the real project (success path). Wrong-password path verified live; success verified against the stand-in. |
| Session persistence | IMPLEMENTED — NOT VERIFIED on the real project (stand-in E2E passes) |
| Sign-out | IMPLEMENTED — NOT VERIFIED on the real project (stand-in E2E passes) |
| Protected dashboard; backend JWT validation; 401 handling; `/me` from verified JWT; no custom credentials; no secrets; checks pass; docs | COMPLETE — VERIFIED |

**Live evidence against the real project:**
- the founder's session: `POST /sign-up` 200 → `/auth/check-email` → `/auth/confirm` 307
  → `/dashboard` 200 → API `/me` 200 (a real ES256 token);
- the agent's checks: anonymous `/dashboard` → `/sign-in?next=/dashboard`; a real
  `invalid_credentials` → "The email or password is incorrect."; a forged token with the
  real `kid` → 401 `invalid_signature`;
- no emails, JWTs or bearer tokens in the logs.

The full M2 write-up is in git history at `207fc13:docs/IMPLEMENTATION_STATUS.md`.

## 10. Open decisions

Full list: [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

- **New in M3:**
  - D-22: goals vocabulary;
  - D-23: preference keys;
  - D-24: consent text and publishing process (blocks launch);
  - D-25: optional consents and withdrawal;
  - D-26: apply the migrations to Supabase (needs `DATABASE_URL`);
  - D-27: link to `auth.users` deletion;
  - D-28: staff access to audit and consent records.
- **Updated:**
  - D-2: M3 scope recorded;
  - D-4: Postgres 17 engineering default;
  - D-10 and D-11: M3 status;
  - D-12: the attestation is still not stored, because the model has no field for it.

## 11. Recommended next step

1. **Founder:**
   1. Provide a server-only `DATABASE_URL` and run `alembic upgrade head` against Supabase
      (D-26).
   2. Finish the M2 live checks: sign in, reload, sign out.
   3. Rotate the legacy JWT secret.
2. **Done:** `main` was established and pushed, and CI passes (§12). From now on, work on a
   feature branch and merge into `main` through a pull request, so CI runs before the
   merge.
3. **Legal:** start the consent text (D-24, D-11) and the age-attestation wording (D-12).
   Product and clinical: the goals vocabulary (D-22).
4. **Only after approval,** plan M4.

**M4 has not been started.**

## 12. CI result (GitHub Actions)

The first-ever run was triggered by the push of `main` at `78de377`:
[run 36598112648](https://github.com/AbdallahYehya1/AI-WellnessEgy/actions/runs/36598112648).
Result: **completed / success**. Every step of every job was inspected; all succeeded.

| Job | Result | Evidence from the job log |
|---|---|---|
| Backend (Python 3.12) | success | CPython 3.12.14 on ubuntu-24.04 with a Postgres 17 service container. Ruff: "All checks passed!". Format: "54 files already formatted". Mypy: "no issues found in 52 source files". Pytest: **176 passed**, 98% coverage (12 lines missed on Linux against 11 locally; all in defensive branches). |
| Frontend (Node 22) | success | Node v22.23.2; `npm ci`: 0 vulnerabilities; lint and typecheck pass; Vitest **13 files, 138 tests passed**; build "Compiled successfully", `/onboarding` and `/onboarding/consent` dynamic |
| Repository guards | success | No tracked `.env`; no server-only secret names in `frontend/`; no secret-looking `NEXT_PUBLIC_` names |
| Docker | success | Compose config valid. db `Healthy`, migrate exited 0 (asserted), api `Healthy`. `/health` is exactly `{"status":"ok"}`; `/consents/current` is served; `/me` returns 401 anonymously and 503 without Supabase |

Also in this pass:
- **Pre-commit audit:**
  - the change set was inspected (57 files);
  - the secret and project-identifier scan was clean;
  - `.env`, `.env.local`, `.coverage`, caches and build output were confirmed ignored;
  - migrations, tests and docs are included;
  - every DB query is keyed on the verified identity;
  - no route takes a user id;
  - request bodies forbid extra fields;
  - the audit trigger is intact.
- **Final local run before commit:**
  - backend: 176 passed; ruff, format and mypy clean;
  - frontend (with `npm ci`, and npm itself on Node 22.23.3): 0 vulnerabilities, lint,
    typecheck, 138 tests and build all pass;
  - `docker compose config` OK.
