# Phase 1 Implementation Plan — Mental Health & Wellness Platform

> **Imported source document (2026-09-29).** Copied unchanged from the pre-repository planning pass, apart from this note. The Compose row listing `api, postgres, redis, worker` is superseded: Milestone 1 runs the API only, and services are added when a milestone needs them. See `OPEN_DECISIONS.md` (D-1).

**Depends on:** `SME_COUNCIL_DECISIONS.md` (read first — this plan implements those decisions)

---

## 1. Phase 1 Goals

Build the technical and product foundation for the MVP — not the full MVP itself.
By the end of Phase 1:

- The platform has working auth, consent, and a safety-gated AI companion skeleton.
- A **validation slice** (see §2) is usable end-to-end by a small internal/pilot group.
- All infrastructure (CI, migrations, observability, testing) exists so Phase 2 feature work
  doesn't start from zero.
- No clinical claims are made anywhere in the product; safety gating is real, even if the
  policies behind it are intentionally conservative placeholders pending clinical review.

Phase 1 does **not** aim to: finish all 11 frontend screens with real content, populate a
real knowledge base, or reach any retention/growth metric.

---

## 2. The Validation Slice (ship this first, inside Phase 1)

register/login → consent → goal selection (minimal) → mood check-in → AI companion chat
(one conversation, safety-gated) → one guided exercise → basic progress view.

Everything else in Phase 1 (journal, settings, full progress, knowledge base tooling) is
scaffolded but not the priority for the first internal demo.

---

## 3. Task List

Legend: **P0** = required to close Phase 1, **P1** = scaffolded now, filled in Phase 2.

### 3.1 Repository & Environment (P0)

| Task | Depends on | Definition of Done |
|---|---|---|
| Monorepo structure (`backend/`, `frontend/`, `docs/`) | — | Directory tree matches `ARCHITECTURE.md`; README explains layout. |
| Docker Compose (api, postgres, redis, worker) | Repo structure | `docker compose up` gives a working API against a fresh DB. |
| `.env.example` for all required config | Docker Compose | No secret required to run locally is missing from the example file. |
| CI pipeline (lint, type-check, test on PR) | Repo + tests exist | PR against `main` fails if lint/type/test fails; green on a trivial PR. |

### 3.2 Backend Core (P0)

| Task | Depends on | Definition of Done |
|---|---|---|
| `core/` module: config, DB session, logging, error handling | Docker Compose | App boots; structured logs emitted; config loaded from env, not hardcoded. |
| Alembic setup + first migration | `core/` | `alembic upgrade head` produces the initial schema from `DATA_MODEL.md`. |
| `auth` module: register/login/logout/refresh/delete | Migrations | Endpoints in `API_CONTRACT.md` pass integration tests incl. failure cases (bad creds, expired token). |
| `consent` module: versioned consent record + withdraw | `auth` | A user cannot proceed past onboarding without recording consent to the current version. |
| `users` module: profile, goals, preferences | `auth` | CRUD endpoints tested; profile data separated from auth credentials in schema. |
| `audit` module: audit log writer + query | `core/` | Every write to `auth`, `consent`, and `safety` emits an audit record with actor, action, timestamp. |

### 3.3 AI & Safety Skeleton (P0 — highest-risk work, sequence carefully)

| Task | Depends on | Definition of Done |
|---|---|---|
| `safety` module: risk levels, `assess_safety_risk()`, `apply_safety_policy()`, `create_safety_event()`, versioned policy config | `core/` | Given a fixed test set of sample messages (including adversarial/boundary cases), classifier assigns risk levels matching an approved expected-output table; HIGH RISK path never calls the generative model. |
| `conversations` module: create/list/get conversation, `send_message()` | `safety` skeleton, `auth` | A message cannot reach `ai.generate_response()` without first passing through `safety.assess_safety_risk()` — enforced in code path, covered by a test that asserts this ordering. |
| `ai` module skeleton: LLM provider abstraction, `classify_intent()`, `retrieve_context()`, `generate_response()`, `validate_response()`, `recommend_next_action()` | `conversations` | Provider abstraction has ≥1 concrete implementation and can be swapped via config; output safety validation runs on every generated response before it's persisted or returned. |
| `memory` module skeleton: `create_memory_candidate()`, `approve_memory()`, `retrieve_relevant_memory()`, `delete_memory()` | `ai` skeleton | No memory is retrievable until explicitly approved; deletion is real (not soft-flag-only) for user-initiated deletes. |
| AI/safety evaluation test suite (representative + adversarial + boundary conversations) | `safety`, `ai` skeleton | Suite runs in CI; includes at least the boundary categories in `ARCHITECTURE.md` §Safety Flow. |

### 3.4 Wellness Features — Validation Slice (P0)

| Task | Depends on | Definition of Done |
|---|---|---|
| `mood` module: check-in, history, recent summary | `users` | Submitting a check-in never renders any diagnostic language in the response (tested). |
| `programs`/exercise: minimal single guided exercise, `complete_exercise()` | `users` | One hardcoded exercise flow completable end-to-end and recorded. |
| `knowledge` module: document + chunk models, `approve_document()` workflow (no real content required yet) | `core/` | Workflow enforced: an unapproved document cannot be returned by `retrieve_relevant_knowledge()`. |

### 3.5 Frontend (P0 for validation slice, P1 for the rest)

| Task | Depends on | Definition of Done |
|---|---|---|
| Next.js app skeleton, Tailwind, RTL-ready layout | — | App boots; Arabic and English both render correctly RTL/LTR. |
| Auth + onboarding + consent UI | Backend auth/consent APIs | A new user can register, consent, and reach the dashboard. |
| Mood check-in UI | Backend mood API | Submits and displays history. |
| Companion chat UI | Backend conversations API | Sends/receives messages; visibly and distinctly renders a HIGH RISK safety response when triggered in test. |
| Remaining screens (journal, full progress, settings) | Above | Scaffolded route + placeholder state; not required to be feature-complete in Phase 1. |

### 3.6 Observability & Testing (P0, cross-cutting)

| Task | Depends on | Definition of Done |
|---|---|---|
| Structured logging + error monitoring abstraction | `core/` | Errors in any module are captured with enough context to debug without exposing sensitive content in logs. |
| Pytest foundation + fixtures (DB, auth) | Backend modules exist | New endpoint tests can be written without boilerplate duplication. |
| Integration tests for auth, consent, mood, conversations | Respective modules | Critical paths covered; CI-gated. |

---

## 4. Recommended Implementation Order

1. Repo + Docker + CI skeleton (nothing else can start without this).
2. `core/` + migrations.
3. `auth` → `consent` → `users`.
4. `safety` module skeleton (build and test in isolation, against a fixed message set,
   *before* wiring it into conversations).
5. `conversations` + `ai` skeleton, wired so safety gates generation.
6. `memory` skeleton.
7. `mood`, `programs` (single exercise), `knowledge` skeleton — can be parallelized once
   `users` exists.
8. `audit` wiring across the above (can start early, extend as modules land).
9. Frontend skeleton in parallel with backend from step 3 onward; validation-slice screens
   land as their backend dependency completes.
10. End-to-end test of the full validation slice.

Safety is deliberately sequenced *before* the AI module is wired to real conversations —
this is the one place in this plan where order is a hard constraint, not just a convenience.

---

## 5. Risks Specific to Phase 1 Execution

- **Building the safety gate as an afterthought.** Mitigated by sequencing (step 4 above)
  and by the architectural requirement in `ARCHITECTURE.md` that `send_message()` cannot
  call `generate_response()` without a risk assessment result.
- **Scope bleed from 18 "deliverables" into a de facto full-product Phase 1.** Mitigated by
  the explicit validation-slice cut in §2 — that's what gets a real demo, everything else is
  "exists and is tested," not "polished."
- **Placeholder safety policies being mistaken for validated ones.** Mitigated by policy
  versioning (`get_safety_policy_version()`) and by not exposing the product to real,
  non-team users until the Open Questions in `SME_COUNCIL_DECISIONS.md` §6 items 1, 2, 3, 5
  have initial answers.
- **Knowledge base shipping empty and blocking demo content.** Mitigated by treating one or
  two council-approved placeholder psychoeducation snippets as acceptable for internal demo,
  clearly marked as non-final.

---

## 6. Testing Requirements Summary

- Unit tests for every module's service layer (not just route handlers).
- Integration tests for every P0 API endpoint in `API_CONTRACT.md`, including auth failure
  and unauthorized-access cases.
- A dedicated, version-controlled AI/safety evaluation set covering: normal wellness
  conversation, medium-risk distress signals, high-risk crisis language, and adversarial
  attempts to get the AI to diagnose, prescribe, or claim clinical certainty. This set is
  the acceptance gate for any change to prompts or safety policy, not just for initial
  launch.
- CI must fail the build if the safety evaluation set regresses.
