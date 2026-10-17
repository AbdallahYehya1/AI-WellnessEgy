# End-to-end tests (Playwright)

Browser tests for the integrated app: registration, onboarding, consent, check-in,
progress, settings, chat (test mode), sign-out, password recovery and its security
regressions, plus accessibility (axe, WCAG 2.2 A/AA rules), responsive layout
(320–1440px), touch targets, Arabic/English and light/dark.

They run **locally** against a mock auth server and synthetic data only. They are
not part of CI yet, and passing them is **not** a verification of the real Supabase
project or of any clinical behaviour.

## Run

From the repository root:

```bash
# 1. API + Postgres + mock auth (port 54321). Chat in test mode is optional.
export API_PORT=8001 DB_PORT=5434 CHAT_ENABLED=true CHAT_SAFETY_POLICY=synthetic-test-v0
docker compose -p aiwe-e2e -f docker-compose.yml -f frontend/e2e/compose.e2e.yml up -d --build
docker compose -p aiwe-e2e exec api python -m app.knowledge.ingest app/knowledge/fixtures

# 2. Frontend production build pointed at the mock (from frontend/)
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_mock-e2e-only
export SITE_URL=http://localhost:3100 API_BASE_URL=http://127.0.0.1:8001
export RECOVERY_MARKER_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
npm run build && npx next start -p 3100

# 3. Tests (system Edge by default; PLAYWRIGHT_CHANNEL=chrome to change)
npm run e2e
```

Screenshots are written to `test-results/screens/` (git-ignored) for visual review.

`e2e/mock/mock_gotrue.py` is a **test-only** stand-in for Supabase Auth. It keeps
everything in memory, generates its own signing key at start-up and is never used
outside these tests.
