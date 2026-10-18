# Open Decisions

Last updated: 2026-10-18 (M8 controlled deployment; D-44 and D-45).

Engineering does not make the decisions below. Some are clinical, legal or
crisis-procedure calls, and some belong to the founder. Until each one is
decided, code may only add interfaces, configuration slots, tests and
clearly marked, non-final placeholders. **No Egyptian emergency numbers,
clinical thresholds or crisis procedures may be invented.**

Status values: **OPEN** (needs a decision), **RESOLVED** (decided; kept for the record).

---

## A. Source documents and scope

### D-0. Source of truth while the V2 spec is missing — RESOLVED (2026-09-29, founder)
- `Architecture_V2_Phase_1_Build_Spec.docx` is still missing.
- **Decision:** until it is recovered, the imported Markdown planning documents in `docs/`
  are the implementation source of truth.
- If the `.docx` turns up, compare it with `docs/` before the next milestone.

### D-1. Redis, Celery and Compose services in the imported docs — RESOLVED
- The approved architecture governs: Redis only when there is a real need, no workers,
  Supabase PostgreSQL, and a minimal Compose file. Each affected document has a note at
  the top.

### D-2. Scope of M2 — RESOLVED (2026-09-29, founder)
- **Decision:** M2 covers Supabase authentication only. Profiles, consent, application
  database models, migrations, and audit and domain features belong to later milestones.
- **M3 scope (founder, 2026-09-29):** consent and user-profile foundation only: profile,
  consent versioning, audit and onboarding. No AI, RAG, memory, crisis logic or other
  wellness features.
- **M4 scope (founder, 2026-10-02):** mood check-in and the wellness-data foundation only.
  No AI companion, LLM calls, RAG, embeddings, memory, risk classification, crisis logic,
  diagnosis or treatment recommendations.

---

## B. Founder / business

### D-3. Supabase auth methods — RESOLVED (2026-09-29, founder)
- **Decision:** email/password with **required email confirmation**. Magic links, OAuth,
  phone authentication and MFA are deferred.
- **Implementation note:** the app assumes confirmation is switched on in the Supabase
  project. If sign-up ever returns a live session (confirmation off), the server logs a
  warning. See D-17 for the dashboard settings to check.

### D-4. Local database strategy — OPEN (engineering default in place since M3)
- **Default used in M3 (reversible):** plain **Postgres 17** (the version new Supabase
  projects run). It is used as a Compose `db` service for local development, as a
  throwaway testcontainer for `pytest`, and as a service container in CI. The migrations
  are written to run unchanged on both plain Postgres and Supabase.
- **Still to decide:** whether to switch local development to the Supabase CLI stack
  (which adds `auth.users`, the `anon`/`authenticated` roles and the Data API), or to use
  a hosted dev project.

### D-5. Hosting, region, environments and secret store — OPEN
- No cloud provider, hosting region or production secret store has been chosen. The
  region choice depends on D-9 (data residency). The code assumes no provider.

### D-6. Product name and branding — OPEN
- "AI Wellness Egypt" is a working name, used in the UI, the API title and the package
  names.

### D-17. Supabase project settings must be confirmed — OPEN (founder action, blocks live verification)
Engineering can't see or change the dashboard. These must be checked before live testing:
1. **Authentication → Providers → Email:** enabled, with **Confirm email** on (D-3).
2. **Authentication → URL Configuration:** Site URL `http://localhost:3000` and redirect
   URL `http://localhost:3000/**` (stated as configured).
3. **JWT signing keys:** asymmetric (ES256/RS256) keys are recommended. The backend then
   needs only `SUPABASE_URL`. If the project still uses the legacy shared secret, the
   backend also needs `SUPABASE_JWT_SECRET`.
4. **Email sending:** Supabase's built-in email service is meant for testing and is
   heavily rate-limited. A custom SMTP provider is needed before any pilot.
5. **Password policy:** the project uses Supabase's defaults (founder, 2026-09-29): at least
   6 characters and no character rules. The app requires at least 8, which is stricter, so
   every password the app accepts is also accepted by Supabase. If the project policy is
   tightened later, the app shows a friendly "choose a stronger password" message.

Checked on 2026-09-29 through the project's public `/auth/v1/settings` and JWKS endpoints:
email provider on, sign-ups open, **email confirmation required** (`mailer_autoconfirm:
false`), anonymous users off, and tokens signed with an **asymmetric ES256 key**, so no
legacy JWT secret is needed. Still to confirm in the dashboard: redirect URLs (item 2)
and custom email sending before a pilot (item 4). The legacy JWT secret was shared in a
chat session and should be rotated.

### D-18. Confirmation email template — OPEN (founder choice, non-blocking)
- **Default template (works now):** the link goes through Supabase, then to
  `/auth/confirm?code=…` (PKCE). It must be opened **in the same browser** that signed up.
  Otherwise the address is still confirmed, but the user has to sign in manually; the app
  explains this.
- **Optional:** change the "Confirm signup" template to link to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`. That works in any
  browser. The route already supports it.

---

## C. Clinical judgment required

### D-7. Clinical governance — OPEN
1. Which licensed mental-health professional reviews and approves psychoeducation content
   and the AI's allowed and prohibited behaviour before real users see it?
2. What clinical risk taxonomy and LOW / MEDIUM / HIGH / UNKNOWN thresholds should the
   safety layer use? Until decided, only conservative placeholders labelled as pending
   clinical validation may ship.
3. Who reviews AI tone, the Egyptian Arabic and Arabizi evaluation cases, the knowledge
   content, **and the Arabic UI copy**? Ideally a native Egyptian Arabic speaker with
   mental-health content experience.
4. What does the product do to prevent unhealthy dependence on the AI, and who approves it?

### D-19. Auth UI language — OPEN
- In M2 the auth screens have Arabic page titles, with English form labels, messages and
  errors. That kept the copy accurate without an unreviewed Arabic translation.
- **Needed:** an i18n approach, and reviewed Egyptian Arabic copy for all auth screens and
  error messages (see D-7.3).

---

## D. Legal interpretation required

### D-8. Regulatory status in Egypt — OPEN
- What legal and regulatory requirements apply to a non-clinical digital mental-wellness
  product in Egypt? This covers health-data rules, consumer protection, and whether
  Egypt's Personal Data Protection Law (Law No. 151 of 2020) applies and how. Counsel must
  answer this. Engineering has not interpreted it.

### D-9. Data residency — OPEN
- Can sensitive wellness data be stored or processed outside Egypt? This affects the
  Supabase project region (already created; its region should be checked against this
  answer) and the choice of LLM provider.

### D-10. Retention periods — OPEN
- What are the retention periods for messages, journal entries, mood notes, safety events
  and audit logs? Retention must be configurable rather than hard-coded.
- M3 status: `consents` and `audit_events` are kept indefinitely, as `DATA_MODEL.md`
  specifies for compliance records. No deletion or retention jobs exist yet; they belong
  with the privacy workflows (`deletion_requests`), which are not in M3's scope.

### D-11. Accountability, terms and disclaimers — OPEN
- Who is legally and clinically accountable if the safety layer misses a genuine crisis?
- Terms of service, privacy policy and the "not a replacement for professional care"
  wording need counsel's review. **The disclaimers on the landing and sign-up pages are
  placeholder copy.**
- Since M3, onboarding collects an explicit decision on consent version
  `2026-09-29.draft-1`. That version's text is a **clearly marked placeholder**; see D-24.

### D-12. Minimum age — RESOLVED (2026-09-29, founder); wording OPEN for legal review
- **Decision:** adults aged 18+ only. There is no support for minors.
- **Implementation:** sign-up requires an "I confirm that I am 18 or older" checkbox,
  checked on the server before the Supabase call. The attestation is **still not stored**
  in M3: the `DATA_MODEL.md` `users` and `consents` entities have no field for it, and
  M3 was told not to invent fields. The consent placeholder text states that the service
  is for adults (18+).
- **Still open for counsel:** is self-attestation enough, what exact wording to use, and
  must the attestation be recorded (and with what timestamp or version)?

---

## E. Crisis procedures required

### D-13. High-risk escalation content — OPEN (blocks any real-user AI access)
- Which emergency services, crisis lines or resources should an Egyptian user in crisis
  see? What are the exact contact details, which languages are offered, and when are they
  available?
- Does the business have a referral relationship with qualified professionals, and what is
  the path to scheduling?
- Until this is decided, the escalation flow must use a loud, non-final placeholder. It
  must never contain invented numbers or procedures.
- **Deadline:** before any user outside the team can reach the AI companion.

---

## F. Engineering notes

### D-14. ESLint 9 kept despite its deprecation notice — OPEN (revisit)
- `eslint-plugin-react`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` (pulled in by
  `eslint-config-next`) still only support up to ESLint 9. Upgrade once they support 10.

### D-15. `/health` response — RESOLVED (2026-09-29, founder)
- **Decision:** `GET /health` returns exactly `{"status":"ok"}` and never exposes the
  environment name. This is implemented, and tests enforce it for every environment.

### D-16. SQLAlchemy and Alembic not yet installed — RESOLVED (deferred)
- They are added in the database milestone, together with the first models and
  migrations.

### D-20. Auth cookies are readable by JavaScript — OPEN (accepted for M2, revisit)
- `@supabase/ssr` stores the session in `sb-<ref>-auth-token` cookies with
  `SameSite=Lax`, **not** `HttpOnly`, because its browser client needs to read them. This
  was observed in the E2E run. The M2 app doesn't use the browser client (all auth runs
  in Server Actions and the proxy). Whether the cookies could safely be made `HttpOnly`
  with `@supabase/ssr` has **not been evaluated**.
- **Mitigation now:** no third-party scripts, React's escaping, and a strict review for any
  `dangerouslySetInnerHTML`.
- **Revisit:** add a Content-Security-Policy before any pilot.

### D-21. No rate limiting in the app — OPEN
- Sign-in and sign-up attempts are rate-limited by Supabase itself, and the UI explains
  429s. The backend has no rate limiting of its own. A failed JWKS lookup for an unknown
  key id refetches at most once per 30 s (PyJWT cooldown). Revisit when Redis is
  introduced (D-1), or at the latest before a pilot.

---

## G. Raised in M3 (consent and profile)

### D-22. Goals vocabulary — OPEN (product + clinical)
- `DATA_MODEL.md` says `users.goals` is a "controlled vocabulary, not free text", but no
  vocabulary is defined anywhere. Wellness goal wording has a clinical dimension, so none
  was invented.
- **Implemented:** the vocabulary is an empty, code-reviewed allowlist
  (`backend/app/users/schemas.py`), so the API accepts only `goals: []`. The onboarding UI
  has no goals step. Adding approved goals needs a code change only, not a migration.

### D-23. Profile preference keys — OPEN (product)
- `users.preferences` is defined as JSON with no keys. None were invented (for example,
  UI language).
- **Implemented:** a strict schema with no fields, so only `{}` is accepted.

### D-24. Consent text and versioning process — OPEN (legal; blocks public launch)
- The required consent version `2026-09-29.draft-1` is a **placeholder**. The consent
  page shows a prominent "DRAFT, NOT FINAL … pending legal review" notice, the API returns
  `pending_legal_review: true`, and the only substantive text repeats existing product
  facts: wellness support for adults, not medical, no diagnosis or medication, not a
  replacement for professional or emergency care.
- **Needed from counsel:** the actual terms and privacy wording (Arabic and English), and
  whether the full text should be versioned in the repo or hosted elsewhere
  (`summary_url` currently points at the in-app consent page).
- **Publishing real text:** add a new `ConsentDocument` in
  `backend/app/consent/catalog.py` and make it current. Every user's status then becomes
  `outdated`, and they must accept again. Nothing is migrated automatically; tests prove
  this.

### D-25. Optional consents and withdrawal — OPEN (product + legal)
- The model supports `optional` consents and `withdrawn_at`, but no optional consent is
  defined. The API therefore rejects `consent_type: optional` (`unknown_version`), and there
  is no withdrawal endpoint.
- Withdrawing the **required** consent is not modelled (`withdrawn_at` is optional-only by
  DB constraint). A user can record a decline, which blocks the app again. Whether leaving
  should instead mean account deletion is part of D-10/D-11.

### D-26. Applying the migrations to the real Supabase project — OPEN (founder action)
- The migrations have **not** been run against the Supabase project, because no database
  connection string was provided (the only credentials given were the URL and publishable
  key).
- **Needed:** a `DATABASE_URL` for the project. It is server-only: keep it in
  `backend/.env` (git-ignored) or a secret store, and never put it in the frontend or in
  source control. Use the direct connection or the **session pooler**; the app disables
  prepared statements, so the transaction pooler also works.
- **Procedure:** see [SUPABASE_MIGRATION_RUNBOOK.md](SUPABASE_MIGRATION_RUNBOOK.md), not yet
  executed. Since M4 the head revision is **`0002`**; a correct run ends at
  `0002 (head)`. The runbook covers target verification, backup, apply, read-only
  verification queries and recovery. Do not run it against an unidentified database.
- The API reads the same `DATABASE_URL`. Without it, the profile, consent and mood
  endpoints answer 503.
- **Security design (verified on plain Postgres with simulated Supabase roles):**
  - the tables live in schema `app`, which the Supabase Data API does not expose by
    default;
  - RLS is enabled with no policies;
  - all privileges are revoked from `anon` and `authenticated`;
  - the backend connects as the table owner.
  After the first real run, confirm in the dashboard that `app` is **not** listed under
  API → Exposed schemas.

### D-27. Link between profiles and Supabase `auth.users` — OPEN (engineering + legal)
- `app.users.supabase_user_id` has no database foreign key to `auth.users`, so the same
  migration runs on plain Postgres. If a user is deleted in Supabase, their app profile,
  consents and audit rows remain. The intended behaviour belongs to the deletion
  workflow (D-10, `deletion_requests`).

### D-29. Branch and CI workflow — RESOLVED (2026-09-29)
- `main` was established (linear history M1 → M2 → M2 evidence → M3) and made the GitHub
  default branch. The milestone branches are retained.
- CI runs on pushes to `main` and on pull requests. The first run (`78de377`) passed 4/4
  jobs.
- **Recommended practice:** feature branch → pull request → CI → merge. Branch protection
  on `main` (required checks) is a founder setting that has not been enabled yet.

### D-28. Access to audit and consent records by staff — OPEN
- `DATA_MODEL.md` restricts `audit_events` to an admin/compliance role and allows admin
  profile reads only with a logged reason. M3 builds no admin access at all. Audit rows are
  readable only by direct database access. Roles and tooling are future work.

---

## H. Raised in M4 (mood check-in)

### D-30. Mood tag vocabulary — OPEN (product + clinical; blocks the tags feature only)
- **Question:** which tags (if any) may users attach to a mood check-in?
- **Why it matters:** `DATA_MODEL.md` defines `mood_checkins.tags` as a "controlled
  vocabulary", but none is defined. Mood labels such as "anxious" or "hopeless" carry
  clinical meaning and could read as symptom checklists.
- **Options:** (a) no tags for the validation slice; (b) a small, neutral, clinically
  reviewed list; (c) activity or context tags such as "work" or "sleep" instead of feeling
  words.
- **Current implementation:** an empty allowlist (`backend/app/mood/schemas.py`); the API
  accepts only `tags: []`, and the UI has no tag picker. Adding tags needs a code change
  only, not a migration.
- **Blocks:** neither development nor launch, only the tags feature itself.

### D-31. Mood check-in copy and scale anchors — OPEN (product + native-language review; blocks launch copy)
- **Question:** what wording should the check-in use, in Arabic and English, including
  what "1" and "5" mean?
- **Why it matters:** the scale (1–5) is defined, but its anchors aren't. Anchor wording
  shapes how users interpret the score, and the project must avoid language that sounds
  like a clinical assessment.
- **Current implementation, all marked provisional in code:**
  - the question "How are you feeling right now?";
  - the anchors "1 = very low · 5 = very good";
  - an Arabic page title in Egyptian Arabic;
  - the line "not a medical assessment and is not used to diagnose anything".
- **Options:** keep the numeric scale with neutral anchors (current), or add emoji or
  colour cues (an accessibility and cultural review is needed).
- **Blocks:** launch copy only (see also D-19, D-7.3).

### D-32. Collecting free-text mood notes before the safety layer exists — OPEN (clinical + legal; blocks the note UI)
- **Question:** may the product collect free-text notes before there is a safety
  assessment and an approved crisis pathway (D-13)?
- **Why it matters:** a note can contain disclosures of distress or risk. In M4 nothing
  reads or responds to notes. Collecting them can imply that someone is listening, and
  creates stored sensitive data with no safety handling.
- **Options:**
  - (a) keep the note out of the UI until D-13 and the safety milestone (**current**);
  - (b) show the note with an explicit "not monitored" notice, approved by clinical and
    legal reviewers;
  - (c) route notes through the future safety assessment before storage or display.
- **Current implementation:** the API supports `note` exactly as the contract documents,
  validated and stored verbatim, never logged or audited. **The frontend does not offer a
  note field.**
- **M4 review finding (2026-10-02, Medium):** option (a) was enforced **only in the UI**;
  the API still accepted and stored notes from direct clients.
- **Temporary policy now enforced server-side (founder instruction, 2026-10-02):**
  `POST /mood/checkins` rejects **any** `note` string (empty, whitespace-only, ordinary
  text or oversized) with `422 validation_failed` on field `note`, during request
  validation and before any database write. An omitted or `null` note is still accepted.
  The text is never echoed, logged, audited or stored, and the UI still has no note
  field. It's implemented as a hard rule in code (`app/mood/schemas.py`), not a config
  flag, so it can't be switched on by accident. Re-enabling notes requires a reviewed
  code change after this decision.
- **This does not resolve D-32.** The question itself, and options (b) and (c), remain
  open for clinical and legal review. **D-33 (encryption and retention) is also
  unresolved** and still blocks launch.
- **Blocks:** exposing notes in the UI, and therefore launch of that feature. It does not
  block other development.

### D-33. Encryption at rest and retention for `mood_checkins.note` — OPEN (security + legal; blocks launch)
- **Question:** how is "encrypted at rest" (ARCHITECTURE §5) satisfied for sensitive free
  text, and what is the note's retention period?
- **Why it matters:**
  - Managed Postgres disk encryption protects against stolen disks, but not against anyone
    with database access. The architecture groups notes with conversation data.
  - Retention for notes is meant to be shorter than for scores (D-10).
- **Options:**
  - (a) rely on Supabase's at-rest disk encryption and document it;
  - (b) application-level column encryption, which needs a key-management decision (KMS,
    rotation, impact on search);
  - (c) Postgres `pgcrypto` with server-held keys.
  - Retention: a scheduled purge of `note` after N days, with N set by counsel.
- **Current implementation:** plain `text` column, length-limited, RLS on, Data API roles
  revoked. No encryption beyond the platform's, and no purge job. The 1000-character limit
  is an engineering bound to revisit together with this decision.
- **Blocks:** launch (any real user data). Development can continue.

### D-34. Constraint naming defect from M3 — RESOLVED (M4)
- `0001` created CHECK constraints with doubled names (for example
  `ck_users_ck_users_display_name_length`), because the naming convention was applied on
  top of explicit names. Behaviour was unaffected.
- **Fixed forward in `0002`:** the five constraints are renamed, new constraints use
  `op.f()`, and a regression test pins every constraint name. `0001` was not edited, since
  it may already be applied somewhere.

---

## I. M5 entry gate (safety engine): prerequisites before any implementation

Recorded 2026-10-02. **M5 has not started.** Every item below stays **PENDING** until the
evidence listed exists. Nothing here records an approval that hasn't happened.

**Qualified reviewers needed (none named or engaged yet):**
- a licensed mental-health professional with experience in Egypt (clinical owner);
- an Egyptian lawyer for health data and consumer protection (legal owner);
- a native Egyptian Arabic reviewer with mental-health content experience (language
  owner);
- a security reviewer (security owner);
- the founder (product owner and accountable sign-off).

### Gate items

| ID | Prerequisite | Owner | Status | Measurable acceptance criteria (all must hold) |
|---|---|---|---|---|
| G-1 | **D-7 clinical risk framework** | Clinical owner + founder | PENDING | (1) A written risk taxonomy and LOW / MEDIUM / HIGH / UNKNOWN definitions, with signed, dated approval by the named clinical owner, stored in `docs/`. (2) An approved labelled evaluation set, including Egyptian Arabic, Arabizi and mixed-language cases, with an agreed minimum sensitivity target for HIGH (the number is set by the clinical owner, not by engineering). (3) The policy is versioned (`policy_version`) and its changes require re-approval. |
| G-2 | **D-13 crisis content and resources** | Clinical + legal owners | PENDING | (1) Every resource (service name, contact method, hours, languages) is verified as current by a named reviewer on a recorded date. Engineering supplies **no** numbers. (2) Escalation copy is approved in Arabic and English. (3) A re-verification schedule is set (for example, quarterly) with a named owner. (4) Until approved, the escalation UI shows a loud non-final placeholder, and no real user can reach AI features. |
| G-3 | **Safety-pipeline invariants** (architectural, engineering-owned) | Security owner | DESIGN APPROVED by the founder (2026-10-11); **prototype implemented and tested** on `m5-chat-slice` (IMPLEMENTATION_STATUS §M5-P); security-owner review PENDING | (1) The only message path is: authentication → authorisation → consent → safety assessment → safety decision → context → generation → output validation → response. (2) The generation entrypoint's signature requires a safety-decision object, so it can't be called without one. A test proves it. (3) HIGH never reaches the LLM; tests use a provider mock that fails if called. (4) UNKNOWN is treated at least as MEDIUM; there is a test. (5) A classifier or policy **failure, timeout or exception blocks generation** and routes to escalation, **never** to unrestricted generation; there are fault-injection tests for each dependency. (6) A mutation test shows that removing the gate fails the suite. |
| G-4 | **D-20 Content Security Policy** | Security owner | PENDING | (1) A CSP is sent on every page, with no `unsafe-inline` for scripts, using nonces or hashes as Next.js supports. (2) `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`. (3) `connect-src` is limited to the app, the API and the Supabase project origin. (4) An automated test asserts the header, and a browser run shows zero CSP violations on every route. (5) A decision is recorded on whether auth cookies can be `HttpOnly` with `@supabase/ssr`. |
| G-5 | **D-21 rate limiting** | Security owner + founder | PARTIAL: prototype per-user PostgreSQL limiter that fails closed (D-38); limit values, per-IP limits and load tests PENDING | (1) Per-user and per-IP limits on message sending (and on `POST /mood/checkins`), with values agreed by the founder. (2) A 429 response with the standard error body, and the UI explains it. (3) Limiter-store failure behaviour is decided and tested. For message generation it must **fail closed**: no generation without the limiter. (4) Load test evidence that the limits hold. |
| G-6 | **D-32 notes before the safety layer** | Clinical + legal owners + founder | PENDING (decision); interim server-side rejection **in place** | (1) A recorded decision between options (a), (b) and (c). (2) Interim: server-side rejection implemented and tested (merged to `main` in PR #1, `675b4a3`). (3) If notes are enabled: they pass through the M5 safety assessment before storage or display, and approved "not monitored" copy, if used, is shown. |
| G-7 | **D-33 note encryption and retention** | Security + legal owners | PENDING | (1) A recorded encryption approach (platform-only, app-level with a named KMS, or `pgcrypto`) with key rotation documented. (2) A retention period set by counsel, a scheduled purge job, and a test showing notes older than N days are removed while scores remain. (3) The same decision is applied to M5 conversation messages (ARCHITECTURE §5 groups them together). |
| G-8 | **Consent and terms** (D-11, D-24, D-25) | Legal owner | PENDING | (1) Final terms and privacy text, published as a new consent version (which forces re-consent; tested in M3). (2) Whether AI processing needs its own optional consent is decided, and if so modelled with withdrawal (D-25). (3) No `pending_legal_review: true` documents remain current at launch. |
| G-9 | **Age eligibility** (D-12) | Legal owner | PENDING (wording) | (1) Counsel confirms whether self-attestation suffices and what wording to use. (2) If the attestation must be recorded, the data model is extended through a reviewed migration. |
| G-10 | **Privacy, residency and deletion** (D-8, D-9, D-10, D-27, D-28) | Legal + security owners | PENDING | (1) A written regulatory position (D-8) and data-residency decision (D-9), with the LLM provider's data handling assessed against it. (2) Retention periods for every sensitive table (D-10). (3) A deletion workflow that covers Supabase `auth.users` deletion (D-27). (4) A staff access model with logged reasons (D-28). |
| G-11 | **Deployment baseline** | Founder | PARTIAL: (1) done (PR #1 merged, `main` CI run 38129868214 green); (2)–(4) PENDING, and (4) is blocked by D-35 | (1) PR #1 merged with CI green on `main`. (2) Migrations applied to Supabase per the runbook, with recorded evidence. (3) A real-Supabase end-to-end run (sign in → consent → mood → dashboard) recorded. (4) Branch protection on `main` requiring the four CI checks. |

**The M5 implementation may start only when** G-3 is designed and agreed and G-11 is
complete. *Update 2026-10-11:* the founder approved the G-3 design and explicitly approved a
first prototype slice on a separate branch before G-11 is complete, restricted to the fake
provider, synthetic fixtures, a test-only policy, the adult band only, no message storage
and no real-user access. M5 may only be exposed to any user outside the team when **every** item from G-1
to G-11 meets its criteria. Until then, M5 work runs only against mocks, behind the gate,
with no real-user access.

---

## J. Raised in the M5 chat prototype (2026-10-11)

### D-35. Branch protection on `main` — OPEN (founder; blocks G-11 item 4)
- The GitHub API returns 403 for branch protection on this private repository: the feature
  needs a paid plan (GitHub Pro or Team) or a public repository.
- **Options:** (a) upgrade the plan and require the four CI checks; (b) make the repository
  public (not recommended before a security review); (c) accept the risk and keep the
  "merge only after green CI and review" rule as a manual practice.
- **Current practice:** (c). No GitHub settings were changed.

### D-36. AI provider, data residency and transmission of user messages — OPEN (founder + legal + security; blocks any real provider)
- The prototype uses only a deterministic fake provider. No message leaves the server.
- **Needs:** a provider choice; its data-retention, training-use and region terms assessed
  against D-8/D-9; a decision on whether AI processing needs its own consent (D-25); a DPA.
- **Blocks:** connecting any real model or sending any user text to an external service.

### D-37. No server-side message storage in the prototype — RESOLVED for the prototype (founder, 2026-10-11)
- Decided: the browser holds the conversation; the server signs assistant turns (HMAC-SHA256
  over user id + text) and accepts at most 6 turns back. Every request is re-assessed.
  Message text is never stored, logged, or written to audit or safety events.
- **Still open for launch:** whether conversations are stored at all, with which encryption
  and retention (G-7, D-10). Signed turns don't expire and aren't bound to a session; that's
  acceptable for a prototype because the whole window is re-assessed each time.

### D-38. PostgreSQL rate limiter — RESOLVED for the prototype (founder, 2026-10-11)
- Decided: a per-user sliding 60-second window in `app.chat_rate_events`, serialised by a
  row lock on the user. Any limiter error means no generation (`status = "unavailable"`).
- **Still open (G-5):** the limit values (the default of 10 per minute is an engineering
  placeholder), per-IP limits, a limit on `POST /mood/checkins`, and load-test evidence.

### D-39. Remaining npm advisories in development tooling — OPEN (engineering; not launch-blocking unless shipped)
- After patching `next` (16.4.0) and `source-map-js` (`14cea91`), `npm audit` still reports
  five high-severity advisories, all in the `eslint-config-next` development chain. They are
  not in the production bundle. The only automatic fix is a breaking `--force` upgrade.
- **Proposed:** upgrade when `eslint-config-next` publishes a compatible fix; re-check before
  launch.

---

## K. Raised during M7 integration (2026-10-15)

### D-40. Production domain publicly reachable with unmerged code — RESOLVED 2026-10-17 (the founder checked the production branch, protection and variable scopes in the dashboard before merging; engineering cannot see the scopes)
- 2026-10-17: the founder merged PR #4 (merge commit `4cfa0b9`). CI on `main` passed
  (run 39030158182, 4/4 jobs). Vercel's GitHub deployment "Production" is `4cfa0b9`, so
  production tracks `main`. Re-probed 2026-10-18 from an unauthenticated client: `/`,
  `/sign-in`, `/chat`, `/dashboard` still 302 to Vercel login.
- 2026-10-17: from an unauthenticated client, `/`, `/sign-in`, `/forgot-password`,
  `/chat` and `/dashboard` on the production domain all redirect (302) to Vercel's login
  (`vercel.com/sso-api`). Production still serves `f7975ec` until a `main` deployment.
- Verified on 2026-10-14 and again on 2026-10-15 from an unauthenticated client:
  `https://ai-wellness-egy.vercel.app` returns 200 with no Vercel login and serves
  PR #3's code (`f7975ec`, GitHub deployment "Production"), with Supabase configured
  (the proxy's signed-out redirect carries `next=`). Branch and deployment URLs are
  protected, which matches *Standard Protection*, not *All Deployments*.
- **Required:** Vercel → Settings → Deployment Protection → **All Deployments + Vercel
  Authentication**; production branch `main`; Supabase/recovery variables scoped
  deliberately. Re-probe before any merge (`docs/DEPLOYMENT_RUNBOOK.md` §0).
- Until resolved, verified work is kept on `m7-integration` and **not merged**.

### D-41. Dates shown in Cairo time — RESOLVED (engineering, 2026-10-15)
- Dates render on the server; they are shown in `Africa/Cairo` time (previously UTC)
  for the Egypt-first audience. Revisit if non-Egyptian users are targeted.

### D-42. Browser tests not yet in CI — OPEN (engineering)
- The Playwright suite runs locally against Docker Compose and a test-only mock auth
  server. Running it in CI needs a job that starts the stack and a browser. Until then
  its results are recorded manually in IMPLEMENTATION_STATUS.

### D-43. Arabic UI copy — OPEN (extends D-19 and D-31)
- All primary journeys now have Arabic copy (provisional Egyptian Arabic, written by
  engineering). It needs native-speaker and, for consent-adjacent wording, legal
  review before launch. The consent document itself remains English-only.

---

## L. Raised during M8 controlled deployment (2026-10-18)

### D-44. First migration of the real Supabase database — DONE 2026-10-18 (`0002` applied with founder approval; `0003` deferred)
- Target: project `xchigpviedftrkxldclk`, through the session pooler. Command:
  `cd backend && alembic upgrade 0002`. `0003` stays deferred.
- Preconditions:
  - the read-only checker reports `state: fresh` (or `fresh_empty_app_schema`) for the
    right project (SUPABASE_MIGRATION_RUNBOOK §8.2);
  - the backup time is recorded (§8.3).
- 2026-10-18: both preconditions are met. The read-only check of the real project
  reports `state: fresh`, and a manual backup was taken and test-restored with identical
  counts (IMPLEMENTATION_STATUS §M8 "Real database inspection").

### D-45. Render paid instance — OPEN (founder approval of the displayed price)
- `0.5c-512mb` is listed at US$7/month, billed per second. The Hobby workspace is US$0,
  so expect about US$7/month plus any bandwidth beyond the allowance.
- Don't create the service before D-44 is done: an unmigrated database makes `/me`
  fail.
