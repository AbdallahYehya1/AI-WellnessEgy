# Deployment runbook (Vercel · Render · Supabase · Resend)

Status: **preparation only.** Nothing in this document has been applied to a live
environment by engineering. Every step marked **[approval]** needs the founder's
explicit approval before it is performed. Never put a real secret in this
repository, in a `NEXT_PUBLIC_` variable, or in chat.

Architecture: Vercel hosts the Next.js frontend, Render hosts the FastAPI backend,
Supabase provides authentication and PostgreSQL, and Resend sends authentication
email through Supabase SMTP. Each is configured independently.

---

## 0. Release gates (all must hold before real users)

| Gate | How to verify |
|---|---|
| Production domain is protected until release | From a browser that is **not** signed in to Vercel, every URL (production domain and deployment URLs) shows Vercel's login wall. As of 2026-10-15 the production domain was **public** (see OPEN_DECISIONS D-40). |
| The deployed commit is the intended one | Vercel → Deployments → Production shows the expected commit SHA from `main`. |
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
| `API_BASE_URL` | server | The Render backend URL (§2). |
| `RECOVERY_MARKER_SECRET` | **server secret** | ≥ 32 random bytes, base64url, mark *Sensitive*, a different value per environment. Generate locally: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Without it, password reset is disabled (fails closed). Rotating it invalidates resets in progress. |

- `NEXT_PUBLIC_*` values are inlined at build time: redeploy after changing them.
- **Rollback:** Vercel → Deployments → *Instant Rollback* to the previous production
  deployment. **Kill switch for password reset:** remove `RECOVERY_MARKER_SECRET` and
  redeploy (no reset emails are sent; reset pages refuse).

## 2. Render (FastAPI backend) **[approval before creating or deploying]**

- Web Service, root `backend`, Python 3.12 (`PYTHON_VERSION=3.12`).
- Build: `pip install .` · Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Health check path: `/health`.
- Environment (Render secrets, never committed):

| Variable | Notes |
|---|---|
| `ENVIRONMENT` | `production` disables `/docs` and refuses the synthetic chat policy. |
| `LOG_LEVEL` | `INFO`. |
| `SUPABASE_URL` | Project URL; tokens are verified against its JWKS. |
| `DATABASE_URL` | Supabase **session pooler** connection string (the direct host is IPv6-only; Render egress is IPv4). |
| `CHAT_ENABLED` | Leave unset/false for real users. |

- No service-role key is needed. No CORS configuration is needed: only the Next.js
  server calls the API.
- Free Render instances sleep; the first request can exceed the frontend's API
  timeout and users see "We can't load your account". Use a paid instance for users.
- Migrations are **not** run by the service start command (§4).

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

## 5. Resend (SMTP for Supabase Auth email) **[approval before going live]**

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
5. Vercel and Render logs contain no passwords, tokens, cookies or message text.

## 7. Incident response

- **Account compromise:** Supabase → Authentication → Users → the user → sign out all
  sessions; ask the user to reset their password.
- **Recovery abuse:** remove `RECOVERY_MARKER_SECRET` (kill switch) and redeploy; review
  Supabase auth logs and rate limits.
- **Bad deployment:** Vercel Instant Rollback; Render → Manual Deploy of the previous
  commit.
- **Secret exposure:** rotate the secret at its source (Supabase, Resend, Render, Vercel),
  redeploy, and record the incident.
