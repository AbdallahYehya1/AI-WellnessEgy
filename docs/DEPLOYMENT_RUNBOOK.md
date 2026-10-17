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
| `API_BASE_URL` | server | The Render backend URL (§2). |
| `RECOVERY_MARKER_SECRET` | **server secret** | ≥ 32 random bytes, base64url, mark *Sensitive*, a different value per environment. Generate locally: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Without it, password reset is disabled (fails closed). Rotating it invalidates resets in progress. |

- `NEXT_PUBLIC_*` values are inlined at build time: redeploy after changing them.
- **Rollback:** Vercel → Deployments → *Instant Rollback* to the previous production
  deployment. **Kill switch for password reset:** remove `RECOVERY_MARKER_SECRET` and
  redeploy (no reset emails are sent; reset pages refuse).

## 2. Render (FastAPI backend) **[approval before creating or deploying]**

`render.yaml` (repository root) is a Blueprint for this service. It is inert until a
Blueprint is created from it in the Render dashboard, and auto-deploy is off.

- **Runtime:** Docker, using `backend/Dockerfile` (Python 3.12-slim, non-root user,
  `uvicorn app.main:app` on port 8000) — the same image CI's Docker job builds.
- **Port:** set `PORT=8000` (Render routes to `$PORT`, default 10000).
- **Health check path:** `/health` (the image also has a Docker `HEALTHCHECK`).
- **Plan / region:** a paid instance (`0.5c-512mb`, formerly "Starter": 0.5 CPU,
  512 MB). As of 2026-10-18 it's listed at **US$7/month**, billed by the second
  (render.com/pricing, render.com/docs/compute-plans). The workspace plan is billed
  separately: **Hobby** is US$0 for one member, and **Pro** is US$25/month flat. Expected
  cost for controlled testing on Hobby is **about US$7/month**, plus bandwidth beyond
  the included allowance. **Confirm the price the dashboard shows before creating the
  service [approval].** Free instances sleep when idle, and their cold start exceeds the
  frontend's 5-second API timeout. Pick the region closest to the Supabase project
  (Frankfurt is offered).
- **Token verification:** the real project signs tokens with **ES256** and publishes the
  key at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (checked 2026-10-18). Render
  therefore needs only `SUPABASE_URL`. Don't set `SUPABASE_JWT_SECRET` there; HS256
  tokens are then refused (`unsupported_algorithm`).
- **Database outages:** connections time out after 3 seconds (`CONNECT_TIMEOUT_SECONDS`)
  and the API answers `503 service_unavailable` with the standard error body. Only the
  error type is logged, never the connection string.
- **Environment** (secrets are `sync: false`, entered in the dashboard, never committed):

| Variable | Notes |
|---|---|
| `PORT` | `8000`. |
| `ENVIRONMENT` | `production`: API docs off, synthetic chat policy refused. |
| `LOG_LEVEL` | `INFO`. |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co`; tokens are verified against its JWKS. |
| `DATABASE_URL` | Supabase **session pooler** string (IPv4; the direct host is IPv6-only). |
| `CHAT_ENABLED` | `false` for real users. |

- **Network:** the service is internet-reachable (Render web services always are); every
  data endpoint requires a verified Supabase token, and `/docs` and `/openapi.json` are
  off in production. No CORS is configured because only the Next.js server calls it.
  Outbound access needed: Supabase (JWKS over HTTPS, Postgres pooler).
- **Verified locally (2026-10-17):** the image run with `ENVIRONMENT=production`,
  `PORT=8000` → `/health` ok and Docker `healthy`; `/docs` and `/openapi.json` 404;
  `/me`, `/mood/history`, `/chat/config` 401 without a token; startup log reports auth and
  database configured.
- **Re-verified on 2026-10-18** with the `main` image (`3dd5941` plus checker changes),
  against the real project's JWKS and a local Supabase-image database at `0002`:
  - uid 10001, Python 3.12.15, Docker `healthy`;
  - `/docs`, `/openapi.json` and `/redoc` 404;
  - `/me`, `/mood/history` and `/chat/config` 401 without a token;
  - a forged ES256 token gets 401 `unknown_key` (the real JWKS was fetched); a forged
    HS256 token gets 401 `unsupported_algorithm`;
  - logs contain only method, path, status, request id and rejection reasons.
- **Do not start it against an unmigrated database:** create the service only after
  §4 is done. Otherwise `/me` returns 500 because the tables are missing.
- **Rollback:** Render → the service → Events → *Rollback* to the previous deploy, or
  *Suspend* the service. The kill switch is suspending it: the frontend then shows
  "We can't load your account", and no data is touched.
- Migrations are **not** run by the service (§4).
- After it is healthy, set Vercel's `API_BASE_URL` to the Render URL and redeploy.

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
