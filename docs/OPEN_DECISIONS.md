# Open Decisions

Last updated: 2026-09-29 (Milestone 1).

Engineering does not make the decisions below. Some are clinical, legal or
crisis-procedure calls, and some belong to the founder. Until each one is
decided, code may only add interfaces, configuration slots, tests and
clearly marked, non-final placeholders. **No Egyptian emergency numbers,
clinical thresholds or crisis procedures may be invented.**

Status values: **OPEN** (needs a decision), **RESOLVED** (decided; kept for the record).

---

## A. Source documents

### D-0. `Architecture_V2_Phase_1_Build_Spec.docx` is missing — OPEN
- **Situation:** The project brief lists this file as required reading. It is not in
  the GitHub repository (the remote was empty) or in the local project folder. The
  imported documents in `docs/` cite it as their source of truth throughout (§6, §7, §9,
  §10, §12, §13, §20).
- **What was used:** the imported Markdown documents (`ARCHITECTURE.md`,
  `API_CONTRACT.md`, `DATA_MODEL.md`, `SME_COUNCIL_DECISIONS.md`,
  `PHASE_1_IMPLEMENTATION_PLAN.md`), taken from the pre-repository planning pass, plus the
  Milestone 1 brief.
- **Impact:** None on Milestone 1. Before M2, someone should confirm the imported docs
  still match the spec.
- **Owner:** Founder. Add the `.docx` (or a Markdown export of it) to `docs/`.

### D-1. Redis, Celery and Compose services in the imported docs — RESOLVED
- The imported `ARCHITECTURE.md` and `PHASE_1_IMPLEMENTATION_PLAN.md` put Redis, Celery
  workers and a Postgres/Redis/worker Compose stack in Phase 1.
- **Resolution:** The approved architecture in the Milestone 1 brief governs: Redis only
  when there is a real need, no workers, Supabase PostgreSQL, and a minimal Compose file.
  Each affected document now has a note at the top.

### D-2. Milestone numbering after M1 — OPEN
- The imported plan puts Supabase Auth in M2 and the database in M4. The Milestone 1 brief
  only says "do not start M2 without approval".
- **Needed:** Confirm the scope of M2.
- **Owner:** Founder.

---

## B. Founder / business

### D-3. Supabase project and enabled auth methods — OPEN
- Needed before M2 can be tested end to end: a Supabase project (dev, and later staging and
  prod), its URL and anon key, server-side credentials kept in a secret store, and which auth
  methods are enabled (email/password, magic link, OAuth, MFA, email verification).

### D-4. Local database strategy — OPEN
- When the database milestone arrives: run Supabase locally (Supabase CLI) for development
  and CI, or use a hosted dev project? This decides whether Compose ever gains a database
  service.

### D-5. Hosting, region, environments and secret store — OPEN
- No cloud provider, hosting region or production secret store has been chosen. The
  region choice depends on D-9 (data residency). The code assumes no provider.

### D-6. Product name and branding — OPEN
- "AI Wellness Egypt" is a working name, used in the landing page, the API title and the
  package names.

---

## C. Clinical judgment required

### D-7. Clinical governance — OPEN
1. Which licensed mental-health professional reviews and approves psychoeducation content
   and the AI's allowed and prohibited behaviour before real users see it?
2. What clinical risk taxonomy and LOW / MEDIUM / HIGH / UNKNOWN thresholds should the
   safety layer use? Until this is decided, the safety milestone may only ship
   conservative placeholders labelled as pending clinical validation.
3. Who reviews AI tone, the Egyptian Arabic and Arabizi evaluation cases, and the knowledge
   content? Ideally a native Egyptian Arabic speaker with mental-health content experience.
4. What does the product do to prevent unhealthy dependence on the AI (for example session
   nudges or signposting to human support), and who approves it?

---

## D. Legal interpretation required

### D-8. Regulatory status in Egypt — OPEN
- What legal and regulatory requirements apply to a non-clinical digital mental-wellness
  product in Egypt? This covers health-data rules, consumer protection, and whether
  Egypt's Personal Data Protection Law (Law No. 151 of 2020) applies and how. Counsel must
  answer this. Engineering has not interpreted it.

### D-9. Data residency — OPEN
- Can sensitive wellness data (conversations, journal entries, mood notes) be stored and
  processed outside Egypt? This affects the Supabase region (D-5) and the choice of LLM
  provider.

### D-10. Retention periods — OPEN
- What are the retention periods for messages, journal entries, mood notes, safety events
  and audit logs? The database milestone must make retention configurable rather than
  hard-coding values.

### D-11. Accountability, terms and disclaimers — OPEN
- Who is legally and clinically accountable if the safety layer misses a genuine crisis?
- Terms of service, privacy policy and the "not a replacement for professional care"
  wording need counsel's review. **The disclaimer on the Milestone 1 landing page is
  placeholder copy** and must be reviewed before any public launch.

### D-12. Minimum age and minors — OPEN
- What is the minimum user age? If minors are allowed, what consent and safeguarding rules
  apply? This must be settled before sign-up (M2/M3).

---

## E. Crisis procedures required

### D-13. High-risk escalation content — OPEN (blocks any real-user AI access)
- Which emergency services, crisis lines or resources should an Egyptian user in crisis
  see? What are the exact contact details, which languages are offered, and when are they
  available?
- Does the business have a referral relationship with qualified professionals, and what is
  the path to scheduling?
- Until this is decided, the escalation flow must use a loud, non-final placeholder (for
  example "Crisis resource content pending clinical/legal validation — do not launch").
  It must never contain invented numbers or procedures.
- **Deadline:** before any user outside the team can reach the AI companion.

---

## F. Engineering notes (non-blocking, for the record)

### D-14. ESLint 9 kept despite its deprecation notice — OPEN (revisit)
- `npm install` warns that `eslint@9.39.5` is no longer supported. ESLint 10 exists, but
  `eslint-plugin-react`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` (all pulled in
  by `eslint-config-next@16.3.6`) only declare support up to ESLint 9. Upgrade once those
  plugins support 10.

### D-15. `/health` includes the environment name — OPEN (confirm)
- The response is `{"status": "ok", "environment": "<name>"}`, as the imported
  `API_CONTRACT.md` specifies. Confirm that exposing the environment name on an
  unauthenticated endpoint is acceptable. The alternative is `{"status": "ok"}` only.

### D-16. SQLAlchemy and Alembic not yet installed — RESOLVED (deferred)
- They are part of the approved stack but nothing uses them in M1. They are added in the
  database milestone, together with the first models and migrations, so the project carries
  no unused dependencies.
