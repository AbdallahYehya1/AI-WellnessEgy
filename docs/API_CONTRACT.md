# API Contract (Phase 1 / Validation Slice) — Mental Health & Wellness Platform

> **Imported source document (2026-09-29), updated for M2.** Copied from the pre-repository planning pass. The **Health** and **Identity** sections were updated in M2 to match the implementation. As of M2, only `GET /health` and `GET /me` are implemented; every other endpoint below is a planned contract, not working code.

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

### GET /me  *(implemented in M2)*
- **Response 200:** `{ "user_id": uuid, "email": str | null }`
  - `user_id` is the Supabase Auth user id (the token's `sub`). M2 has no application
    `users` table, so profile fields (`display_name`, `created_at`, …) arrive with the
    profile milestone.
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

### GET /profile
- **Response 200:** `{ user_id, display_name, goals: [str], preferences: {...}, created_at }`
- **Auth:** required (self only)

### PATCH /profile
- **Request:** `{ display_name?: str, goals?: [str], preferences?: {...} }`
- **Response 200:** updated profile
- **Auth:** required (self only)

---

## Consents

### GET /consents/current
- **Response 200:** `{ version: str, published_at: datetime, summary_url: str }`
- **Auth:** none

### POST /consents
- **Request:** `{ version: str, granted: bool, consent_type: "required" | "optional" }`
- **Response 201:** `{ consent_id: uuid, recorded_at: datetime }`
- **Auth:** required
- **Errors:** `401 unauthorized`, `422 unknown_version`

*(Listing a user's own consent history and withdrawing an optional consent are needed before
Milestone 3 ships but aren't in V2 §13's initial endpoint list — flagged for confirmation
during Milestone 3 planning rather than added here speculatively.)*

---

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

### POST /mood/checkins
- **Request:** `{ mood_score: int (1-5), tags?: [str], note?: str }`
- **Response 201:** `{ checkin_id: uuid, submitted_at: datetime }`
- **Auth:** required (self only)
- **Note:** response body never includes diagnostic or clinical language — enforced by test.

### GET /mood/history?from=&to=
- **Response 200:** `{ checkins: [{ checkin_id, mood_score, tags, note, submitted_at }] }`
- **Auth:** required (self only)

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
