# Open Decisions

Last updated: 2026-09-29 (Milestone 3).

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
- **Needed:** a `DATABASE_URL` for the project (server-only; kept in `backend/.env` or a
  secret store, never in the frontend). Use the direct connection or the **session
  pooler** (the app disables prepared statements, so the transaction pooler also works).
  Then run `alembic upgrade head` from `backend/`.
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

### D-28. Access to audit and consent records by staff — OPEN
- `DATA_MODEL.md` restricts `audit_events` to an admin/compliance role and allows admin
  profile reads only with a logged reason. M3 builds no admin access at all. Audit rows are
  readable only by direct database access. Roles and tooling are future work.
