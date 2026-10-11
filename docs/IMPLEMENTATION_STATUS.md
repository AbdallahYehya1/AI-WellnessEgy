# Implementation Status

Last updated: 2026-10-02

Status values used: **COMPLETE — VERIFIED**, **IMPLEMENTED — NOT VERIFIED**, **BLOCKED**,
**DEFERRED**.

| Milestone | Status |
|---|---|
| **M1: Repository and engineering foundation** | **COMPLETE — VERIFIED** (`d525820`). |
| **M2: Supabase authentication** | **COMPLETE — VERIFIED** (`9474bbf`, evidence `207fc13`). The founder reported (2026-10-01) that the last three real-account checks passed: successful sign-in, session persistence after reload, and sign-out with the protected-dashboard redirect. The earlier live checks are in §M3-9. |
| **M3: Consent and user-profile foundation** | **COMPLETE — VERIFIED** locally and in CI (`78de377`, docs `9ff5b9d`). Migration `0001` is still a separately controlled deployment step for the real Supabase database (D-26). |
| **M4: Mood check-in and wellness-data foundation** | **Implementation COMPLETE — VERIFIED** (local) and **CI COMPLETE — VERIFIED** (PR #1, two runs). **PR review and merge: PENDING.** The review in §M4-R found no blocking defects; both Medium findings are **fixed locally** (§M4-R.4) and await commit, push and re-review. **Real Supabase migration: PENDING (D-26)**; runbook ready, not executed. **Real-Supabase end-to-end: PARTIAL**: real Supabase **auth** with a **local** database was exercised by the founder (§M4-R.3); with the Supabase **database** it is not verified. **Launch blockers unresolved:** D-32, D-33 and the M5 entry gate (OPEN_DECISIONS §I). |
| M5 and later | Not started. Awaiting approval. |

**Repository:**
- `main` = `9ff5b9d` (M1 → M2 → M2 evidence → M3 → docs).
- M4 work is on **`m4-mood-checkin`**, branched from `main`. It is opened as a pull request
  for review and CI, and is not merged.
- The milestone branches `m1-foundation`, `m2-supabase-auth` and `m3-consent-profile` are
  retained.

---

# M4-R: Pre-merge review (2026-10-02)

Scope: PR #1 (`m4-mood-checkin` at `61e1676` → `main` at `9ff5b9d`). This was a review
only. Nothing was merged, pushed or migrated on Supabase, and no M5 code was written.

## M4-R.1 Findings by severity

| Severity | Finding | Evidence | Recommended fix |
|---|---|---|---|
| Critical / High | **None found** | Diff review, test re-run, migration rehearsal (§M4-R.2) | None |
| **Medium: FIXED (§M4-R.4)** | **D-32 mitigation is UI-only.** `POST /mood/checkins` accepts and stores `note` from any authenticated client, although the product position is "no notes before the safety layer". | `MoodCheckinCreate.note: str \| None` (`app/mood/schemas.py:38`); tests `test_checkin_is_stored_exactly`, `test_note_is_optional` | A founder decision (recorded under D-32): either reject a non-null `note` server-side (for example `422 notes_not_enabled` behind a setting that defaults to off, with a contract-deviation note), or accept the documented risk until M5. Not merge-blocking (no real users, Supabase DB not migrated), but launch-blocking. |
| **Medium: FIXED (§M4-R.4)** | **Keyboard focus is invisible on the mood scale.** The radio inputs are `sr-only` and the visible labels have no focus style, so keyboard users can't see which score is focused. | `components/mood/mood-form.tsx:29` (label classes have no focus variant) and `:36` (`sr-only`) | Add a focus-visible style to the label (for example `has-focus-visible:ring-2 has-focus-visible:ring-calm-700`), plus a test that asserts the class or uses a keyboard-navigation check. Small change; recommended before merge or as the first follow-up. |
| Low | History times are shown in UTC ("… UTC"), not local time. That's clear but unfriendly for users in Egypt. | `components/mood/mood-history.tsx:6` (`timeZone: "UTC"`) | Product decision: render in the user's time zone on the client, or in `Africa/Cairo`. Not blocking. |
| Low | With outdated or declined consent, users can't read their own mood history (403). This is correct for the consent gate, but a data-access or export path may be legally required regardless of consent. | `read_history` depends on `ConsentedUser` | Track under D-10 and D-8 with the planned `/privacy/export`. No change now. |
| Low | `0002`'s `RENAME CONSTRAINT` assumes the database was created by this repository's `0001`. On a hand-modified database it fails, but safely (the transaction rolls back). | `migrations/versions/0002_mood_checkins.py:34-50` | Covered by the runbook (§2 stop conditions, §5 recovery). |
| Info | The migrations revoke `anon` and `authenticated` only. Other Supabase roles (for example `service_role`) aren't revoked. `app` is not an exposed Data API schema, and `service_role` is a server-only secret that this project doesn't use. | `0001:161`, `0002:104` | After D-26, verify Exposed schemas excludes `app` (runbook §4). Optionally revoke `service_role` in a later migration if a policy requires it. |
| Info | No rate limiting on `POST /mood/checkins` (D-21). | No limiter in the code | M5 gate G-5. |

**Checked and found consistent:**
- **Contract:** the OpenAPI document exposes exactly `from`, `to` and `limit` (all
  optional) for history. The body schema has `required: [mood_score]` and
  `additionalProperties: false`.
- **`limit`:** documented consistently in `API_CONTRACT.md` (heading and parameter list)
  and in the README.
- **`0001`:** byte-for-byte unchanged against `main`.
- **`0002`:** touches other tables only through `RENAME CONSTRAINT`.
- **Diff scope:** 34 files, all within the expected areas, with no secrets or unrelated
  changes.
- **Onboarding order:** sign-in → (profile) → consent → `/check-in` → dashboard
  (`lib/onboarding/actions.ts` → `CHECK_IN_PATH`; E2E 16/16).
- **States:** loading uses the pending-button state; the empty state is "No check-ins
  yet."; a history error shows a non-blocking message; consent unavailable fails closed;
  invalid input shows a field error (tests in `check-in.test.tsx` and
  `page.test.tsx`).
- **Arabic and English:** Arabic page titles, with English body copy marked provisional
  (D-19, D-31).

## M4-R.2 Checks personally re-run in this review (2026-10-02)

| Check | Command or method | Actual result |
|---|---|---|
| Backend tests | `python -m pytest -q` (Python 3.13.6, Postgres 17 testcontainer) | **233 passed**, 99% coverage (836 statements, 11 missed) |
| Lint and format | `ruff check .`, `ruff format --check .` | All checks passed; 60 files already formatted |
| Types | `mypy app` and `mypy app tests` (strict) | No issues (45 and 57 files) |
| Frontend | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (Node 22.23.3, with npm on 22.23.3) | 0 vulnerabilities; lint and typecheck clean; **173 passed** (14 files); build compiled |
| Compose config | `docker compose config --quiet` | exit 0 |
| Fresh migration | Compose with a new volume | `-> 0001`, `0001 -> 0002`, migrate exit 0; api healthy |
| Repeat migration | `docker compose run --rm migrate` again, then `alembic current` | No "Running upgrade" (a no-op); `0002 (head)` |
| Schema posture | `psql` in the Compose database | 0 tables in `public`; RLS on for `audit_events`, `consents`, `mood_checkins`, `users` |
| Endpoints | `curl` against the Compose API | `/health` 200, `/consents/current` 200, `/mood/history` 401 (no token) |
| Diff and contract | `git diff main...HEAD`; OpenAPI introspection | As in §M4-R.1 |

**Historical results, not re-run here:**
- CI runs 36959093412 and 36959260548. PR #1 currently reports all four checks
  `SUCCESS` and the PR is `MERGEABLE` / `CLEAN` (read with `gh pr view 1`).
- The 16/16 browser E2E from the M4 build.

## M4-R.3 Real Supabase auth with a local database (founder session, 2026-10-02 06:30–06:32 +03:00)

Evidence from the local API log of the founder's own browser session. The backend was
configured with the real `SUPABASE_URL` and the **local** Compose database. Only method,
path and status are logged:
- `PATCH /profile` 200;
- `POST /consents` 201;
- `POST /mood/checkins` 201;
- `GET /mood/history` 200 (×2);
- `GET /consents/me` 200 (×4);
- `GET /me` 200;
- the one 401 (`missing_token`) was the agent's own unauthenticated probe.

Log scan: emails 0, `eyJ` 0, `Bearer ` 0, `mood_score` 0, `note` 0.

**What this proves:** real Supabase ES256 tokens pass the backend checks, and the full M4
flow works with real auth. **What it doesn't prove:** anything about the **Supabase
database**. Migrations aren't applied there (D-26), and that run needs the runbook.

## M4-R.4 Fixes for the two Medium findings (2026-10-02, uncommitted)

**1. Notes rejected server-side (temporary policy, D-32 remains open).**
- `backend/app/mood/schemas.py`: `MoodCheckinCreate._reject_note` rejects **any**
  `note` string with `422 validation_failed` and the field message "Notes aren't accepted
  yet. Leave the note out.". That covers empty, whitespace-only, ordinary text and
  oversized notes. An omitted or `null` note is still accepted.
  - It's a hard rule in code, not a config flag.
  - The old note-content validators were removed as dead code; the DB column and its
    check are unchanged.
- **Before storage:** this is Pydantic request validation, so the handler never runs.
  The request's DB transaction rolls back on the error. Tests assert **0 rows** in
  `app.mood_checkins` and **0** `mood.*` audit events after each rejected request.
- **Tests:**
  - `test_any_note_is_rejected_before_storage`, 7 cases: text, Arabic with line breaks,
    spaces, newline, empty, 1000 characters, 100 000 characters. Each checks the exact
    error body, that the text isn't echoed, 0 rows, 0 mood audit events, and that the text
    doesn't appear in captured logs.
  - `test_omitted_or_null_note_is_still_accepted`.
  - `test_rejected_note_is_not_stored_even_with_a_valid_score`: no silent drop of the
    note.
  - History, logging, audit and isolation tests updated so that notes never appear.
- **Mutation check:** making the validator accept notes again made **15 tests fail**.
  With the fix restored, 63/63 mood tests pass.
- **Docker:** a POST with `"note": "sensitive text"` appears **0** times in the API log.
- **Docs:** API_CONTRACT (a deliberate, temporary deviation, documented), OPEN_DECISIONS
  D-32 and G-6, DATA_MODEL and README. D-33 (encryption and retention) is **not** claimed.

**2. Visible keyboard focus on the mood scale.**
- `frontend/components/mood/mood-form.tsx`: each score label gets
  `has-focus-visible:outline-2 has-focus-visible:outline-offset-2
  has-focus-visible:outline-calm-900`. Selection keeps its separate style (filled
  background and darker border).
- **Tests** (`app/check-in/check-in.test.tsx`, +2):
  - every score label carries the focus classes and the distinct selected style;
  - keyboard-only operation: Tab focuses "1", arrow keys move to and select "3", Tab
    reaches the submit button, and Enter submits `moodScore=3`.
- **Compiled CSS:** the production build contains
  `.has-focus-visible\:outline-2:has(:focus-visible){…outline-width:2px}`, plus the
  offset and colour rules.
- **Real browser** (headless Edge with the compiled CSS and real keyboard input):

  | State | Outline | Background / border |
  |---|---|---|
  | Focused | `solid 2px rgb(28,56,48)`, offset 2px | white / light |
  | Not focused | `none` | white / light |
  | Selected and focused | `solid 2px`, offset 2px | `rgb(224,238,232)` / `rgb(47,93,80)` |
  | Selected, not focused | `none` | `rgb(224,238,232)` / `rgb(47,93,80)` |

  Focused and selected stay distinguishable in every combination.

**Verification after the fixes (personally run):**
- **Backend:** `pytest` **241 passed**, 99% coverage (`mood/schemas.py` 100%); ruff
  check and format clean (60 files); strict mypy clean (45 and 57 files).
- **Frontend:** `npm ci` with 0 vulnerabilities; lint and typecheck clean; `npm test`
  **175 passed** (14 files); build compiled.
- **Compose:** `docker compose config` OK. Fresh Docker stack: migrate
  `-> 0001`, `0001 -> 0002`, exit 0; api healthy; `/health` 200; `/mood/history` 401.
- CI has **not** run on these changes yet; they aren't pushed.

---

# M4: Mood check-in and wellness-data foundation

## M4.1 Reconciliation with the source documents

| Source | What it specifies | Implemented as |
|---|---|---|
| DATA_MODEL `mood_checkins` | `id`, `user_id` FK, `mood_score smallint (1-5)`, `tags text[]` (controlled vocabulary), `note` nullable and sensitive, `submitted_at` | Exactly these columns, no extra fields (`app.mood_checkins`) |
| DATA_MODEL access | Self only; never used for clinical diagnosis; `note` sensitive | Owner-scoped queries; consent-gated; non-clinical copy; note never logged or audited |
| API_CONTRACT `POST /mood/checkins` | `{mood_score 1-5, tags?, note?}` → `201 {checkin_id, submitted_at}` | Exact payload and response |
| API_CONTRACT `GET /mood/history?from=&to=` | `{checkins:[{checkin_id, mood_score, tags, note, submitted_at}]}` | Exact shape. **Added:** `limit` (1–100, default 30), because no bound was specified. Range is `from` inclusive, `to` exclusive, timezone required. |
| PHASE_1 plan | "mood module: check-in, history, recent summary"; UI "submits and displays history"; no diagnostic language | Check-in and history built. "Recent summary" has no contract entry and was **not** built. The UI shows recent history on `/check-in` and the dashboard. |
| ARCHITECTURE §5 | `mood_checkins.note`: short retention, encrypted at rest | **Not met yet:** recorded as D-33 (blocks launch) |
| Gaps | Tag vocabulary; scale-anchor wording; free-text notes before the safety layer | D-30, D-31, D-32. Nothing invented: tags accept only `[]`, and the note field is not shown in the UI. |

## M4.2 Implementation

**Backend** (`backend/app/mood/`):
- `models.py`: `MoodCheckin`, with DB checks for the score range, tag count and note length.
- `schemas.py`:
  - strict input: `StrictInt` score in 1–5; tags checked against an empty allowlist;
  - note validated and **stored verbatim**;
  - `extra="forbid"`, so `user_id` and `submitted_at` are rejected;
  - a timezone-aware history query with `limit`.
- `service.py`: create plus an audit event (target id only); history scoped to `user.id`,
  newest first.
- `router.py`: `POST /mood/checkins` (201) and `GET /mood/history`, both depending on
  **`ConsentedUser`**, which means the verified JWT plus current consent.
- `audit/service.py`: adds the action `mood.checkin_recorded` and target type
  `mood_checkin`.

**Frontend:**
- `app/check-in/page.tsx`, gated on session and consent and failing closed:
  - the 1–5 radio scale;
  - a non-clinical explanation;
  - recent history (7 entries);
  - a "Skip for now" link.
- `components/mood/mood-form.tsx` (accessible fieldset with an error message) and
  `mood-history.tsx` (date in UTC and score only; notes never shown).
- `lib/mood/actions.ts` (Server Action) and `lib/mood/score.ts` (strict `1`–`5` parse,
  plus the path constant).
- The flow is now: consent accepted → **`/check-in`** → save → `/dashboard?status=checked-in`.
  The dashboard shows a fixed "saved" notice, recent check-ins and a "Check in now" link.
- `/check-in` was added to the proxy's protected routes.

**Ops:** the CI Docker job also asserts that `/mood/history` returns 401 anonymously.

## M4.3 Migration `0002_mood_checkins` (revision `0002`, down-revision `0001`)

- **Creates `app.mood_checkins`:**
  - PK `pk_mood_checkins`;
  - FK `fk_mood_checkins_user_id_users` → `app.users(id)` `ON DELETE RESTRICT`;
  - checks `ck_mood_checkins_mood_score_range` (1–5), `ck_mood_checkins_tags_count` (≤ 10)
    and `ck_mood_checkins_note_length` (NULL or 1–1000);
  - `submitted_at DEFAULT clock_timestamp()`;
  - index `ix_mood_checkins_user_submitted (user_id, submitted_at)`.
- **Security:** RLS enabled, and `REVOKE ALL` from `anon` and `authenticated` when present.
  The table is in schema `app`, which is not exposed by the Data API.
- **Fix to M3:** renames the five `0001` CHECK constraints whose names were doubled
  (D-34).
- **Downgrade:** drops the table and restores `0001`'s names. Tested both ways.

## M4.4 Tests (with evidence)

**Backend: `tests/test_mood.py` (55 tests)**
- **Authentication:** 401 without a token or with a bad token; 200/201 when authenticated
  and consented.
- **Consent gate:** 403 `consent_required` on both endpoints without consent, and after a
  decline.
- **Persistence:**
  - stored exactly, including an untrimmed note;
  - the owner is the caller's profile;
  - `submitted_at` comes from the server and is timezone-aware, and clients can't set it;
  - a DB check backs up the score range.
- **History:** newest-first ordering; the caller's own notes; empty for a new user;
  `limit`; inclusive/exclusive date range; 7 invalid-query cases; reversed range → 422
  `invalid_range`.
- **Validation:** 18 invalid payloads rejected with 422 and nothing stored (0, 6, -1,
  "3", 3.0, 3.5, true, null, missing, unknown tag, empty, blank or overlong note, NUL,
  zero-width character, `user_id`, …). Accepted: Arabic, line breaks, 1000 characters,
  explicit `[]` and `null`. Malformed JSON → 422. Duplicate tags → 422.
- **Isolation:**
  - users see only their own history;
  - `X-User-Id` and `?user_id=` can't read another user's data;
  - a write with another user's id is stored for the token's owner.
- **Privacy:**
  - the note, the `mood_score` key and query strings never appear in logs;
  - the audit event has `metadata == {}` and no note or score;
  - a rejected check-in writes no audit event.
- **Non-diagnostic:** response bodies contain none of "diagnos", "depress", "disorder",
  "anxiety", "risk", "symptom" or "clinical".

**Backend: `tests/test_audit_and_migrations.py` (+2, and updated)**
- the constraint-name regression test (all 16 `app` constraints pinned);
- downgrade to `0001`, then upgrade to head;
- the RLS table list and simulated Supabase roles now include `mood_checkins`;
- the model/migration autogenerate diff is empty.

**Frontend**
- `app/check-in/check-in.test.tsx` (28):
  - page access, plus consent gating for missing, declined and outdated;
  - non-clinical copy and the 1–5 scale;
  - history; fail closed;
  - the action: valid → dashboard; 7 invalid inputs rejected without an API call;
    403 → consent; 401 → sign-in; 422 and network errors;
  - `parseMoodScore`, `MoodForm` and `MoodHistory` (the note is never shown).
- `app/dashboard/page.test.tsx` (+4): the saved notice and history; an unknown status is
  ignored; history failing doesn't break the page; no history is fetched before consent.
- `lib/api/backend.test.ts` (+3), `lib/supabase/proxy.test.ts` (`/check-in` protected), and
  `lib/onboarding/actions.test.ts` (consent → `/check-in`).

**Mutation checks** (each restored afterwards and re-run green):
- the history query without the owner filter → the 3 isolation tests fail;
- `POST /mood/checkins` without the consent gate → the 2 consent tests fail;
- the check-in page without its consent redirect → 3 frontend tests fail.

## M4.5 Verification results (final local run)

Environment: Windows 11; Python 3.13.6; Node 22.23.3 (with npm itself also run on Node
22.23.3); Docker 29.8.0; Postgres 17 via testcontainers.

```text
backend $ python -m pytest -q            233 passed in 18.78s; TOTAL 836 stmts, 11 missed, 99%
backend $ ruff check .                   All checks passed!
backend $ ruff format --check .          60 files already formatted
backend $ mypy app --show-error-codes    Success: no issues found in 45 source files
backend $ mypy app tests --show-error-codes  Success: no issues found in 57 source files
frontend $ npm ci                        0 vulnerabilities, no engine warnings
frontend $ npm run lint                  no findings
frontend $ npm run typecheck             ✓
frontend $ npm test                      Test Files 14 passed (14), Tests 173 passed (173)
frontend $ npm run build                 ✓ Compiled successfully; ƒ /check-in (dynamic)
$ docker compose config --quiet          exit 0
```

The mood module has 100% line coverage. The 11 uncovered lines are pre-existing
defensive branches in M2/M3 code.

**Docker** (`API_PORT=8001 docker compose up --build --wait`, fresh volume):
- `db` healthy; `migrate` ran `-> 0001` then `0001 -> 0002` and exited 0; `api` healthy.
- `/health` → `{"status":"ok"}`.
- `POST /mood/checkins` and `GET /mood/history` without a token → 401. With `Bearer a.b.c`
  and no Supabase → 503.
- `alembic_version = 0002`; RLS on for `audit_events`, `consents`, `mood_checkins` and
  `users`; correctly named constraints and the index are present.

**Browser E2E** (headless Edge; real Next.js, real FastAPI, Compose Postgres 17; auth from
the local Supabase stand-in): **16/16**.

```text
PASS  sign in without consent lands on onboarding
PASS  /check-in before consent redirects to onboarding
PASS  after consent, the user lands on the mood check-in
PASS  check-in explains it is not a medical assessment
PASS  history starts empty
PASS  submitting without a score shows clear feedback and stores nothing
PASS  valid check-in continues to the dashboard
PASS  dashboard confirms the check-in was saved
PASS  dashboard shows the new check-in
PASS  history is newest first
PASS  rows stored as submitted (score, no note, no tags)
PASS  both rows belong to one profile
PASS  each check-in is audited without score or note   (mood.checkin_recorded {} ×2)
PASS  another user's check-in page shows none of A's history
PASS  /check-in is protected after sign-out
PASS  returning user goes to the dashboard with history intact
```

Log leak scan of that run (API / Next): `mood_score` 0/0, `moodScore` 0/0, emails 0/0,
`eyJ` 0/0, `Bearer ` 0/0, passwords 0/0. The API log contains only method, path and
status.

**CI:** passed on pull request #1 (§M4.8).

## M4.6 Security and privacy checks

- **Identity:** the owner always comes from the verified Supabase JWT (`ConsentedUser` →
  `get_or_create_user` keyed on `sub`). There are no user-id parameters; bodies and queries
  with `user_id` are rejected; header and query overrides are ignored (tested).
- **Isolation:** every mood query filters on `MoodCheckin.user_id == user.id`, and the
  mutation check proves the tests depend on it. RLS is enabled, and the Data API roles are
  revoked on the new table.
- **Consent:** both endpoints require the current consent, enforced server-side and in the
  UI.
- **Logs:** request logs carry metadata only, with no bodies or query strings. Verified by
  test and by the E2E log scan.
- **Audit:** the event records only that a check-in happened, plus its id. There is no
  score, tags or note, which avoids duplicating sensitive data.
- **Analytics:** none; mood data goes nowhere else.
- **Non-clinical:** tested on API responses and UI copy; the UI states it is not a medical
  assessment.
- **Secrets:** no credentials added; `.env` files are still ignored; no service-role usage.
- **Open:** note encryption and retention (D-33); free-text notes before the safety layer
  (D-32); no rate limiting (D-21); no CSP (D-20).

## M4.7 M4 Definition of Done

| Item | Status | Evidence |
|---|---|---|
| Existing mood architecture reconciled | COMPLETE — VERIFIED | §M4.1 |
| `mood_checkins` model implemented | COMPLETE — VERIFIED | `app/mood/models.py`; autogenerate diff empty |
| Alembic migration implemented | COMPLETE — VERIFIED | `0002`: upgrade, downgrade and re-upgrade tested; Compose migrate exit 0 |
| Database constraints implemented | COMPLETE — VERIFIED | 3 checks, FK, PK and index; DB rejects score 9 (test); names pinned |
| User ownership enforced | COMPLETE — VERIFIED | Owner from JWT; scoped queries; mutation check |
| Cross-user isolation tested | COMPLETE — VERIFIED | 3 isolation tests and an E2E check |
| Mood creation API implemented | COMPLETE — VERIFIED | `POST /mood/checkins`, exact contract |
| Mood history API implemented | COMPLETE — VERIFIED | `GET /mood/history`, contract shape plus documented `limit` |
| Server-side validation implemented | COMPLETE — VERIFIED | 18 invalid payloads and 8 invalid queries rejected |
| Sensitive mood data excluded from ordinary logs | COMPLETE — VERIFIED | Log test and E2E log scan |
| Appropriate audit behaviour implemented | COMPLETE — VERIFIED | `mood.checkin_recorded`, `metadata == {}`, nothing on rejection |
| Frontend mood check-in implemented | COMPLETE — VERIFIED | `/check-in`; 28 tests; E2E |
| Consent gating works | COMPLETE — VERIFIED | API 403 tests; page redirects; E2E |
| End-to-end flow works | COMPLETE — VERIFIED (local stand-in auth) | 16/16 |
| Backend tests pass | COMPLETE — VERIFIED | 233 passed |
| Frontend tests pass | COMPLETE — VERIFIED | 173 passed |
| Ruff passes | COMPLETE — VERIFIED | check and format clean |
| Mypy passes | COMPLETE — VERIFIED | strict, 45/57 files |
| Typecheck passes | COMPLETE — VERIFIED | `npm run typecheck` |
| Production build passes | COMPLETE — VERIFIED | `npm run build` |
| Docker verification passes | COMPLETE — VERIFIED | §M4.5 |
| CI passes | COMPLETE — VERIFIED | PR #1 run 36959093412 on `613f459`: 4/4 jobs, 41/41 steps (§M4.8) |
| Documentation updated | COMPLETE — VERIFIED | API_CONTRACT, DATA_MODEL, README, OPEN_DECISIONS D-30 to D-34, this section |
| No secrets committed | COMPLETE — VERIFIED | Pre-commit scan (§M4.8) |
| No AI generation implemented prematurely | COMPLETE — VERIFIED | No LLM, RAG, embedding, memory or risk code; `ai/*` and `safety` are still boundary-only packages |

## M4.8 Commit, push and CI

**Git:**
- M4 is committed as `613f459` (`feat(mood): implement mood check-in and wellness data
  foundation`) on `m4-mood-checkin` and pushed.
- Pull request [#1](https://github.com/AbdallahYehya1/AI-WellnessEgy/pull/1)
  `m4-mood-checkin → main` is open and **not merged**. `main` is unchanged at `9ff5b9d`.

**Pre-commit audit:**
- 34 paths;
- no `.env`, `.coverage`, build or cache files;
- the secret and project-identifier scan was clean;
- no AI or LLM code was added (the only matches are M1's docstring-only `ai/*` and
  `conversations` boundary files, which are unchanged).

**CI:** [run 36959093412](https://github.com/AbdallahYehya1/AI-WellnessEgy/actions/runs/36959093412),
event `pull_request`, commit `613f459`. Result: **completed / success**.

| Job | Result | Evidence from the job log |
|---|---|---|
| Backend (Python 3.12) | success (13/13 steps) | CPython 3.12.14 with a Postgres 17 service container. Ruff: "All checks passed!". Format: "60 files already formatted". Mypy: "no issues found in 57 source files". Pytest: **233 passed**, 99% coverage |
| Frontend (Node 22) | success (11/11 steps) | `npm ci`, lint, typecheck; Vitest **14 files, 173 tests passed**; build with `ƒ /check-in` |
| Repository guards | success (7/7 steps) | No tracked env files; no server-only secrets in the frontend; no secret-looking `NEXT_PUBLIC_` names |
| Docker | success (10/10 steps) | db `Healthy`, migrate exited 0 (asserted), api `Healthy`. `/health` exact; consent version served; `/me` and **`/mood/history` 401** anonymously; `/me` 503 without Supabase |

The docs-only follow-up commit that records this table triggers another PR run; its result
is reported in the M4 handover.

---

# M3 record (as of `9ff5b9d`)

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
