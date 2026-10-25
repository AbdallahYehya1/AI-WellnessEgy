# Open Decisions

Last updated: 2026-10-19 (M9 zero-cost Vercel deployment and RAG prototype; D-45 to D-50).

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

### D-44. First migration of the real Supabase database — OPEN (founder approval)
- Target: project `xchigpviedftrkxldclk`, through the session pooler. Command:
  `cd backend && alembic upgrade 0002`. `0003` stays deferred.
- Preconditions:
  - the read-only checker reports `state: fresh` (or `fresh_empty_app_schema`) for the
    right project (SUPABASE_MIGRATION_RUNBOOK §8.2);
  - the backup time is recorded (§8.3).
- Rehearsed only on a local Supabase Postgres image (§8.8), so the real database's state
  is still **unknown**.

### D-45. Render paid instance — CANCELLED 2026-10-19 (budget is strictly $0; the backend moves to a second Vercel Hobby project; `render.yaml` removed)
- `0.5c-512mb` is listed at US$7/month, billed per second. The Hobby workspace is US$0,
  so expect about US$7/month plus any bandwidth beyond the allowance.
- Don't create the service before D-44 is done: an unmigrated database makes `/me`
  fail.

### D-46. Least-privilege database role for the internet-facing backend — PROPOSED (founder approval to create it on the real database; updated 2026-10-19 for Vercel and 0003)
- **Problem:** the backend would otherwise connect as `postgres`, which owns every `app`
  object, has `CREATEROLE` and `BYPASSRLS`, and can read `auth.*` (emails, password
  hashes). A leaked Render `DATABASE_URL` or a backend compromise would expose the
  whole project.
- **Proposal:** role `app_backend` (`python -m app.ops.backend_role`):
  - login with a SCRAM verifier computed locally (the plaintext never reaches the
    server); `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`;
  - connection limit 15; per-role `statement_timeout` 5 s, `lock_timeout` 3 s,
    `idle_in_transaction_session_timeout` 15 s;
  - `USAGE` on schema `app` only;
  - `users`: SELECT, INSERT, UPDATE. `consents` and `mood_checkins`: SELECT, INSERT.
    `audit_events`: INSERT, plus SELECT on (`id`, `created_at`) only, which the ORM
    reads back after inserting;
  - no DELETE, TRUNCATE or DDL anywhere, and no reachable table outside `app`.
- **Why BYPASSRLS:** RLS is on with no policies, which denies every role that doesn't
  bypass it (tested). RLS here guards against Supabase's Data API roles; the backend
  enforces ownership in code. BYPASSRLS grants nothing by itself, because table
  privileges still gate every access. The alternative, per-role policies, needs a
  migration that references a cluster-level role, which CI and dev databases don't
  have; it isn't safer for this design.
- **Evidence (local only):**
  - 22 tests: every non-chat journey runs as the role; 12 out-of-scope operations are
    denied; idempotent re-apply removes drift; the revision guard works; the
    plaintext isn't stored.
  - Rehearsed on `supabase/postgres:17.11.0.003`: role creation is allowed by
    supautils; the production image ran as the role over TLS (15/15 API checks);
    database outage and recovery behaved correctly.
- **Real project facts (read-only, 2026-10-18):** `postgres` has CREATEROLE and
  BYPASSRLS; `password_encryption = scram-sha-256`; `pgbouncer.get_auth` exists, so
  the pooler can authenticate custom roles; `PUBLIC` can't reach any table or
  SECURITY DEFINER function. The pooler login for the role is still unverified until
  the role exists.
- **Before migration 0003:** extend `GRANTS` for the chat tables and re-run `--apply`.
- **2026-10-19 update:**
  - The backend on Vercel connects through the **transaction pooler** (port 6543) with
    TLS verify-full against the bundled Supabase root CA.
  - Grants are revision-aware: `0002`, or `0003` with the chat tables (read-only
    knowledge, append-only safety events, the self-pruning limiter).
  - Rehearsed at `0003` on the Supabase image: `problems: []`.
  - The chat journey runs as the role in tests.

### D-47. External AI provider (Groq) for real-model chat — BLOCKED (founder privacy decision + D-48)
- **Implemented, off by default:** `CHAT_PROVIDER=groq` also needs `GROQ_API_KEY` and
  `CHAT_EXTERNAL_PROVIDER_APPROVED=true`. Without both, chat turns off; it never falls
  back to another provider. Tested against a local stand-in, never the real API.
- **Groq's published terms (2026-10-19):**
  - Inputs and outputs may be logged for up to **30 days** unless **Zero Data Retention**
    is enabled in Data Controls.
  - Data is stored in the **US**.
  - Rate limits (page labels them Developer-plan base limits): 30 requests/min,
    1,000/day and 200K tokens/day for the GPT-OSS models. Exceeding them returns
    HTTP 429, which the app reports as "unavailable".
  - Upgrading is manual. The page doesn't say whether the free tier needs a card.
- **Request minimisation:** the current message, the last 4 turns and the retrieved
  passages; no user id, email or name. 600 output tokens, 8 s timeout, JSON-only, and
  citations validated against the retrieved passages.
- **Founder decisions needed:**
  1. A recorded privacy decision that wellness messages may go to a US provider (consent
     wording, residency).
  2. Enable ZDR.
  3. Confirm the free tier needs no card and the model is available to the account.
  4. Store the key only in Vercel.
- The model id defaults to `openai/gpt-oss-20b` and must be confirmed on the account.

### D-48. Chat on the deployed test environment — BLOCKED (founder approval; clinical gate D-7 still open)
- Production refuses the test-only safety policy by design. The test-only assessor
  recognises explicit test markers and a small **engineering crisis screen** (English,
  Arabic, Egyptian, Arabizi) that routes crisis language to the support response. **It
  is not a clinical assessor, and misses are expected.**
- **To demo chat on Vercel:** set the backend project to `ENVIRONMENT=staging` (hardened
  like production: docs off, verified TLS, shared signing key), plus
  `CHAT_ENABLED=true`, `CHAT_SAFETY_POLICY=synthetic-test-v0` and a 32+ character
  `CHAT_SIGNING_KEY`.
- That exposes the prototype to every signed-in account on the real project, so it needs
  explicit approval, a tester-only audience (Vercel protection) and migration `0003`.

### D-49. Auth email to arbitrary addresses at $0 — BLOCKED (no domain)
- Resend's test domain delivers only to the account owner. Verified sending needs a
  domain you own.
- Brevo can't authenticate free-mail senders (third-party guides say it rewrites them to
  its own domain).
- Gmail SMTP with an app password is unverified for Supabase, and is meant for personal
  sending.
- Until a domain exists, Supabase's built-in email reaches only project-team addresses
  (about 2 per hour). Real-auth checks use the founder's team address.

### D-50. Curated knowledge sources — DRAFT (not clinically reviewed)
- Four authentic public-health sources (`app/knowledge/sources/`, provenance in
  `SOURCES.txt`):
  - WHO, *Doing What Matters in Times of Stress* (English and the official Arabic
    edition; CC BY-NC-SA 3.0 IGO, non-commercial excerpts, attributed, not endorsed by
    WHO);
  - two NIMH pages (public domain).
- All are `review_status: draft`, `clinical_review: none`. They're retrievable only under
  the test-only policy; production retrieval is `approved` only. Ingestion now requires
  licence, permitted use, retrieval date and clinical-review state, and `approved` can't
  carry `clinical_review: none`.
- Becoming `approved` needs a qualified reviewer's recorded sign-off (D-7).

- **2026-10-19 update (curated demo):** deployed chat now runs only in
  `CHAT_DEMO_CURATED` mode:
  - approved, predetermined low-risk questions only; free text is refused before
    assessment, retrieval or any provider call;
  - only the accounts in `CHAT_DEMO_ALLOWED_USERS`;
  - earlier user turns must also be approved questions.

  Approval is still needed for `ENVIRONMENT=staging` on the backend project and for
  migrations `0003`/`0004`. With curated mode and Groq, only predetermined text and
  public WHO/NIMH passages reach the provider. A clinical assessor and policy (D-7)
  remain required for any free-form chat.

- **2026-10-20 update (production curated policy):** the restricted demo now runs with
  `ENVIRONMENT=production` under `curated-educational-demo-v1`.
  - It's a non-synthetic, non-clinical policy limited to predefined questions, with
    `CuratedPromptAssessor`: LOW only for approved questions, otherwise UNKNOWN, which
    fails closed.
  - Production accepts it only with `CHAT_DEMO_CURATED` and an allow-list.
  - `synthetic-test-v0` remains refused in production.
  - Free-form chat anywhere deployed still needs a clinical assessor and policy (D-7).

### D-52. What free-text wellness chat would require — OPEN (clinical, legal, privacy)

Chat is currently open to every consenting adult, but **only for the reviewed,
predefined questions**. Free text is refused before assessment, retrieval or any
provider call, so only those questions and public WHO/NIMH/NCCIH/CDC passages reach
Groq. Free-text conversations would need at least:

1. **Clinical safety:**
   - A clinically validated risk assessor (not the keyword screen) for Arabic, Egyptian
     Arabic and English, with measured sensitivity on crisis language.
   - A clinician-approved policy (D-7).
   - Reviewed crisis responses with **verified Egyptian** emergency and support
     resources (D-13).
   - Escalation behaviour and adverse-event handling.
2. **Knowledge:** clinically reviewed sources (`approved`, D-50), and official Arabic
   material for the topics that only have English sources.
3. **Privacy and legal:**
   - A lawful basis and explicit consent wording for sending personal wellness text to
     a third-party model processor in the US.
   - A data processing agreement and confirmed zero retention.
   - A data-protection review under Egypt's Personal Data Protection Law (Law 151/2020)
   for health data.
   - The retention and encryption policy for any stored conversation (none is stored
     today).
4. **Abuse and reliability:**
   - Per-user and global quotas sized to a paid or contracted provider.
   - Prompt-injection testing against the retrieval and system prompt.
   - Output moderation, and monitoring that never logs message text.
5. **Evaluation:**
   - A held-out conversational test set, including adversarial and crisis cases, with
     clinical review of the answers. Engineering tests don't establish clinical safety.

### D-53. Typed questions within supported topics — DECIDED (engineering), free text still OPEN

**Status (2026-10-20):** the chat composer accepts typed text. A deterministic, fail-closed gate
(`backend/app/conversations/intents.py`) admits a message only when:

- the engineering crisis screen doesn't match (a match goes to the support response);
- every word belongs to a closed English/Arabic vocabulary of question words, neutral
  wellness words and topic words;
- the words select exactly one reviewed topic (stress, grounding, everyday habits,
  difficult thoughts and feelings, sleep, physical activity, mindfulness), or a follow-up
  (explain in Egyptian Arabic, continue, summarise) after an earlier recognised question.

Anything else is refused before limits, retrieval or any model call, and the user is told
why. An admitted message is **replaced by its reviewed question**, and only that question,
never the user's words, reaches safety assessment, retrieval and Groq. Names, symptoms,
medication, negations ("can't"), numbers, first-person states ("I'm…"), Arabizi and unknown
words all cause a refusal. The UI shows "Answered as: <reviewed question>", so the matching
isn't presented as open conversation.

**This is not general free-text chat.** It is topic matching with a closed vocabulary.
Unrestricted conversation still needs everything in D-52, plus:

1. a clinically validated risk assessor with measured sensitivity, including crisis language
   inside on-topic questions, in Egyptian Arabic and Arabizi (D-7);
2. reviewed crisis responses with verified Egyptian resources (D-13);
3. consent and a lawful basis for sending personal text to Groq (US), with ZDR and a DPA confirmed;
4. prompt-injection, jailbreak and moderation testing, with category-only monitoring;
5. a held-out conversational evaluation with clinical review.

### D-54. Saved chat history — DECIDED (engineering), production migration pending approval

**Opt-in only.** Every user starts with saving off. Turning it on needs the "chat-history-v1"
notice, which explains what is stored, the encryption (not end-to-end), deletion and the 90-day
retention. Declining keeps the earlier browser-only behaviour (D-37).

- **Stored:** typed questions that were answered, the validated replies, citation metadata
  (public titles and URLs), the recognised topic and the model name. **Never stored:** refused
  messages, support-routed messages, retrieved passages, prompts, raw provider responses and
  safety diagnostics.
- **Encryption:** AES-256-GCM in the backend (`CHAT_HISTORY_KEYS`, a rotatable key ring). Each
  ciphertext is bound to its row and owner. The database and backups hold ciphertext only.
  The backend can decrypt; this is not end-to-end encryption. Losing every key loses the history.
- **Ownership:** the backend role bypasses RLS, so every query filters on the verified user.
  Another account's conversation answers 404, exactly like a missing one. Tests cover guessed
  ids, rename, delete, continue and ciphertext moved between accounts.
- **Context:** continuing loads the last 4 turns server-side. In topic mode user turns are sent
  as their reviewed questions. Browser history and a conversation id can't be mixed, and sources
  are retrieved afresh for every message.
- **Controls:** rename, delete one, delete all (no current consent needed to delete), stop
  saving, 90-day idle retention (enforced when the list loads) and a 200-conversation cap.
- **Open:** a legal and privacy review of storing wellness chat text (Egypt PDPL, Law 151/2020),
  a retention period confirmed by counsel, and a data-subject export.

### D-55. Natural-language eligibility for typed questions — DECIDED (engineering), supersedes D-53's closed vocabulary

**Why:** the closed vocabulary from D-53 refused ordinary questions ("I'm stressed about
exams, what might help?"), so users had to guess the right wording.

**Now** (`backend/app/conversations/intents.py`), every typed message passes, in order:

1. **Crisis and distress screen:** crisis phrases, and signs such as hopelessness, abuse
   or panic, go to the support response. Engineering keyword lists, not clinical.
2. **Personal-details screen:** e-mail addresses, phone numbers, links and handles are
   refused, with a request to remove them.
3. **Clinical and sensitive screen:** diagnosis, medication, doses, physical symptoms,
   substances, sexual content and violence are refused, with a pointer to a professional.
4. **Topic recognition:** a bilingual lexicon with spelling normalisation, Arabic clitic
   stripping and English inflections places the question in one reviewed topic.
   **Unknown words are ignored instead of refused.** Two equally strong topics ask the
   user to pick one.

**What Groq receives:** an accepted message is re-expressed as a general question about
its topic plus at most two allow-listed context labels, for example
`What general techniques can help with stress? (Context: exams)`. Safety assessment and
retrieval use the reviewed question. Groq never receives the user's sentence, so names
and other personal details are dropped rather than forwarded.

**Still not open conversation.** It answers general questions about seven topics.
Limits:

- keyword screens miss indirect phrasing;
- Arabizi isn't recognised;
- the support response is a placeholder (D-13);
- unrestricted chat still needs everything in D-52.

## M. Raised in the assistants and Daily Reflection upgrade (2026-10-23)

### D-56. Ten specialised assistants on one pipeline — DECIDED (engineering); all ten ready since D-61

**One pipeline, many assistants.** The registry (`backend/app/assistants/registry.py`)
defines ten assistants. They share one database, safety layer, retrieval code, history
store and provider gate. Each has a primary domain, optional secondary domains, its own
instructions, starters and a `ready` or `preview` status.

- **Ready:** Marriage & Healthy Relationships (`relationships`), Career & Work (`career`)
  and Emotional Wellbeing & Resilience (`emotional`, the legacy chat).
- **Update 2026-10-24 (D-61):** all ten are ready. The text below describes the first
  release. Then, family, growth, fitness, social, planning, finance and everyday were
  previews, listed as "Coming soon" and unable to be opened. The API refuses them with
  `403 assistant_unavailable`, and the frontend falls back to the default assistant.
  An assistant becomes ready only when its knowledge base passes the per-assistant
  evaluation (`docs/evaluation/KNOWLEDGE_AUDIT.md`).

**Domain isolation in SQL.** `knowledge_sources.domains` (text[], checked against the ten
ids, GIN-indexed) says which assistants may retrieve a source. Retrieval adds
`s.domains && :domains` to the WHERE clause, and an assistant always searches its own
domain only. Measured on 12 held-out questions written before the final run
(`docs/evaluation/assistant-retrieval.json`):

| Mode | Hit@4 | Top-1 | Cross-domain leakage |
|---|---|---|---|
| Old general retrieval (baseline) | 0.00 | 0.00 | 0.08 |
| New knowledge, no domain filter | 0.67 | 0.50 | 0.23–0.27 (tied passages come back in arbitrary order) |
| New knowledge, domain-filtered | 1.00 | 0.92 | 0.00 |

These are engineering retrieval metrics on a small set. They don't show clinical accuracy
or answer quality.

**Understanding, not presets.** `understanding.py` reads a free-text message in English,
MSA or Egyptian Arabic. It runs screens for crisis, harm in relationships, clinical,
fitness-medical, regulated (legal, tax, investment), sensitive, personal-details and
prompt-injection content. Then it scores the assistant's subtopic lexicon, keeping at most
3 subtopics. If another ready assistant clearly fits better (at least 2 points higher), it
suggests a **handoff**: a link to a new chat with that assistant, with nothing carried over.

**Two response strategies**, both from one generation call:

1. Evidence-grounded statements that cite the retrieved passages.
2. Low-risk, everyday coaching suggestions that are clearly identified as general
   suggestions and not cited.

Replies are limited to 1,600 characters. Health, legal and financial facts must come from
passages.

**What is sent to Groq (structured mode, the only mode implemented):**

| Sent | Not sent |
|---|---|
| The assistant's fixed instructions and the shared rules | The user's own sentence, in any form |
| A composed question built from the matched subtopics' reviewed phrases plus at most two allow-listed context labels, e.g. *"At work, what are practical ways to manage workload and pressure at work…? (Context: work)"* | Names, numbers, e-mail addresses, places or other details from the message |
| Up to 4 retrieved public passages (numbered) | User id, e-mail, account data, reflections, mood history |
| Up to 4 earlier turns, each a composed question or a model reply | Refused or support-routed messages |
| The reply language (`en` or `ar`) | Safety diagnostics |

Groq logs only token counts (`chat_provider_usage`). The composed question is stored
encrypted with the turn (`chat_messages.query_enc`, purpose `query`) so a continued chat
keeps its context without re-reading the user's words.

**Contextual mode: superseded by D-59** (implemented, off by default, per-user opt-in).
The original text follows. Contextual mode would send the user's own (redacted) words to Groq. That is a new sensitive-data transfer. It needs explicit founder
approval, a privacy review (Egypt PDPL), confirmed provider retention terms (Groq
zero-data-retention is unconfirmed) and a redaction evaluation. Implementing the
assistants doesn't turn it on.

**Safety boundaries kept:**
- Crisis messages route to the support response.
- Harm in a relationship (hitting, threats, control) gets a dedicated notice with Egypt
  police 122 and ambulance 123. The NCW hotline 15115 is not shown until it is verified.
- Clinical, medication, legal, tax and investment requests are refused, with a pointer to
  a professional.

**False refusals and missed risks are measured separately**
(`app/assistants/safety_eval.py`, report in `docs/evaluation/assistant-safety.json`).
Labelled benign and risky sets are written in English, MSA and Egyptian Arabic. Each set
was measured once before the screens were adjusted for it:

| Set | False refusals | Missed risks | Screens at the time |
|---|---|---|---|
| v1 (27 benign, 21 risky) | 0/27 | 3/21 | original |
| v2 (10, 12) | 0/10 | **9/12** | after fixing v1's misses |
| v3 (10, 12) | 1/10 | 1/12 | after widening by phrase families |

All sets and a guard set of everyday look-alike phrases now pass. **v2 is the key
finding:** keyword screens missed most indirect crisis and violence phrasing. The
widening is shared with the legacy chat's crisis screen, which was equally weak. Expect
new phrasings to slip through. Before wider release this needs:

- a classifier;
- clinical review of the risk lists and of the support response (D-13);
- a larger evaluation written by people other than the screen's author.

**Fair use:** 25 answered messages per user per day, under the global
`CHAT_PROVIDER_DAILY_LIMIT` (60), so one account can't use up the shared free quota.

**History:** conversations carry `assistant_id`, default `emotional` for existing rows.
Lists are filtered per assistant. Continuing a chat with a different assistant answers
`409 assistant_mismatch`.

### D-57. Daily Reflection replaces the 1–5 check-in — DECIDED (engineering)

- **Entry:** one or more of nine feelings (happy, calm, good, okay, anxious, sad,
  frustrated, tired, excited) with emoji *and* text labels. Factors are optional, from
  eleven choices. There is no score.
- **Stored** in `mood_checkins` as `entry_version = 2` with `emotions` and `factors`, and
  `mood_score` NULL. Legacy 1–5 rows (`entry_version = 1`) are unchanged and still shown,
  with their chart and table.
- **Private note: off.** `note_enc` exists (encrypted like chat history) but the API doesn't
  accept a note. A free-text note about how someone feels is sensitive data. It needs the
  same privacy review as D-54 before it is collected.
- **Insights** (`GET /mood/insights?period=week|month`) are descriptive counts of *days*
  in the user's time zone:
  - which feelings and factors were chosen;
  - which pairs occurred together on at least 2 days, with the caveat "They don't show
    causes".
  - No scores, trends, diagnoses or streaks.
  - Fewer than 3 reflections in the period shows a gentle "not enough yet" note.
- **Handoff:** after saving, up to 3 ready assistants may be offered, chosen from the
  factors and from anxious, sad or frustrated. The link opens a fresh chat. Nothing from
  the reflection is put in the URL or sent to the assistant.

### D-58. NHS website content terms — RESOLVED 2026-10-24: NHS sources retired

Six sources are verbatim excerpts from NHS Every Mind Matters pages (Open Government
Licence v3.0). The NHS website terms also ask syndicators to accept a content licensing
agreement and forbid attributing adapted text to the NHS. The excerpts are verbatim and
attributed, which is acceptable for a prototype. **Before any non-prototype use**, confirm
whether the agreement applies, or replace these sources.

**Resolution:** the excerpts were removed before any production ingestion and replaced by
public-domain US federal sources (D-61). The NHS pages were never in production.

### D-59. Privacy-minimised provider context — DECIDED (engineering); production use needs founder approval

**Why:** structured mode re-expresses a message as a generic topic question, so the model
loses the situation ("my wife feels neglected because I work late to save for our
future"). The answers were generic.

**Three modes** (`CHAT_CONTEXT_MODE`; code in `app/assistants/context.py`):

| Mode | What Groq receives | Who |
|---|---|---|
| `structured` (default) | A question composed from recognised subtopics. No user words. | Everyone, and anyone who hasn't opted in |
| `minimized` | The user's message with identifiers removed, plus recognised themes and up to 4 earlier turns re-derived the same way | Only users who accepted notice `chat-context-v1` |
| `original` | The user's own words | Only if `CHAT_ORIGINAL_WORDING_REVIEW` names a completed privacy/legal review, and the user opted in. **Not enabled.** |

- **Redaction:** e-mail addresses, links, handles, numbers of 6+ digits (including
  Arabic-Indic), names introduced by a relationship word ("my wife Sara"), "my name is",
  "اسمها", and street names. It can miss names without such cues, places and employers;
  the consent notice says so. Short numbers (ages, hours) stay because they carry meaning.
- **Consent:** `PUT /chat/context {enabled, consent_version}` stores
  `users.chat_context_consent_version`. The notice states:
  - what is sent;
  - that removal can miss things;
  - the provider (Groq), the model, and processing in the United States;
  - Groq retention (up to 30 days for abuse/reliability unless Zero Data Retention is on);
  - why it's needed, and that it can be stopped at any time.
  Withdrawal takes effect at the next message: earlier turns are re-derived in structured
  form.
- **Never sent, in any mode:** crisis, safety and medical messages; account data; Daily
  Reflections; other conversations.
- **Transparency:** each opted-in turn shows "Shared with the AI (details removed): …".
  The mode note in the chat changes too.
- **Retrieval uses the user's (redacted) words in every mode.** Retrieval runs in our own
  database, so nothing extra leaves the backend.
- **Budget:** `CHAT_DAILY_TOKEN_BUDGET` (default 150,000 tokens per 24 hours, all users and
  assistants). It is recorded per request in `chat_rate_events.tokens` (column-level
  UPDATE grant only). `CHAT_USER_DAILY_LIMIT` defaults to 25.
- **Open:** legal and privacy review (Egypt PDPL) of sending minimised personal
  descriptions to a US provider; enabling Groq Zero Data Retention (a console setting
  only the account owner can change).

### D-60. Safety beyond keyword lists — DECIDED (engineering); not clinically validated

- **Separate from topic recognition.** Pattern screens run before anything else:
  - suicide and self-harm, including indirect phrasing;
  - physical violence: verb + "me/my children", excluding "beat me at chess";
  - sexual violence and threats;
  - coercive control: phone and message monitoring, "decides who I can talk to";
  - danger to others;
  - medical emergencies;
  - prompt injection.
  Everyday idioms ("my boss will kill me if I'm late", "this deadline is killing me")
  are kept as regression cases.
- **Second layer:** the model returns `risk` (none, self_harm, abuse, medical_emergency,
  danger). A risky reading replaces the reply with the matching support response.
- **Supportive responses, not refusals:**
  - crisis → ambulance 123 and the Ministry of Health mental health line 16328 (24 h);
  - harm, abuse or control → police 122 and ambulance 123, the National Council for
    Women's complaints office 15115, and the Child Helpline 16000, plus up to 3 vetted
    sources (OWH, ODPHP, CDC, MedlinePlus) retrieved without the model;
  - medical → 123 or emergency department;
  - danger to others → 122 and 16328.
  Numbers were corroborated by Egyptian state media (Maspero 2026 for 16328; Al-Ahram
  for 15115) and Child Helpline International (16000). Re-verify them before any public
  launch.
- **Abuse pages stay out of ordinary advice.** Unless the message has safety cues, they
  are reached only through the safety notice.
- **Measured** (each set written before its first run; current state, all sets):

  | Set | False refusals | Missed risks |
  |---|---|---|
  | v1 | 0/27 | 3/21 |
  | v2 | 0/10 | 9/12 |
  | v3 | 1/10 | 1/12 |
  | v4 (new categories; thresholds 0.10/0.10 set beforehand) | 1/20 | 2/20 |
  | All sets now | 0/74 | 0/65 |

  Still keyword and pattern based, so new phrasing will slip through. Clinical review of
  the lists and the support text is still required (D-13).

### D-61. Ten assistants with licensed knowledge — DECIDED (engineering)

- **All ten assistants are ready.** Emotional Wellbeing runs the assistant pipeline when
  the client names it (the web app always does); old clients keep the seven-topic chat.
- **Knowledge:** 64 sources, 598 passages, all verbatim and licence-checked (see
  `docs/evaluation/KNOWLEDGE_AUDIT.md`).
- **Retrieval:** hybrid. Subtopic terms and the message's words are searched separately,
  both filtered to the assistant's domains in SQL, then merged with reciprocal-rank
  fusion. Semantic embeddings were not adopted: there is no query-time embedding service
  within the existing free infrastructure, and adding one would mean a new data processor.
- **Evaluation:** thresholds were fixed before the first run (at least 0.75 per assistant,
  zero leakage, at least 0.60 Arabic).

  | Set | Status | Hybrid hit@4 | Worst assistant | Arabic / Egyptian / mixed |
  |---|---|---|---|---|
  | v3 (120) | tuned | 0.98 | 0.92 | 0.98 |
  | v4 (60) | held-out | 0.97 first run; 0.98 final | 0.83 | 1.0 |

- **Answers:** evidence-cited facts plus clearly labelled general coaching. Uncited replies
  are shown as "General guidance". Coaching may answer when no passage matches.
- **Not measured yet:** answer faithfulness and citation support with the real model, and
  multi-turn quality with Groq. These need production smoke tests after deployment.


### D-62. Routing, not gating: no "out of context" refusals — DECIDED (engineering, 2026-10-25)

**The problem.** In structured mode (production), `understand()` returned `needs_detail`
whenever none of the assistant's lexicon words appeared in the message, and the service
turned that into `status="out_of_scope"`, shown as "Outside what I can answer". Substring
screens also refused ordinary wording: "do i have" (clinical), "depressed" (clinical),
"invest more time" and "shares everything" (regulated), "pregnant" and "diabetes"
(fitness). On the 66-question regression set, 22 ordinary questions (33%) were refused.
On a 37-question held-out set, 13 (35%) were refused. Three risky messages also missed
safety handling: "don't want to be alive", "thinking about ending my life", and "hits my
little brother with a belt".

**The decision.** An assistant's specialisation decides where knowledge comes from, not
whether a question may be asked.

1. **Safety first, independent of topic.** Crisis, abuse, danger and medical emergencies
   are screened before any routing, and the routing cannot skip them. The crisis and
   violence patterns gained the missing phrases.
2. **Refusals only for harmful or professional-only requests.** These are diagnosis,
   medication, specific investment, tax or legal advice, sexual content, substances,
   weapons, injection attempts, identifying details and overlong messages. The screens
   are now word-bounded, so "taxi", "courtesy", "invest time" and "revenge bedtime
   procrastination" no longer match.
3. **Answered with a boundary.** In Fitness, a health condition, pregnancy or injury
   alongside an ordinary activity question is answered. A fixed instruction tells the
   model to say "check with your doctor first" and to give no medical advice; on its own,
   such a question is still refused. "Depressed" or "low" is answered supportively, with
   a fixed instruction to suggest a professional if it lasts. These instructions never
   contain the user's words.
4. **Routing chain.** The chain tries, in order:
   1. the assistant's own lexicon;
   2. a follow-up to the earlier turn;
   3. related wording (shared content stems with a subtopic's own description);
   4. another assistant's lexicon (at least two trigger words, asked in this assistant's
      frame; its sources are searched only if its domain is an approved secondary domain,
      otherwise a handoff link is shown with the answer);
   5. related wording in approved secondary domains;
   6. the evidence step: local retrieval with the redacted words. When a passage shares
      at least two content words with the message, the model gets that public passage and
      a fixed question ("…apply the guidance in the provided passages…").
5. **Otherwise, ask.** The response has `status="clarify"`: "Tell me a bit more", with the
   closest concerns as tappable suggestions. It is not a refusal, uses no provider call or
   quota, and keeps the handoff suggestion.
6. **Privacy unchanged.** Structured mode still never sends the user's words to the
   provider. The regression test checks this for every case. Minimized mode remains
   opt-in and off in production until the operator sets `CHAT_CONTEXT_MODE`.
7. **Citations.** Only passages the model was given can be cited; anything else is
   dropped. Replies without citations are labelled "General guidance".

**Results** (`docs/evaluation/routing-regression.json`; the baseline is in
`routing-regression-baseline.json`):

| Set | False refusals before | After | Answered | Asked to clarify | Safety over-triggers |
|---|---|---|---|---|---|
| Regression (66, tuned) | 22 (33.3%) | 0 | 64 | 1 | 1 ("hate myself for it") |
| Held-out (37) | 13 (35.1%) | 0 | 31 | 6 | 0 |
| Risky (12) | 3 missed | 0 missed | — | — | — |

The regression set was used to fill vocabulary gaps (a career "pay" subtopic, an
everyday "neighbours and services" subtopic, and extra terms), so its numbers are
optimistic. The held-out set was written after the routing change, and its result above
comes from the first run after two structural fixes: borrowing needs two trigger words,
and related wording is limited to approved domains. No vocabulary was tuned on it.

**Kept deliberately.** "I hate myself for it" still goes to support (distress screen).
That is conservative but supportive, and is reported as an over-trigger rather than
loosened. Changing the distress screen needs a clinical decision (D-52/D-60).

**Found in production (2026-10-25).** With real Groq, the instruction-only caution was
ignored: "I'm pregnant. Is it okay to keep walking every day?" got general activity tips
with no "check with your doctor". The model never sees the condition in structured mode.
The service now appends a fixed, localised note to the reply itself. The health note is
always added. The low-mood note is added unless the reply already suggests a
professional.

**Not solved by this.** In structured mode, a question that matches no lexicon entry and
no passage is asked for more detail instead of answered (6 of 37 held-out questions).
For the same reason, a cautioned answer addresses the matched activity theme (for
example "sit less and move more") rather than the specific condition.
Answering those from the user's own words needs minimized mode, which is opt-in and off
in production (D-59).

### D-63. Health conditions answered locally; fewer clarifications — DECIDED (engineering, 2026-10-25)

**Why.** The production check of D-62 showed two gaps.

- *Pregnancy.* The guidance itself didn't fit. "I'm pregnant. Is it okay to keep walking
  every day?" got generic "sit less, move more" tips with a note appended. A disclaimer on
  top of advice that ignores the condition is not acceptable. Sending the condition to
  the provider, even as a composed topic, would be a new transfer of health data, which
  stays off without privacy approval.
- *Clarifications.* All six held-out questions that got "Tell me a bit more" were routing
  failures, not unclear questions:
  - three Egyptian Arabic verbs whose prefixes weren't recognised ("بتتجاهل", "بتقارني");
  - missing vocabulary: "tidy", "toddlers", "study", "forget", "appointments", "أوفر".

**Decisions.**

1. **WHO's guidance, built locally.** In Fitness, pregnancy, type-2 diabetes or high blood
   pressure, together with an activity question, gets WHO's guidance for that group:
   - quoted verbatim from the WHO guidelines (English or official Arabic);
   - cited, and followed by a fixed note to check with a doctor or midwife, with the
     warning signs that mean stopping now;
   - built with **no provider call**.

   Later Fitness turns in that conversation also stay local (the safety and good-practice
   sections), and those turns are never part of the provider's history. The six sections
   for each language were added to the knowledge base from the same licensed publication.
2. **Danger signs go to urgent care.** Danger signs in pregnancy (bleeding, fluid
   leaking, contractions, dizziness, headache, swelling, the baby not moving) get the
   urgent medical support response in every assistant. Arabic danger words match whole
   words, so "خدمة" does not match "دم".
3. **Other health issues go to a clinician.** In Fitness, injuries, pain, type-1
   diabetes, heart conditions and surgery are refused with a pointer to a clinician, as
   are pregnancy or chronic-condition questions that aren't about activity (for example
   diet). The instruction-only health caution from D-62 is removed; the low-mood note
   stays.
4. **Egyptian Arabic morphology.** The matcher now strips verb prefixes (بي/بت/بن,
   هي/هت/هن, مبي/مبت) and the negation suffix ش, keeping at least three letters of the stem.
5. **Context preservation without new transfers.** The structured question carries more
   of the situation's meaning through finer **topic** phrases, the existing approved
   mechanism. New subtopics: in-laws, grief, moving abroad; jealousy goes to trust;
   mornings, work–home balance and hesitation gain vocabulary.
   - Passages are still chosen locally with the redacted words.
   - Richer situational labels ("in-laws", "young children", "after a bereavement") would
     be a new category of personal context sent to the provider. They are **not**
     implemented and need privacy approval.

**Results** (`docs/evaluation/routing-regression.json`):

| Set | Answered | Clarify | False refusals | Note |
|---|---|---|---|---|
| Regression (66) | 64 | 1 | 0 | tuned |
| Held-out 1 (37) | 37 | 0 | 0 | was 31 + 6 clarify; the six were fixed, so now tuned |
| Held-out 2 (25) | 25 | 0 | 0 | first run 21 + 4 clarify, before its fixes; now tuned |
| Risky (12) | — | — | — | 0 missed |

Structured mode still sent the user's words to the provider in 0 cases. No reply cited
a passage the model wasn't given.

**Limits.** The local answers quote WHO's text rather than answering conversationally.
They cover only pregnancy, type-2 diabetes and high blood pressure. Arabic answers quote
WHO's Modern Standard Arabic, with an Egyptian Arabic introduction and note.
