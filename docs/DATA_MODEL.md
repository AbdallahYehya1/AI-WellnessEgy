# Data Model — Mental Health & Wellness Platform

> **Imported source document (2026-09-29), updated for M3.** Copied from the pre-repository planning pass. Retention values are pending legal/clinical review (`OPEN_DECISIONS.md`).
>
> **Implemented in M3** (Alembic revision `0001`, all in the dedicated Postgres schema **`app`**, with RLS enabled): `users`, `consents` and `audit_events`, with exactly the fields below. Implementation details that go beyond this document:
> - `users.display_name` is at most 50 characters (DB check).
> - `goals` must be a JSON array and `preferences` a JSON object (DB checks). The application allows only `[]` and `{}` until the vocabulary and keys are decided (D-22, D-23).
> - `consents.consent_type` is a text column with a check constraint (`required`/`optional`). `withdrawn_at` is only allowed for `optional`. `recorded_at` uses `clock_timestamp()`.
> - `audit_events` is append-only **in the database** (a trigger rejects UPDATE and DELETE). Its metadata is restricted in code to reference tokens (versions, enum values, field names, UUIDs, booleans, integers).
> - Foreign keys to `users` are `ON DELETE RESTRICT`; users are soft-deleted (`deleted_at`), never hard-deleted by the app.
> - `users.supabase_user_id` has no database FK to Supabase's `auth.users`, so the same migration also runs on plain Postgres (D-27).
>
> **Implemented in M4** (Alembic revision `0002`, schema `app`, RLS enabled): `mood_checkins`, with exactly the fields below.
> - DB checks: `mood_score BETWEEN 1 AND 5`, `cardinality(tags) <= 10`, `note` NULL or 1–1000 characters.
> - FK to `users` is `ON DELETE RESTRICT`. `submitted_at` is set by the server with `clock_timestamp()`.
> - Index on `(user_id, submitted_at)`.
> - `0002` also renames five M3 CHECK constraints whose names `0001` had doubled (for example `ck_users_ck_users_display_name_length` becomes `ck_users_display_name_length`).
> - **Not yet implemented for `note`:** the column-level "encrypted at rest" posture from ARCHITECTURE §5, and the shorter retention period. See D-33. Managed Postgres disk encryption is not the same guarantee.
>
> Every other table below is still a plan.

**Depends on:** `ARCHITECTURE.md` §5 (Database Overview), `Architecture_V2_Phase_1_Build_Spec`
§7 (Core Data Model) — this document is the field-level detail for V2's entity list, kept
inside the sensitivity-grouping framework the original SME council review established.

**Retention and access rules below are engineering defaults pending legal/clinical
validation** (see `SME_COUNCIL_DECISIONS.md` §6, `OPEN_DECISIONS.md` item 4). Do not treat
them as final.

**Reconciliation note:** this revision replaces the original `program_progress` /
`memory_candidates`+`approved_memory` / single `safety_events` model with V2's more granular
entity list (`programs`/`modules`/`exercises`/`exercise_responses`,
`memory_candidates`/`memories`, `risk_assessments`+`safety_events`+`safety_policies`,
`prompt_versions`+`ai_runs`, `audit_events`, `deletion_requests`/`export_requests`). The
sensitivity categories and access-control philosophy from the original review are unchanged.

---

## 1. Entities

### `users` (profile) — *structured profile data*
| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| supabase_user_id | uuid, unique | references the Supabase Auth identity; the backend never stores or verifies a password itself |
| display_name | string, nullable | |
| goals | jsonb | controlled vocabulary, not free text |
| preferences | jsonb | |
| created_at / updated_at | timestamp | |
| deleted_at | timestamp, nullable | soft-delete flag; hard delete of sensitive children happens via `deletion_requests` workflow, see §4 |

**Sensitive fields:** none directly (email/credential live in Supabase, not this table).
**Access:** self only; admin read access requires a documented support reason, logged to
`audit_events`.

### `consents` — *structured profile data*
| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK → users | |
| version | string | matches a published consent-copy version |
| consent_type | enum(required, optional) | |
| granted | bool | |
| recorded_at | timestamp | |
| withdrawn_at | timestamp, nullable | only valid for `optional` type |

**Retention:** kept indefinitely (compliance record). **Access:** self + audit/compliance role.

### `conversations` / `messages` — *sensitive conversation data*
| Field (`conversations`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| status | enum(active, closed) | |
| created_at / last_message_at | timestamp | |

| Field (`messages`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| conversation_id | uuid, FK | |
| role | enum(user, assistant, system) | |
| content | text, encrypted at rest | |
| risk_assessment_id | uuid, FK → risk_assessments, nullable | the risk decision that gated this message |
| ai_run_id | uuid, FK → ai_runs, nullable | only set on assistant messages |
| created_at | timestamp | |

**Sensitive fields:** `content` — the most sensitive text in the system. **Retention:** short
default (exact duration pending legal/product input), independent of `journal_entries`.
**Access:** self only; no blanket admin read access — any staff access for debugging must be
scoped, time-boxed, and logged to `audit_events`.

### `mood_checkins` — *behavioral events*
| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| mood_score | smallint (1-5) | |
| tags | text[] | controlled vocabulary |
| note | text, nullable | free text — treat as sensitive despite table grouping |
| submitted_at | timestamp | |

**Sensitive fields:** `note`. **Retention:** default indefinite for score/tags; `note`
follows the shorter, conversation-like retention posture pending legal input. **Access:**
self only. Never presented as, or treated as input to, a clinical diagnosis.

### `journal_entries` — *sensitive conversation data*
| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| content | text, encrypted at rest | |
| tags | text[] | |
| created_at / updated_at | timestamp | |
| deleted_at | timestamp, nullable | user-initiated delete should be real, not soft, once any legal-hold requirement is confirmed absent |

**Access:** self only, no admin read path in Phase 1.

### `programs` / `modules` / `exercises` / `exercise_responses` — *wellness content + structured progress*
| Field (`programs`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| title | string | |
| description | text | |
| status | enum(draft, active, retired) | versioned wellness content, not user data |
| created_at / updated_at | timestamp | |

| Field (`modules`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| program_id | uuid, FK | |
| order_index | int | |
| title | string | |

| Field (`exercises`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| module_id | uuid, FK | |
| title | string | |
| instructions | text | |

| Field (`exercise_responses`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| exercise_id | uuid, FK | |
| response | text, nullable | free-text response, if the exercise collects one — treat as sensitive |
| completed_at | timestamp | |

**Note:** `exercise_responses` is deliberately separate from `conversations`/`messages` —
structured progress is not raw chat, per V2 §7. **Access:** `programs`/`modules`/`exercises`
are content (admin-managed, readable by any authenticated user); `exercise_responses` is
self-only user data.

### `knowledge_documents` / `knowledge_chunks` / `knowledge_reviews` — *content governance*
| Field (`knowledge_documents`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| title | string | |
| content | text | |
| source | string | provenance — required, never blank |
| language | string | |
| topic | string | |
| version | string | |
| status | enum(draft, in_review, approved, rejected, retired) | |
| created_at / approved_at | timestamp | |
| expires_at | timestamp, nullable | review/expiry per governance policy, V2 §11 step 24 |

| Field (`knowledge_chunks`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| document_id | uuid, FK | |
| content | text | |
| embedding | vector (pgvector) | |

| Field (`knowledge_reviews`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| document_id | uuid, FK | |
| reviewer_id | uuid, FK → staff users | must differ from the submitting author |
| decision | enum(approved, rejected, needs_changes) | |
| notes | text | |
| reviewed_at | timestamp | |

**Rule:** `retrieve_relevant_knowledge()` only queries chunks whose parent document has
`status = approved`. **Access:** read by `ai` module internally; write/approve restricted to
admin/reviewer roles.

### `memory_candidates` / `memories` — *user-approved memory*
| Field (`memory_candidates`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| source_message_id | uuid, FK → messages, nullable | |
| candidate_summary | text | AI-generated summary proposed for retention, not raw transcript |
| status | enum(pending, approved, rejected) | |
| created_at | timestamp | |

| Field (`memories`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| candidate_id | uuid, FK | |
| summary | text | |
| approved_at | timestamp | |
| approved_by | enum(user) | Phase 1: user-approval only, no silent system approval |

**Rule:** `retrieve_relevant_memory()` reads only from `memories`, never `memory_candidates`.
Sensitive raw conversation is never automatically promoted — every row in `memories` traces
back to an explicit approval action. **Access:** self only; deletion cascades from either
table on user request.

### `risk_assessments` / `safety_events` / `safety_policies` — *safety*
| Field (`risk_assessments`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| message_id | uuid, FK → messages, nullable | null for pre-send assessments |
| risk_level | enum(low, medium, high, unknown) | |
| confidence | float | |
| risk_categories | text[] | |
| generation_allowed | bool | |
| escalation_required | bool | |
| policy_version | string, FK → safety_policies.version | |
| reason | jsonb | metadata suitable for auditing; no raw message content duplicated here |
| created_at | timestamp | |

| Field (`safety_events`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| risk_assessment_id | uuid, FK | |
| action_taken | string | e.g. "escalation_shown", "conservative_fallback_triggered" |
| created_at | timestamp | |

| Field (`safety_policies`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| version | string, unique | |
| config | jsonb | thresholds/behavior — clinical values pending validation, see `OPEN_DECISIONS.md` |
| published_at | timestamp | |

**Retention:** `safety_events` retained longer than general conversation data by default —
pending legal confirmation, not assumed. **Access:** restricted, audited access only.

### `prompt_versions` / `ai_runs` — *AI governance and reproducibility*
| Field (`prompt_versions`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| version | string, unique | immutable once published |
| template | text | |
| created_at | timestamp | |

| Field (`ai_runs`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| message_id | uuid, FK → messages, nullable | |
| provider | string | |
| model | string | |
| prompt_version_id | uuid, FK | |
| safety_policy_version | string | |
| knowledge_versions | text[] | which knowledge document versions were retrieved |
| risk_assessment_id | uuid, FK | |
| validation_result | enum(passed, failed) | |
| latency_ms | int, nullable | |
| token_usage | jsonb, nullable | |
| correlation_id | string | matches request/trace ID |
| created_at | timestamp | |

**Rule:** `ai_runs` tracks enough metadata to reproduce/debug AI behavior without storing
full sensitive prompts/responses in generic logs — the prompt/response text lives only in
`messages`, not duplicated into `ai_runs`. **Access:** internal/admin only.

### `audit_events` — *system/compliance*
| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| actor_user_id | uuid, FK, nullable | null for system-initiated actions |
| action | string | e.g. "consent.recorded", "account.deletion_requested" |
| target_type / target_id | string / uuid | |
| metadata | jsonb | reference IDs only, no sensitive free text |
| created_at | timestamp | |

**Rule:** append-only; no update/delete path in application code. **Access:** admin/
compliance role only.

### `deletion_requests` / `export_requests` — *privacy workflows*
| Field (`deletion_requests`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| status | enum(requested, processing, completed, failed) | |
| requested_at / completed_at | timestamp | |

| Field (`export_requests`) | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK | |
| status | enum(requested, processing, ready, expired) | |
| requested_at / ready_at | timestamp | |
| download_expires_at | timestamp | export artifacts are not retained indefinitely |

**Rule:** `POST /privacy/delete` and `GET /privacy/export` (see `API_CONTRACT.md`) create
these tracked, auditable records rather than performing a single synchronous, unobservable
action — matching V2 §13/§17's privacy-workflow requirement.

### `analytics_events` — *behavioral events, aggregate-oriented*
| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK, nullable | nullable to support anonymized aggregation later |
| event_type | string | controlled vocabulary |
| metadata | jsonb | no free text, no message content |
| created_at | timestamp | |

---

## 2. Relationships Summary

- `users` 1—N `consents`, `mood_checkins`, `journal_entries`, `conversations`,
  `exercise_responses`, `memory_candidates`, `safety_events`, `deletion_requests`,
  `export_requests`, `audit_events` (as actor).
- `conversations` 1—N `messages`. `messages` 1—0/1 `risk_assessments`, 1—0/1 `ai_runs`.
- `memory_candidates` 1—0/1 `memories`.
- `programs` 1—N `modules` 1—N `exercises` 1—N `exercise_responses`.
- `knowledge_documents` 1—N `knowledge_chunks`, 1—N `knowledge_reviews`.
- `safety_policies` 1—N `risk_assessments` (by version). `risk_assessments` 1—0/1
  `safety_events`.
- `prompt_versions` 1—N `ai_runs`.

---

## 3. Access Rules Summary

| Data category | Example tables | Default access |
|---|---|---|
| Structured profile | `users`, `consents` | self; admin with logged reason |
| Wellness content (not user data) | `programs`, `modules`, `exercises`, `knowledge_documents`, `knowledge_chunks` | read: any authenticated user (content) / `ai` pipeline (approved knowledge only); write: admin/reviewer roles |
| Behavioral events | `mood_checkins` (score/tags), `exercise_responses`, `analytics_events` | self; aggregate-only for admin/analytics |
| Sensitive conversation data | `conversations`, `messages`, `journal_entries`, `mood_checkins.note`, `exercise_responses.response` | self only, no blanket admin access |
| User-approved memory | `memories` | self only; used by AI pipeline only after approval |
| Safety/AI governance | `risk_assessments`, `safety_events`, `safety_policies`, `prompt_versions`, `ai_runs` | restricted compliance/admin role, logged access |
| Audit/privacy workflow | `audit_events`, `deletion_requests`, `export_requests` | restricted compliance/admin role |

---

## 4. Retention & Deletion Considerations (draft — pending legal validation)

- `POST /privacy/delete` creates a `deletion_requests` row and triggers cascading deletion
  of: `journal_entries`, `conversations`/`messages`, `memory_candidates`/`memories`,
  `mood_checkins`, `exercise_responses`. `consents` and `audit_events` referencing the user
  are retained (compliance record) but the `users` row itself is anonymized/pseudonymized
  rather than fully removed, pending legal confirmation this is correct for the jurisdiction.
- `safety_events` retention may need to outlive normal account deletion for accountability
  reasons — flagged as an open question, not decided here.
- `GET /privacy/export` creates an `export_requests` row; export artifacts have a defined
  expiry (`download_expires_at`) rather than being retained indefinitely.
- No table in this model stores content intended to *ever* be used for model fine-tuning
  without a separate, explicit, additional consent flow — Phase 1 does not fine-tune, so this
  is currently moot, but the schema should not make it easy to accidentally repurpose
  conversation data that way later.
