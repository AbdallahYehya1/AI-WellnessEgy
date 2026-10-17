# Real authentication test plan (Supabase, controlled testing)

Status: **NOT RUN.** Every check below needs the real Supabase project, the protected
Vercel deployment, the Render backend and the founder (inbox owner). Automated tests use
a mock auth server and do **not** count as these checks.

Rules: synthetic names only; no real health information; never paste passwords, links,
tokens or cookies into chat, tickets or screenshots; change only the tester's own test
account's password, and only during the recovery checks.

## Prerequisites

| # | Prerequisite | Owner |
|---|---|---|
| P1 | Vercel: All Deployments + Vercel Authentication (verified 2026-10-17 from outside: production and previews redirect to Vercel login) | done |
| P2 | Vercel: production branch `main`; Supabase variables, `SITE_URL`, `API_BASE_URL`, `RECOVERY_MARKER_SECRET` scoped to the environment under test | founder |
| P3 | PR #4 merged; Vercel production deployment of the merge commit, still protected (merged 2026-10-17 as `4cfa0b9`; production serves it; protection re-probed 2026-10-18) | done |
| P4 | Render backend running (`render.yaml`), `ENVIRONMENT=production`, healthy | founder approval |
| P5 | Migrations `0001`–`0002` applied (`docs/SUPABASE_MIGRATION_RUNBOOK.md` §8) | founder approval |
| P6 | Supabase Site URL / Redirect URLs include `<SITE_URL>/auth/confirm**` | founder approval |
| P7 | Email delivery: until custom SMTP (Resend) is verified, only Supabase organization members receive email, about 2 per hour. Use an org-member address. | founder |
| P8 | Tester is signed in to Vercel in the test browser (protection) | tester |

## Checks

| # | Check | Pass criterion |
|---|---|---|
| A1 | Sign up with a new address | "Check your email" page; a confirmation email arrives; its link opens the protected HTTPS domain and lands on onboarding |
| A2 | Sign up again with the same address | Same "Check your email" page; no second account; the original password still signs in |
| A3 | Signed-in visitor opens `/sign-up` | "You already have an account. Continue to your dashboard." |
| A4 | Sign in / wrong password / sign out | Correct password works; wrong one shows "The email or password is incorrect."; sign-out returns to sign-in and protected pages redirect |
| A5 | Onboarding and consent | Profile step (skip or name) → terms (DRAFT notice visible) → check-in |
| A6 | Frontend → backend | Dashboard loads (not "We can't load your account"); check-in saved; progress shows it; Settings shows the consent version |
| A7 | Password recovery | Neutral "sent" message; email arrives; link opens the HTTPS domain; reset form; new password saved; old password rejected; new one works |
| A8 | Recovery edge cases | Reusing the same link → "invalid, expired or already used"; opening it in another browser → same; visiting `/reset-password` while normally signed in → refused |
| A9 | Session revocation (real semantics) | After the reset, a second browser that was signed in loses access at its next token refresh; already-issued access tokens may keep working until they expire (Supabase behaviour, documented) |
| A10 | Session expiry | After removing cookies (or waiting past expiry), protected pages send the tester to sign-in and back after signing in |
| A11 | Logs | Vercel and Render logs contain no passwords, tokens, cookies, emails or message text |
| A12 | Phone | A1, A4 and A7 repeated on a phone browser |

Record results (pass/fail, date, environment, commit) in `docs/IMPLEMENTATION_STATUS.md`.
Only after A1–A12 pass may "real Supabase verified" be claimed.
