# API Contract (Phase 1 / Validation Slice) — Mental Health & Wellness Platform

> **Imported source document (2026-09-29), updated for M2 and M3.** Copied from the pre-repository planning pass. The **Health**, **Identity**, **Profile** and **Consents** sections now match the implementation. Implemented as of M3: `GET /health`, `GET /me`, `GET/PATCH /profile`, `GET /consents/current`, `GET /consents/me` and `POST /consents`. Added in M4: `POST /mood/checkins` and `GET /mood/history`. Added as a **prototype** on branch `m5-chat-slice`: `GET /chat/config` and `POST /chat/messages` (see "Chat prototype"). Every other endpoint below is a planned contract, not working code.
>
> **Validation errors (M3):** `422` with `{"error": {"code": "validation_failed", "message": ..., "fields": [{"field": ..., "message": ...}]}}`. Submitted values are never echoed back. `503 service_unavailable` means the database is not configured or not reachable.

**Depends on:** `ARCHITECTURE.md`, `DATA_MODEL.md`, `Architecture_V2_Phase_1_Build_Spec` §13
(this document's endpoint list and naming now matches V2 §13 exactly — see
`IMPLEMENTATION_STATUS.md` for the reconciliation history from the original draft).

**Conventions:** JSON over HTTPS. Auth via `Authorization: Bearer <supabase_access_token>`
unless noted — the backend verifies the Supabase-issued JWT and derives the authenticated
user's identity from it; **no endpoint accepts or trusts a client-supplied user ID.** All
error responses use `{ "error": { "code": str, "message": str } }`. Full OpenAPI schema is
generated from FastAPI at `/openapi.json` — this document is the human-readable contract it
must match, not a replacement for it.

---

## Health

### GET /health
- **Response 200:** exactly `{ "status": "ok" }`. No environment name, version or other
  configuration is ever returned (OPEN_DECISIONS D-15).
- **Auth:** none
- Liveness only. It does not check the database, Redis or any provider.

---

## Identity

### GET /me  *(implemented in M2, extended in M3)*
- **Response 200:** `{ "user_id": uuid, "supabase_user_id": uuid, "email": str | null, "display_name": str | null, "created_at": datetime }`
  - `user_id` is the app-side profile id (`app.users.id`). `supabase_user_id` is the token's
    `sub`. `email` comes from the verified token and is **not** stored by this service.
  - The first authenticated call creates the profile row (audited as `user.created`).
    Consent is **not** recorded by this.
- **Auth:** required: `Authorization: Bearer <supabase_access_token>`. Identity comes only
  from the verified token. Any user id sent in the query, body or headers is ignored.
- **Token checks:** signature (ES256/RS256 via the project JWKS at
  `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`; HS256 only if the legacy
  `SUPABASE_JWT_SECRET` is configured), `exp`/`nbf` (30 s clock-skew allowance),
  `iss == <SUPABASE_URL>/auth/v1`, `aud == SUPABASE_JWT_AUDIENCE` (default `authenticated`),
  a UUID `sub`, `role == "authenticated"`, and not an anonymous session.
- **Errors** (all use the standard error body, and every 401 carries
  `WWW-Authenticate: Bearer realm="api"`):
  - `401 unauthorized`, message `"Authentication is required."`: no `Authorization` header.
  - `401 unauthorized`, message `"The access token is invalid or has expired."`: malformed
    header or token, bad signature, expired, wrong issuer or audience, missing claims,
    unknown key id, disallowed algorithm. The response deliberately doesn't say which.
  - `503 auth_unavailable`: tokens can't be verified at all (Supabase not configured, or
    the JWKS endpoint unreachable). Fails closed; never treated as authenticated.

---

## Profile

*Implemented in M3. Both endpoints are self-only by construction: the profile is always
the one belonging to the verified token's `sub`, and there is no user id in the path,
query or body.*

### GET /profile
- **Response 200:** `{ user_id, display_name: str | null, goals: [str], preferences: {...}, created_at, updated_at }`
- **Auth:** required (self only). Creates the profile on first use, as `/me` does.
- **Errors:** `401 unauthorized`, `403 account_unavailable` (profile soft-deleted),
  `503 auth_unavailable | service_unavailable`

### PATCH /profile
- **Request:** `{ display_name?: str | null, goals?: [str], preferences?: {...} }`. Omitted
  fields are unchanged. **Unknown fields are rejected (422)**, including `user_id`,
  `supabase_user_id` and `email`.
  - `display_name`: trimmed, 1–50 characters, no control or format characters. `null`
    clears it.
  - `goals`: must come from the controlled vocabulary. **No vocabulary is approved yet
    (OPEN_DECISIONS D-22)**, so only `[]` is accepted.
  - `preferences`: **no keys are defined yet (D-23)**, so only `{}` is accepted.
- **Response 200:** the updated profile. A change is audited as `user.profile_updated`,
  with the changed field **names** only.
- **Auth:** required (self only)
- **Errors:** `401`, `403 account_unavailable`, `422 validation_failed`, `503`

---

## Consents

*Implemented in M3.* Consent is only ever an explicit user decision; creating an account
records nothing. A decision applies to exactly one published version.

### GET /consents/current
- **Response 200:** `{ version: str, consent_type: "required", published_at: datetime, summary_url: str, pending_legal_review: bool }`
- **Auth:** none (contains no user data)
- The current version is `2026-09-29.draft-1`, a **placeholder** with
  `pending_legal_review: true`. No legal text exists yet (D-11, D-24).

### GET /consents/me  *(added in M3)*
- **Response 200:** `{ current_version: str, status: "missing" | "granted" | "declined" | "outdated", recorded_version: str | null, recorded_at: datetime | null }`
  - `missing`: no decision recorded.
  - `granted` / `declined`: the latest decision is for the current version.
  - `outdated`: the latest decision is for an older version. It is **never** carried over to
    the current version; the user must accept the new version explicitly.
- **Auth:** required (self only)
- This was added because the frontend needs the caller's own status to gate the app. The
  imported contract listed no read endpoint (see the note it carried about M3).

### POST /consents
- **Request:** `{ version: str, granted: bool, consent_type: "required" | "optional" }`.
  `granted` must be a real JSON boolean ("yes" or 1 are rejected). Unknown fields are
  rejected.
- **Response 201:** `{ consent_id: uuid, version: str, granted: bool, recorded_at: datetime }`.
  A new append-only record, audited as `consent.recorded` (metadata: version, type, granted).
- **Response 200:** same body, returned when the submission repeats the caller's latest
  decision for that version. Nothing new is stored or audited (idempotent). Concurrent
  duplicates are serialised per user.
- **Auth:** required
- **Errors:** `401 unauthorized`; `422 unknown_version` (never published, or an `optional`
  consent, since none is published yet: D-25); `422 consent_version_not_current` (a
  superseded version); `422 validation_failed`; `503`.
- Withdrawal applies only to `optional` consents, of which none exist yet, so there is no
  withdrawal endpoint in M3 (D-25). Declining the required consent is recorded as
  `granted: false`.

### Consent gate (server-side)
- Endpoints that need consent depend on `app.consent.dependencies.ConsentedUser`, which
  returns **`403 consent_required`** unless the caller's latest required decision is
  `granted` for the **current** version. M3 has no such feature endpoints yet; the gate is
  covered by tests, and the frontend applies the same rule before showing the dashboard.

---

## Chat prototype (M5 slice)  *(implemented on `m5-chat-slice`; prototype only)*

Both endpoints require authentication and the current consent (`401`, `403 consent_required`).
The feature is off unless `CHAT_ENABLED=true` with an allowed `CHAT_SAFETY_POLICY`. Only the
fake provider exists. These endpoints replace nothing below: the planned `/conversations`
contract (with server-side storage) remains planned.

### GET /chat/config
- **Response 200:** `{ "enabled": bool, "age_band": "adult", "age_band_label": str, "test_only_policy": bool, "prototype": true }`.
  `enabled` is `false` when chat is not configured. Only the adult band can be enabled.

### POST /chat/messages
- **Request:** `{ "message": str (1–2000, not blank), "history": [ { "role": "user" | "assistant", "text": str (1–2000), "signature": str? } ] (≤ 6) }`. Unknown fields are rejected.
  Assistant turns must carry the `signature` returned with that reply.
- **Response 200:** `{ "status": "reply" | "support" | "out_of_scope" | "no_evidence" | "unable_to_answer" | "unavailable", "reply": { "text": str, "signature": str, "citations": [ { "chunk_id": uuid, "source_title": str, "publisher": str, "source_ref": str, "version_label": str, "synthetic": bool } ] } | null, "notice": str | null, "prototype": true }`.
  `reply` is present only for `status = "reply"`. Every other status carries a fixed `notice`
  and means **no provider call was made, or its output was discarded**. The `support` notice
  is a placeholder pending D-13.
- **Errors:** `403 age_band_unavailable`; `422 validation_failed`; `422 invalid_history`
  (a forged, altered or other-user signature); `429 rate_limited`; `503 chat_unavailable`
  (feature off). A limiter, assessor, retrieval or provider failure returns `200` with
  `status = "unavailable"` (fail closed).
- **Privacy:** message and reply text are not stored, logged, or written to audit or
  safety events. `safety_events` holds decision metadata only.

## Conversations (AI Companion)

### POST /conversations
- **Response 201:** `{ conversation_id: uuid, created_at: datetime }`
- **Auth:** required (self only)

### GET /conversations
- **Response 200:** `{ conversations: [{ conversation_id, status, created_at, last_message_at }] }`
- **Auth:** required (self only)

### GET /conversations/{id}
- **Response 200:** `{ conversation_id, messages: [{ message_id, role, content, risk_level, created_at }] }`
- **Auth:** required (self + owner only)
- **Errors:** `403 not_owner`, `404 not_found`

### POST /conversations/{id}/messages
- **Request:** `{ content: str }`
- **Response 201:** `{ message_id: uuid, response: { content: str, risk_level: "low"|"medium"|"high"|"unknown", recommended_next_action?: str }, created_at: datetime }`
- **Auth:** required (self + owner only)
- **Behavior:** runs the full safety-gated AI pipeline (`ARCHITECTURE.md` §3–§4) —
  deterministic rules → safety classifier → policy engine → generation gate → (if allowed)
  knowledge/context retrieval → LLM generation → output validator → response. A HIGH risk
  result, an UNKNOWN result the policy engine treats conservatively, or a safety-dependency
  failure all return a fixed escalation response and **do not** include LLM-generated
  content.
- **Errors:** `403 not_owner`, `422 empty_message`, `429 rate_limited`, `503 ai_unavailable`
  (falls back to a safe static response, never a raw error to a distressed user)

---

## Mood

*Implemented in M4.* Both endpoints are self-only by construction: the owner is always
the verified token's user, and there is no user id in the path, query or body. Both
require the **current consent** (`403 consent_required` otherwise).

### POST /mood/checkins
- **Request:** `{ mood_score: int (1-5), tags?: [str], note?: str }`, exactly as documented.
  - `mood_score`: a JSON integer from 1 to 5. Strings, floats, booleans and null are
    rejected (422), never coerced.
  - `tags`: must come from the controlled vocabulary. **No vocabulary is approved yet
    (OPEN_DECISIONS D-30)**, so only `[]` (or omitting the field) is accepted.
  - `note`: **temporarily not accepted** (OPEN_DECISIONS D-32). Omitting `note` or sending
    `null` is valid. **Any string**, including empty, whitespace-only or oversized, is
    rejected with `422 validation_failed` on field `note` ("Notes aren't accepted yet.
    Leave the note out."). Rejection happens during request validation, before any
    write. The submitted text is never echoed, logged, audited or stored. This is a
    deliberate, temporary deviation from the documented `note?: str` until D-32 is
    decided. The column and its DB check (NULL or 1–1000 characters) stay in place for
    that future decision; encryption and retention (D-33) are **not** implemented.
  - Unknown fields (`user_id`, `submitted_at`, …) are rejected (422). `submitted_at` is
    always set by the server.
- **Response 201:** `{ checkin_id: uuid, submitted_at: datetime }`
- **Auth:** required (self only) and current consent
- **Errors:** `401 unauthorized`, `403 consent_required`, `422 validation_failed`, `503`
- **Audit:** `mood.checkin_recorded` with the target id only. The score, tags and note are
  never copied into the audit log.
- **Note:** response bodies never include diagnostic or clinical language. Enforced by test.

### GET /mood/history?from=&to=&limit=
- **Response 200:** `{ checkins: [{ checkin_id, mood_score, tags, note, submitted_at }] }`,
  newest first, and only the caller's own check-ins. While notes are disabled (D-32),
  `note` is always `null`.
- **Query:**
  - `from` (inclusive) and `to` (exclusive): ISO-8601 datetimes **with a timezone**;
    naive or date-only values are rejected. `from` must be earlier than `to`
    (`422 invalid_range`).
  - `limit`: *added in M4*, 1–100, default 30. The contract defined no bound or pagination,
    and an unbounded history response is unsafe.
  - Unknown query parameters (for example `user_id`) are rejected (422).
- **Auth:** required (self only) and current consent
- **Errors:** `401`, `403 consent_required`, `422 validation_failed | invalid_range`, `503`
- The plan's "recent summary" for the mood module has no contract entry. It was not built,
  to avoid adding endpoints the architecture doesn't specify.

---

## Wellness Programs

*(Owned by the `wellness` module — see `ARCHITECTURE.md` §2. No separate `programs/`
backend module.)*

### GET /programs
- **Response 200:** `{ programs: [{ program_id, title, description, module_count }] }`
- **Auth:** required

### POST /programs/{id}/start
- **Response 201:** `{ progress_id: uuid, current_module: str }`
- **Auth:** required (self only)

### GET /programs/{id}/progress
- **Response 200:** `{ progress_id, current_module, completed_modules: [str], started_at }`
- **Auth:** required (self + owner only)

### POST /exercises/{id}/complete
- **Request:** `{ response?: str }`
- **Response 200:** `{ status: "completed", recorded_at: datetime }`
- **Auth:** required (self only)

---

## Journal

### POST /journal
- **Request:** `{ content: str, tags?: [str] }`
- **Response 201:** `{ entry_id: uuid, created_at: datetime }`
- **Auth:** required (self only)

### GET /journal
- **Response 200:** `{ entries: [{ entry_id, content, tags, created_at, updated_at }] }`
- **Auth:** required (self only)

### DELETE /journal/{id}
- **Response 204**
- **Auth:** required (self + owner only)
- **Errors:** `403 not_owner`, `404 not_found`

*(An update/`PATCH` endpoint isn't in V2 §13's initial list — deferred until Milestone
9/10 planning confirms it's needed for the validation slice.)*

---

## Privacy

### GET /privacy/export
- **Response 202:** `{ export_request_id: uuid, status: "requested" }`
- **Auth:** required (self only)
- **Behavior:** creates an `export_requests` row (`DATA_MODEL.md`); the export itself is
  produced asynchronously, not returned synchronously in this response.

### POST /privacy/delete
- **Request:** `{ confirmation: "DELETE" }`
- **Response 202:** `{ deletion_request_id: uuid, status: "requested" }`
- **Auth:** required (self only)
- **Behavior:** creates a `deletion_requests` row and triggers the cascading deletion
  workflow in `DATA_MODEL.md` §4. Async, tracked, auditable — not a single unobservable
  synchronous call.
- **Errors:** `401 unauthorized`, `422 confirmation_mismatch`

---

## Internal-Facing (no public write endpoints in Phase 1)

- **Safety** (`assess_safety_risk`, `apply_safety_policy`, `create_safety_event`) — internal
  only, to avoid exposing classifier internals that could be gamed. `GET
  /safety/policy-version` may be added as a transparency endpoint once Milestone 5 lands;
  not required for Milestone 1.
- **Knowledge** (`search_knowledge`, `retrieve_relevant_knowledge`) — internal calls from the
  `ai` pipeline. Document authoring/review endpoints are admin-facing and will be specified
  in Milestone 8 planning, not fixed here speculatively.
- **Memory** (`create_memory_candidate`, `approve_memory`) — internal service functions
  called by the AI pipeline and a review step; whether these need a direct user-facing
  endpoint (e.g. to list/delete approved memories) is a Milestone 5/7 question, not decided
  here.

---

## Cross-Cutting

- All `self only` / `self + owner only` endpoints authorize by comparing the authenticated
  user's ID (from the verified Supabase JWT) to the resource owner — never trust a
  client-supplied user ID, per `ARCHITECTURE.md` §10 guardrail #7.
- Rate limiting applies at minimum to `/conversations/{id}/messages`; whether it's needed on
  any other endpoint in Phase 1 is decided when Redis is actually introduced (see
  `IMPLEMENTATION_STATUS.md`), not assumed now.
- No endpoint returns raw LLM output without having passed the output validator first — this
  is a contract-level guarantee, not just an internal implementation detail.
