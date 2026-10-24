# Deployment runbook (Vercel · Supabase · email)

Status: **preparation only.** Nothing in this document has been applied to a live
environment by engineering. Every step marked **[approval]** needs the founder's
explicit approval before it is performed. Never put a real secret in this
repository, in a `NEXT_PUBLIC_` variable, or in chat.

Architecture: Vercel (Hobby, $0) hosts the Next.js frontend and, as a second project, the
FastAPI backend (Python Function);
Supabase provides authentication and PostgreSQL. Auth email is Supabase's built-in sender
(project-team addresses only) until a domain-based provider exists (§5).

---

## 0. Release gates (all must hold before real users)

| Gate | How to verify |
|---|---|
| Production domain is protected until release | From a browser that is **not** signed in to Vercel, every URL (production domain and deployment URLs) shows Vercel's login wall. On 2026-10-15 the production domain was **public**; on 2026-10-17 and 2026-10-18 every probed path (production and previews) redirected to Vercel login (OPEN_DECISIONS D-40). |
| The deployed commit is the intended one | Vercel → Deployments → Production shows the expected commit SHA from `main` (2026-10-17: `4cfa0b9`, the PR #4 merge). |
| Backend reachable from the frontend | Signed-in dashboard loads (not "We can't load your account"). |
| Database migrated under the runbook | `docs/SUPABASE_MIGRATION_RUNBOOK.md` evidence recorded (D-26). |
| Custom SMTP verified | A real reset email arrives at a non-member address. |
| Chat disabled for real users | `CHAT_ENABLED` unset/false in every real-user environment. |
| Clinical, legal and security gates | OPEN_DECISIONS §I (G-1 … G-11). |

---

## 1. Vercel (frontend) **[approval for every change to a live project]**

- **Project:** Root Directory `frontend`; Framework Next.js; Node.js **22.x**.
- **Deployment Protection:** **All Deployments + Vercel Authentication** until public
  release. *Standard Protection leaves production domains public.*
- **Production branch:** `main` only. Do not track a feature branch for production.
- **Environment variables** (set per environment: Production and Preview separately):

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser-safe | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser-safe | `sb_publishable_…` only, never a secret key. |
| `SITE_URL` | server | Exact HTTPS origin users use, no trailing slash. Links in auth emails point here; with `https://` the recovery cookie is `Secure`. |
| `API_BASE_URL` | server | The Vercel backend project's HTTPS URL (§2). |
| `API_PROTECTION_BYPASS` | **server secret** | Only if the backend project is protected: its "Protection Bypass for Automation" secret. Never `NEXT_PUBLIC_`. |
| `RECOVERY_MARKER_SECRET` | **server secret** | ≥ 32 random bytes, base64url, mark *Sensitive*, a different value per environment. Generate locally: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Without it, password reset is disabled (fails closed). Rotating it invalidates resets in progress. |

- `NEXT_PUBLIC_*` values are inlined at build time: redeploy after changing them.
- **Rollback:** Vercel → Deployments → *Instant Rollback* to the previous production
  deployment. **Kill switch for password reset:** remove `RECOVERY_MARKER_SECRET` and
  redeploy (no reset emails are sent; reset pages refuse).

## 2. Vercel (FastAPI backend, separate project) **[approval before creating or deploying]**

Hosting decision (2026-10-19, D-45): **Vercel Hobby only, $0.** The paid Render plan is
cancelled, and `render.yaml` has been removed (it remains in Git history). The backend
runs as a Vercel Python Function, from the same repository as the frontend but as a
second project.

**Already in the repository** (`backend/`):

| File | What it does |
|---|---|
| `pyproject.toml` | Dependencies, and `[tool.vercel] entrypoint = "app.main:app"`. |
| `.python-version` | Python 3.12, matching the Docker image and CI. |
| `vercel.json` | Region `dub1` (Dublin, next to the Ireland database); `maxDuration` 30 s; tests and migrations excluded from the bundle. |
| `.vercelignore` | Never uploads `.env*`, `.venv`, tests, migrations or caches. |

The Linux dependency bundle measures 99 MB, against a 500 MB limit.

**Database connection on Vercel:**
- Connect as `app_backend`, the least-privilege role (D-46), through Supabase's
  **transaction pooler** (port 6543), which Supabase recommends for serverless.
  Prepared statements are already disabled.
- Each instance keeps a pool of 1 connection plus 2 overflow, detected automatically on
  Vercel.
- TLS is **verify-full** against Supabase's root CA, bundled in
  `app/core/certs/supabase-root-2021.crt` with its SHA-256 pinned in a test. This was
  checked read-only against both real poolers on 2026-10-19; the system CA store fails
  against them, so `sslmode=require` alone would not verify the server.

### 2.1 Create the backend project (founder, Vercel dashboard)

1. Vercel → **Add New → Project** → import `AbdallahYehya1/AI-WellnessEgy`.
2. **Root Directory:** `backend`. Framework preset: **FastAPI**, or "Other" if FastAPI
   isn't listed. Keep the default build settings.
3. **Environment variables** (Production scope only):

   | Variable | Value |
   |---|---|
   | `ENVIRONMENT` | `production`. Chat stays off. |
   | `SUPABASE_URL` | `https://xchigpviedftrkxldclk.supabase.co` |
   | `DATABASE_URL` | **Secret.** The contents of `~/aiwe-secrets/backend_database_url`, written by `python -m app.ops.backend_role --apply` (D-46). Never the `postgres` owner URL. |
   | `LOG_LEVEL` | `INFO` |

4. Deploy. Vercel Hobby is free and needs no card. Check that the project shows the
   **Hobby** plan.
5. **Deployment Protection** for this project, choose one:
   - **Protected:** All Deployments + Vercel Authentication, plus **Protection Bypass for
     Automation**. Put that secret in the *frontend* project as `API_PROTECTION_BYPASS`;
     it's server-only and never `NEXT_PUBLIC_`.
   - **API-only exposure:** leave the backend unprotected. Every data endpoint already
     requires a verified Supabase token; `/health` and `/consents/current` are the only
     public endpoints.
6. Verify against the backend's HTTPS URL:
   - `/health` returns `{"status":"ok"}`;
   - `/docs`, `/openapi.json` and `/redoc` return 404;
   - `/me` returns 401 with no token and 401 with a forged one;
   - the logs show `application_startup` with `database_configured: true` and no secrets.

### 2.2 Connect the frontend (founder, Vercel dashboard)

1. Frontend project → Settings → Environment Variables (**Production**):
   - `API_BASE_URL`: the backend's HTTPS URL;
   - `API_PROTECTION_BYPASS`: only if the backend is protected.
2. Redeploy the frontend. Variable changes need a new deployment.
3. `frontend/vercel.json` pins the frontend's server functions to `dub1` too, so auth and
   API calls stay in Europe.

**Rollback / kill switch:** delete or pause the backend project's production deployment
(the frontend then shows "We can't load your account"), or roll back to a previous
deployment in Vercel. To revoke database access entirely, re-run `--apply` (new password)
or drop the role (SUPABASE_MIGRATION_RUNBOOK §9).

**Database outages:** connections time out after 3 seconds, and an exhausted pool waits
at most 3 seconds. Both return the standard 503, and only the error type is logged.

## 3. Supabase Auth **[approval for every settings change]**

Read-only check first (dashboard → Authentication):

- **URL Configuration:** Site URL = the production HTTPS origin; Redirect URLs include
  `<SITE_URL>/auth/confirm**` for each environment in use. Do not remove entries other
  environments depend on.
- **Email templates:** confirmation and recovery use `{{ .ConfirmationURL }}` (the app
  supports both the PKCE `code` and `token_hash` formats).
- **Rate limits:** review the email and token limits.
- **Sessions:** JWT expiry (shorter limits how long a stolen access token works; global
  sign-out does not revoke already-issued access tokens). *Secure password change*
  requires re-authentication only for sessions older than 24 hours.
- Do **not** enable "require current password" without testing recovery: a user resetting
  a forgotten password doesn't know it.

## 4. Supabase PostgreSQL **[separate approval per migration run]**

- Follow `docs/SUPABASE_MIGRATION_RUNBOOK.md` exactly (verify target, backup, apply,
  verify, record evidence).
- Order: `0001` → `0002` (needed for profiles, consent, mood) → `0003` (chat tables;
  only when chat testing on that database is approved).
- Confirm a restorable backup exists first (point-in-time recovery depends on the plan).

## 5. Email for Supabase Auth **[approval before any SMTP change]**

**Status at $0: BLOCKED for arbitrary addresses (D-49).** Resend's test domain only reaches the
account owner's address, and a verified sending domain needs a domain you own. Until then,
Supabase's built-in email reaches only project-team addresses (about 2 per hour). The Resend
steps below apply once a domain exists.

### 5.1 Resend (with a domain)

1. Resend → Domains: add a sending **subdomain** you control (e.g. `mail.<domain>`) and
   add exactly the DNS records Resend shows (DKIM, SPF/return-path MX). Wait for
   *Verified*.
2. DMARC: `_dmarc.<domain>` TXT, starting with `v=DMARC1; p=none; rua=mailto:<you>`;
   tighten later.
3. Create a Resend API key with **sending access only**, restricted to that domain.
4. Supabase → Authentication → Emails → SMTP Settings: host `smtp.resend.com`, port `465`,
   username `resend`, password = the API key (it lives **only** here), sender
   `no-reply@mail.<domain>` and a sender name.
5. Raise Supabase's email rate limit only as needed; add CAPTCHA (Turnstile) or a Vercel
   Firewall rate-limit rule on `POST /forgot-password` before general release.

## 6. Post-deploy verification

1. Unauthenticated probe: every URL shows the login wall while protected.
2. Sign-up → confirmation email → sign-in → onboarding → consent → dashboard.
3. Password recovery on the HTTPS domain (desktop and phone): request, email, reset,
   old password rejected, new password works, reused link refused.
4. `/chat` returns 404 or "isn't available yet" for real users.
5. Vercel logs (frontend and backend) contain no passwords, tokens, cookies or message text.

## 7. Incident response

- **Account compromise:** Supabase → Authentication → Users → the user → sign out all
  sessions; ask the user to reset their password.
- **Recovery abuse:** remove `RECOVERY_MARKER_SECRET` (kill switch) and redeploy; review
  Supabase auth logs and rate limits.
- **Bad deployment:** Vercel Instant Rollback (either project) to the previous
  commit.
- **Secret exposure:** rotate the secret at its source (Supabase, Vercel, Groq, email provider),
  redeploy, and record the incident.

## 8. Restricted RAG demo on the backend project (D-48) [approval]

The prototype's safety assessor isn't clinical, so the deployed backend runs chat
**only** in curated demo mode:
- only the approved, predetermined questions are accepted (English and Egyptian Arabic,
  plus follow-ups);
- only the listed accounts can use it;
- free text is refused before assessment, retrieval or any provider call.

Backend project → Environment Variables (Production), then redeploy:

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `staging`. Hardened like production; the only difference is that the test-only chat policy is allowed. |
| `CHAT_ENABLED` | `true` |
| `CHAT_SAFETY_POLICY` | `synthetic-test-v0` |
| `CHAT_SIGNING_KEY` | 32+ random characters (generated into a file, never pasted in chat) |
| `CHAT_DEMO_CURATED` | `true` |
| `CHAT_DEMO_ALLOWED_USERS` | the test accounts' emails, comma-separated |
| `CHAT_PROVIDER` | `fake` (scripted quotes) or `groq` (D-47) |
| `CHAT_EXTERNAL_PROVIDER_APPROVED`, `GROQ_API_KEY`, `GROQ_MODEL` | only for Groq, after D-47 |

Migrations `0003` and `0004` and the source ingestion must be done first (migration
runbook section 11).

## 9. Free email: dedicated Gmail via Supabase custom SMTP

Google documents `smtp.gmail.com`, port 587 (TLS) or 465 (SSL), signing in with the
full address and an **App Password**. App Passwords need 2-Step Verification, and are
unavailable with Advanced Protection, with security-key-only 2-Step Verification, or on
work and school accounts.

Supabase → Authentication → Emails → SMTP Settings:

| Field | Value |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `587` |
| Username | the full Gmail address |
| Password | the App Password (entered only there) |
| Sender | the same Gmail address |

After saving, Supabase emails any address, 30 per hour by default. Then turn **Confirm
email** back on.

This is suitable for controlled testing only, because Gmail limits daily sending. Do not
count "settings saved" as delivery: verify with a real confirmation email and a real
reset email.

## 10. Production restricted RAG demo (supersedes the staging setup in section 8)

The backend stays `ENVIRONMENT=production`. Production never runs `synthetic-test-v0`.
The demo uses its own policy, `curated-educational-demo-v1`, which:
- authorises generation only for the reviewed, predefined questions;
- is assessed by `CuratedPromptAssessor`, which never interprets free text;
- is allowed in production only with `CHAT_DEMO_CURATED=true` and a non-empty
  allow-list.

Free text is refused before assessment, retrieval or any provider call.

Backend project → Environment Variables (Production), then **Redeploy**:

| Variable | Value |
|---|---|
| `CHAT_ENABLED` | `true` |
| `CHAT_SAFETY_POLICY` | `curated-educational-demo-v1` |
| `CHAT_SIGNING_KEY` | contents of `~/aiwe-secrets/chat_signing_key` |
| `CHAT_DEMO_CURATED` | `true` |
| `CHAT_DEMO_ALLOWED_USERS` | your Supabase user id (Authentication → Users → your row → UID), comma-separated if more than one |
| `CHAT_PROVIDER` | `fake` (scripted quotes, labelled "no AI model") |

Leave `ENVIRONMENT=production`. Any unsafe combination makes the backend refuse to start
chat:
- curated policy without curated mode;
- curated mode without an allow-list;
- `synthetic-test-v0` in production;
- no signing key.

The rest of the API keeps working in every case.

## 11. Supabase Auth: URL configuration and email templates

Authentication → URL Configuration:
- Site URL: `https://ai-wellness-egy.vercel.app`
- Redirect URLs: add `https://ai-wellness-egy.vercel.app/**`

Authentication → Emails → Templates. Replace the link in each template:

- **Confirm signup:**
  ```html
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
  ```
- **Reset password:**
  ```html
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset your password</a>
  ```

Why: the token-hash link is verified by our `/auth/confirm` route in any browser or on
any device. Recovery is decided by Supabase's verified `type=recovery`, never by `next`.

Even without these changes, links that land on the home page are now forwarded to
`/auth/confirm`. The default code-based link only works in the browser that requested
the email, though.

Expected results:
- **Confirmation:** `/sign-in` with "Your email address is confirmed. Sign in to
  continue."
- **Recovery:** `/reset-password`. After saving: `/sign-in` with "Your password has been
  updated".

## 12. Chat for every consenting adult, with Groq (current configuration)

Backend project → Environment Variables (Production). Keep `ENVIRONMENT=production`.

| Variable | Value | Notes |
|---|---|---|
| `CHAT_ENABLED` | `true` | Kill switch: `false` turns chat off for everyone |
| `CHAT_SAFETY_POLICY` | `curated-educational-demo-v1` | Never `synthetic-test-v0` (refused in production) |
| `CHAT_SIGNING_KEY` | contents of `~/aiwe-secrets/chat_signing_key` | Required in production |
| `CHAT_DEMO_CURATED` | `true` | Approved questions only; free text refused before any processing |
| `CHAT_DEMO_ACCESS` | `all_consented_adults` | Every signed-in adult with current consent; set `allowlist` to restrict again |
| `CHAT_DEMO_ALLOWED_USERS` | (not needed in `all_consented_adults` mode) | Only read in `allowlist` mode |
| `CHAT_PROVIDER` | `groq` | `fake` = scripted quotes, no AI |
| `CHAT_EXTERNAL_PROVIDER_APPROVED` | `true` | Required for Groq; without it chat stays off (never a silent fallback) |
| `GROQ_API_KEY` | your key | Sensitive; server-only |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Production model on Groq |
| `CHAT_PROVIDER_DAILY_LIMIT` | `300` (default) | All-user ceiling per 24 h while Groq is the provider |
| `CHAT_RATE_LIMIT_PER_MINUTE` | `10` (default) | Per user |

Any missing or unsafe combination turns chat off and logs the reason (`chat_disabled`).
The rest of the API keeps working.

## 13. Saved chat history (migration 0005) — needs founder approval

Nothing here runs until the founder approves the migration and the role grants.
Until then the code runs with history **unavailable** (no `CHAT_HISTORY_KEYS`), and chat
keeps working browser-only.

### What changes

| Change | Detail |
|---|---|
| Migration `0005` | Adds `app.chat_conversations` and `app.chat_messages` (RLS on, `anon`/`authenticated` revoked), and three columns on `app.users` (`chat_history_enabled` default `false`). Additive: no existing row changes. |
| Role grants (`app_backend`) | `chat_conversations`: SELECT, INSERT, UPDATE, DELETE. `chat_messages`: SELECT, INSERT, DELETE. Everything else unchanged. |
| Backend env | `CHAT_HISTORY_KEYS` = contents of `~/aiwe-secrets/chat_history_keys` (Sensitive). Optional `CHAT_HISTORY_RETENTION_DAYS` (default 90). |

### Steps (owner connection in `backend/.env`, from `backend/`)

1. **Backup.** Supabase Dashboard → Database → Backups: confirm today's daily backup exists.
   The free plan has daily backups only, with no point-in-time recovery. Also take a schema-only
   dump if `pg_dump` is available: `pg_dump --schema-only --schema=app "$DATABASE_URL" > app-schema-before-0005.sql`.
2. **Check the target**, read-only: `python -m app.ops.check_migration_target`. Expect
   `at_revision_0004`, RLS on and no Data API access.
3. **Migrate:** `alembic upgrade head`. Then rerun step 2 and expect `at_revision_0005` and
   `tables_match_revision: true`.
4. **Grants:** `python -m app.ops.backend_role --print-sql` (review), then
   `python -m app.ops.backend_role --grants-only`. This keeps the existing password,
   so the deployed backend keeps working.
5. **Verify as the role:** `python -m app.ops.backend_role --verify`. Expect `grant_set: 0005`
   and `problems: []`.
6. **Key:** add `CHAT_HISTORY_KEYS` to the backend project (Production, Sensitive) and
   redeploy. Keep a second copy of the key in a password manager. **Losing every key makes
   saved chats unreadable; there is no recovery.**
7. **Check:** `/chat/config` reports `history.available: true` for a signed-in test account.

### Rollback

- **Turn history off without touching data:** remove `CHAT_HISTORY_KEYS` and redeploy.
  Chat continues browser-only. Saved rows stay encrypted and unreadable until the key returns.
- **Remove the feature:** `alembic downgrade 0004` drops both tables and the three user columns,
  which **deletes all saved chats**. Then `python -m app.ops.backend_role --grants-only`
  re-applies the 0004 grant set.

### Key rotation

Generate a new key and set `CHAT_HISTORY_KEYS="k2:<new>,k1:<old>"`. New writes use `k2`, and both
keys can decrypt. Remove `k1` only after every row encrypted with it has expired (90 days) or
been deleted. Rows still encrypted with a removed key show as empty text.

## 14. Public production access (no Vercel login for visitors)

The app is meant to be public: anyone can open the homepage, register, sign in and reset a
password. Personal data stays private through Supabase authentication, the consent gate
and the backend's per-user ownership checks, not through Vercel's login wall.

**Setting** (Vercel dashboard, frontend project `ai-wellness-egy` → Settings → Deployment
Protection): set *Vercel Authentication* to **Standard Protection**. Production domains,
including `ai-wellness-egy.vercel.app`, become public. Preview deployments and the
generated per-deployment URLs stay behind Vercel login. Don't use "Only Production
Deployments" or switch protection off. On Hobby this costs nothing. The backend project's
API already answers publicly and authenticates every data endpoint itself.

**Check before and after:**

| Check | How |
|---|---|
| Public pages load without a Vercel account | Incognito: `/`, `/sign-up`, `/sign-in`, `/forgot-password` return 200, with no redirect to `vercel.com/sso-api` |
| Signed-in pages stay protected | Incognito: `/dashboard`, `/chat`, `/history` redirect to `/sign-in` |
| API data needs a valid token | `/me`, `/mood/history`, `/chat/*` return 401 without a token |
| Other users' data | Backend tests `test_mood`, `test_profile`, `test_consent` and `test_chat_history` (cross-account cases): another account's data answers 404 or is never listed |
| Abuse and cost limits | 10 chat messages per user per minute; `CHAT_PROVIDER_DAILY_LIMIT` (60) per day for everyone; Supabase Auth's built-in signup and e-mail rate limits; e-mail confirmation required |
| No secrets in the browser | Built JavaScript contains only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key |
| Previews still protected | A preview deployment URL still redirects to Vercel login |

## 15. Ten assistants, provider context and Daily Reflection (migration 0006) — needs founder approval

Nothing here runs until the founder approves it. **Order matters:** the new backend reads
the 0006 columns, so migrate, apply grants and ingest *before* merging. The current
production code keeps working on a 0006 database, because every new column has a default
or is nullable.

### What changes

| Change | Detail |
|---|---|
| `knowledge_sources.domains` | text[] (checked against the 10 assistant ids, GIN index). Backfill: existing sources become `emotional`; CDC activity and sleep and NIMH caring get a second domain. |
| `chat_conversations.assistant_id` | varchar(40), default `emotional`. Existing chats become Emotional Wellbeing chats. |
| `chat_messages.query_enc` | Nullable. The encrypted text the provider received for that turn. |
| `mood_checkins` | `mood_score` nullable; `emotions`, `factors`, `note_enc` (unused), `entry_version` (default 1). Old rows are unchanged. |
| `users.chat_context_consent_version` / `_consented_at` | Nullable. NULL means not opted in to provider context (D-59), which is everyone at first. |
| `chat_rate_events.tokens` | Nullable integer, at least 0. Feeds the shared token budget. |
| Role grants (`app_backend`) | The 0005 set plus **`UPDATE (tokens)` on `chat_rate_events`** (column only). Must be re-applied. |
| Knowledge | 64 licence-checked sources (598 passages). Production today has the original curated set; expect about 54 `new` and 10 `unchanged`. |

### Backend environment (Vercel backend project, Production)

| Variable | Value | Notes |
|---|---|---|
| `CHAT_CONTEXT_MODE` | `minimized` | Only if the founder approves D-59. Users still have to opt in one by one. Leave unset to keep everyone on `structured`. |
| `CHAT_DAILY_TOKEN_BUDGET` | `150000` | Shared across all assistants. Below Groq's published 200K tokens per day for gpt-oss-20b. |
| `CHAT_USER_DAILY_LIMIT` | `25` (default) | Per account per 24 hours. |
| `CHAT_PROVIDER_DAILY_LIMIT` | `60` (current) | Global request cap; unchanged. |

Groq: enable **Zero Data Retention** in the Groq console (Data Controls) before turning on
`minimized`. Only the account owner can do this.

### Rehearsal (done 2026-10-24, local Docker stack, final migration)

1. Downgraded to 0005 and inserted legacy rows: two 1–5 check-ins (one with a note), an
   encrypted conversation and message, a rate event, and a user with saved history on.
2. Upgraded to 0006. The md5 fingerprints of the mood rows and message ciphertext were
   identical before and after.
3. Defaults were correct: `entry_version` 1, conversation `emotional`, context consent
   NULL, saved-history opt-in kept, tokens NULL.
4. All 64 sources were ingested and the full e2e suite passed (35 tests), including all ten
   assistants answering and the context-consent flow.
5. Role grants: `tests/test_backend_role.py` applies the 0006 set to a real Postgres and
   checks the role can UPDATE `tokens` but not `user_id`.

### Steps (owner connection in `backend/.env`, from `backend/`)

1. **Backup.** Supabase Dashboard → Database → Backups: confirm today's daily backup. Also
   `pg_dump --schema-only --schema=app "$DATABASE_URL" > app-schema-before-0006.sql`, plus
   row counts of `users`, `mood_checkins`, `chat_conversations` and `chat_messages` for the
   after-check.
2. **Check the target:** `python -m app.ops.check_migration_target`. Expect
   `at_revision_0005`.
3. **Migrate:** `alembic upgrade head`, then rerun step 2. Expect `at_revision_0006` and
   `tables_match_revision: true`. Compare the row counts.
4. **Grants:** `python -m app.ops.backend_role --print-sql` (review it), then
   `python -m app.ops.backend_role --grants-only` (keeps the password). Then
   `python -m app.ops.backend_role --verify`: expect `grant_set: 0006`,
   `column_updates: {tokens: true, user_id: false}` and `problems: []`.
5. **Ingest:** `python -m app.knowledge.ingest app/knowledge/sources`. Expect 64 documents.
6. **Environment:** set the variables above, as decided.
7. **Merge** the PR. Vercel deploys both projects. Confirm both deployments show the
   merge commit.
8. **Smoke test** with the authorized test accounts:
   - each of the ten assistants answers a question with sources and a follow-up;
   - saved history works per assistant;
   - another account can't see the chats;
   - Daily Reflection saves and insights load;
   - old 1–5 check-ins and old chats are still there.

### Rollback

- **Code only:** revert the merge. The old code runs on a 0006 database.
- **Provider context only:** unset `CHAT_CONTEXT_MODE`. Everyone returns to `structured`
  at the next message.
- **Schema:** `alembic downgrade 0005`. This **deletes Daily Reflection rows**, assistant
  ids, context consents and token counts, and makes `mood_score` required again. Then run
  `python -m app.ops.backend_role --grants-only` for the 0005 grants. Old check-ins and
  chats are kept.
