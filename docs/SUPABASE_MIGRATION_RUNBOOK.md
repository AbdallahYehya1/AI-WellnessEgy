# Runbook: applying migrations 0001–0003 to the real Supabase database

Status: **NOT EXECUTED.** This needs the founder's explicit go-ahead for the exact
operation and a server-only `DATABASE_URL` (OPEN_DECISIONS D-26). No step below has been
run against Supabase. The procedure was rehearsed only on local and CI Postgres 17 (§7).

**Recommended for controlled testing: a staged run.** Apply `0001` and `0002` only
(`alembic upgrade 0002`): they are all the signed-in app needs while chat is off.
Apply `0003` (chat tables) later, under its own approval, only if chat testing on the
real database is approved. See §8.

Revisions to apply:
- `0001_profile_consent_audit`: creates schema `app`, `users`, `consents` and
  `audit_events`, RLS, role revokes, and the append-only trigger.
- `0002_mood_checkins`: creates `mood_checkins` and renames five CHECK constraints from
  `0001`.

---

## 0. Rules

- **Never** paste the connection string into chat, tickets, commits, shell history you
  share, or the frontend. Keep it only in `backend/.env`, which is git-ignored (verify
  with `git check-ignore backend/.env`), or in a secret store.
- **Never** assume the configured database is the intended one. Confirm the target
  (§2) before every run.
- Run from a trusted machine, on the commit that will be deployed (normally `main`, after
  PR #1 is merged).
- Run the migration as the project's `postgres` role (Supabase's default owner role). The
  app relies on it owning the `app` schema.

## 1. Prerequisites

1. PR #1 is merged and CI is green on `main`. Check out that exact commit: `git status`
   should be clean and `git log -1` should show the expected hash.
2. Backend dependencies are installed (`cd backend && pip install -e ".[dev]"`).
3. **A backup or restore point exists.** In the Supabase dashboard, open Database →
   Backups and confirm a recent backup, or enable point-in-time recovery if your plan has
   it. Note the timestamp.
4. Get the connection string from the dashboard: **Connect** → *Session pooler* (port
   5432) or *Direct connection*. The transaction pooler also works, because the app
   disables prepared statements, but a session or direct connection is recommended for
   DDL.
5. Add it to `backend/.env` as `DATABASE_URL=postgresql://…`. Don't echo it.

## 2. Verify the target (read-only)

Run from `backend/`. These commands print no credentials.

```bash
# Which host and database will be used? (password masked)
python -c "from app.core.config import Settings; from sqlalchemy.engine import make_url; \
from app.core.db import sqlalchemy_url; u=make_url(sqlalchemy_url(Settings().database_url.get_secret_value())); \
print(u.host, u.port, u.database, u.username)"

# Current revision. Expect no output (a fresh database) before the first run.
alembic current
```

**Stop** if:
- the host isn't your Supabase project's (`…supabase.com` or `db.<project-ref>.supabase.co`);
- `alembic current` shows a revision you didn't expect;
- an `app` schema already exists with unexpected tables. Check with:
  ```bash
  python -c "from sqlalchemy import create_engine,text; from app.core.config import Settings; \
  from app.core.db import sqlalchemy_url; e=create_engine(sqlalchemy_url(Settings().database_url.get_secret_value())); \
  print(e.connect().execute(text(\"select table_name from information_schema.tables where table_schema='app'\")).all())"
  ```

## 3. Apply

```bash
alembic upgrade head
```

Expected output, and nothing else at INFO level:
```text
Running upgrade  -> 0001, M3: users (profile), consents and audit_events in the `app` schema.
Running upgrade 0001 -> 0002, M4: mood_checkins in the `app` schema.
```

## 4. Verify the result

```bash
alembic current            # expect: 0002 (head)
alembic upgrade head       # must be a no-op (prints no "Running upgrade")
```

Then confirm the schema. Run these in the dashboard's **SQL editor** as `postgres`; they
are read-only:

```sql
-- 1. Tables (expect: alembic_version, audit_events, consents, mood_checkins, users)
select table_name from information_schema.tables where table_schema = 'app' order by 1;

-- 2. RLS is on for all four app tables (expect relrowsecurity = true)
select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
where nspname = 'app' and relkind = 'r' and relname <> 'alembic_version' order by 1;

-- 3. The Data API roles have no access (expect every value false)
select r, has_schema_privilege(r, 'app', 'USAGE') as schema_usage,
       has_table_privilege(r, 'app.users', 'SELECT') as users_select,
       has_table_privilege(r, 'app.mood_checkins', 'SELECT') as mood_select
from unnest(array['anon', 'authenticated']) as r;

-- 4. Constraint names are the corrected ones (no "ck_users_ck_users_…")
select conrelid::regclass, conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where nspname = 'app' and contype = 'c' order by 1, 2;

-- 5. The append-only trigger exists
select tgname from pg_trigger where tgrelid = 'app.audit_events'::regclass and not tgisinternal;
```

Finally, in the dashboard go to **Settings → API → Exposed schemas** (Data API). Confirm
that `app` is **not** listed. Only `public` and `graphql_public` are exposed by default.

## 5. If it fails

- Alembic runs both revisions in **one transaction** on Postgres (transactional DDL). If
  any statement fails, the whole upgrade rolls back. `alembic current` then shows no
  revision, and no `app` tables remain.
  - **Exception:** `env.py` creates the empty `app` schema *before* the transaction
    starts. An empty `app` schema can therefore remain. It's harmless; the next run reuses
    it.
- **If `0002` fails on `RENAME CONSTRAINT`:** the database was not created by this
  repository's `0001`, or someone renamed constraints by hand. Don't edit migrations to
  force it. Stop, compare names with query 4, and decide on a deliberate fix.
- **If it fails part-way through a manual intervention:** restore from the backup taken in
  §1.3. Don't use `alembic downgrade` on a database that already holds real user data:
  downgrading `0001` drops the consent and audit records.
- Don't retry with different credentials or targets until the cause is understood.

## 6. After a successful run

1. Point the deployed or local API at this `DATABASE_URL` and run the real-Supabase
   end-to-end check: sign in → onboarding → consent → mood check-in → dashboard. Then
   confirm the rows exist under `app.*` in the SQL editor.
2. Record the date, operator, commit hash and the `alembic current` output in
   `docs/IMPLEMENTATION_STATUS.md`, and close the D-26 items.
3. Rotate the database password if it was ever shared outside the secret store.

## 7. Rehearsal evidence (local and CI only, not Supabase)

| Check | Where | Result |
|---|---|---|
| Fresh `0001 → 0002`, exit 0 | Docker Compose Postgres 17, 2026-10-02 | Pass |
| Second `alembic upgrade head` is a no-op; `alembic current` = `0002 (head)` | same | Pass |
| No tables in `public`; RLS on for all four app tables | same | Pass |
| Simulated Supabase `anon`/`authenticated` roles get no access | pytest (`test_supabase_data_api_roles_get_no_access`) | Pass |
| Downgrade to `0001` restores its names; re-upgrade works | pytest | Pass |
| Model/migration diff is empty; constraint names pinned | pytest | Pass |
| Migration in CI (Compose `migrate` exit 0) | PR #1 run 36959093412 | Pass |

## 8. M8 additions (2026-10-17): staged run, 0003, backup and smoke tests

### 8.1 Dependencies

| Revision | Depends on | Creates | Needed for |
|---|---|---|---|
| `0001` | — | schema `app`; `users`, `consents`, `audit_events`; RLS; Data API role revokes; append-only trigger | sign-in profile, consent |
| `0002` | `0001` | `mood_checkins`; renames five `0001` CHECK constraints | mood check-in, progress |
| `0003` | `0002` | `knowledge_sources`, `knowledge_chunks` (tsvector + GIN), `safety_events`, `chat_rate_events`; RLS; revokes | chat prototype only |

All three were applied in order on fresh Postgres 17 in CI (Docker job) and locally
(2026-10-15, `aiwe-e2e`); downgrade/re-upgrade is covered by the backend tests.

### 8.2 Readiness checks (read-only, before any run)

1. The approved commit is checked out (`main` after PR #4, CI green); `git status` clean.
2. §2 target verification passes (host is the Supabase project; `alembic current` empty;
   no unexpected `app` tables). One read-only command covers checks 2 and 4. Enter the
   connection string first as described in §8.7.
   ```bash
   cd backend
   python -m app.ops.check_migration_target --target-only   # parses only; no connection
   python -m app.ops.check_migration_target                 # read-only inspection
   ```
   **Before connecting**, the checker parses `DATABASE_URL` and refuses to connect
   (exit code 3) unless:
   - the host is `*.pooler.supabase.com`;
   - the port is `5432` (the session pooler);
   - the user `postgres.<ref>` matches the project in `SUPABASE_URL`.

   **When connecting**, it:
   - sets the transaction `READ ONLY` and stops unless the server confirms it;
   - runs only `SELECT` statements, then rolls back;
   - never prints the password, and redacts it from connection errors.

   It reports row counts only, never row contents. Expected values before the first run:

   | Field | Expected |
   |---|---|
   | `target.connection_mode` | `session_pooler` |
   | `target.project_ref` | the project in `SUPABASE_URL` |
   | `state` | `fresh`, or `fresh_empty_app_schema` after an earlier failed run |
   | `alembic_revision` | `null` |
   | `app_tables` | `[]` |
   | `public_alembic_version_exists` | `false` |
   | `supabase_roles_present` | `["anon", "authenticated"]` |
   | `can_create_schema` | `true` |

   `auth_users_count` is the number of existing Supabase Auth accounts. The migration
   doesn't touch them, and each one gets its app profile the first time it signs in.

   After §8.4, expect:

   | Field | Expected |
   |---|---|
   | `state` | `at_revision_0002` |
   | `tables_match_revision` | `true` |
   | `rls_enabled` | `true` for all four tables |
   | `data_api_roles_with_app_usage` | `[]` |

   Anything else (`inconsistent`, a `public.alembic_version` table, an existing `app`
   schema with tables): **stop** and review before migrating.
3. Exposed schemas (Settings → API) do not include `app`.
4. The Supabase roles `anon` and `authenticated` exist (the migrations revoke them):
   ```sql
   select rolname from pg_roles where rolname in ('anon', 'authenticated');
   ```
5. No other application writes to an `app` schema in this project.

### 8.3 Backup verification

- Dashboard → Database → Backups: note the latest backup time, or the point-in-time
  recovery window if the plan has it. **Record it before running.**
- **Free plan: there is no downloadable backup.** Supabase's daily backups start on
  Pro (7 days). Supabase advises Free projects to export their own. Before the first
  migration, take a full logical dump yourself (needs Docker; reads the URL from
  `backend/.env`, so it never appears on the command line):
  ```bash
  cd backend
  mkdir -p ~/aiwe-backups
  docker run --rm --env-file .env postgres:17-alpine \
    sh -c 'pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage' \
    > ~/aiwe-backups/before-0002.dump
  ```
  The dump holds Supabase Auth accounts (emails, password hashes). Keep it **outside the
  repository**, don't upload it, and delete it once it's no longer needed. It counts as
  *usable* only after a test restore into a throwaway local `supabase/postgres` container
  succeeds and its row counts match the checker's `auth_users_count`.
- Because `app` does not exist yet, this run only adds objects; `auth.users` and other
  Supabase schemas are not touched. Recovery from a failed first run is therefore
  "nothing to restore" (§5), but take note of the backup anyway.
- Optional schema snapshot without exposing the password (needs Docker; reads the URL from
  `backend/.env` and prints nothing secret):
  ```bash
  cd backend
  docker run --rm --env-file .env postgres:17-alpine sh -c 'pg_dump "$DATABASE_URL" --schema-only --no-owner' > ../schema-before.sql
  ```
  Keep `schema-before.sql` out of git (it contains no data, but stay tidy).

### 8.4 Execution (only after explicit approval of this exact command)

```bash
cd backend
alembic upgrade 0002     # staged run for controlled testing (recommended)
# later, separately approved:
# alembic upgrade 0003
alembic current          # expect: 0002 (or 0003 (head) after the second step)
```

Expected output for the staged run: the two "Running upgrade" lines in §3, nothing else.

### 8.5 Rollback and recovery

- `alembic upgrade 0002` applies `0001` and `0002` in **one** transaction, so a failure
  anywhere rolls back both. The exception is `migrations/env.py`, which first runs
  `CREATE SCHEMA IF NOT EXISTS app` and commits it on its own. A failed first run
  therefore leaves an empty `app` schema, and the checker reports
  `fresh_empty_app_schema`. Rerunning is safe.
- **Before real users exist**, a clean undo is `alembic downgrade base` (drops every `app`
  table; leaves an empty `app` schema). After real users exist, never downgrade `0001`:
  restore from backup instead.
- Undoing only `0003`: `alembic downgrade 0002` drops the chat tables (they hold only
  synthetic knowledge, safety metadata and rate-limit rows; no message text).

### 8.6 Post-migration smoke tests

1. §4 SQL checks (tables, RLS, Data API roles, constraint names, trigger). After `0003`,
   query 1 also lists the four chat tables and query 2 shows RLS on them.
2. API (Render, `ENVIRONMENT=production`): `GET /health` → `{"status":"ok"}`;
   `GET /me` without a token → `401`; `GET /docs` → `404`.
3. Signed-in journey on the protected Vercel deployment: sign in → onboarding → consent →
   check-in → dashboard shows the check-in → Settings shows the consent version.
4. SQL: one row in `app.users` for the tester, consent and mood rows owned by it, audit
   events with metadata only.
5. Record operator, time, commit, `alembic current` and results in
   `docs/IMPLEMENTATION_STATUS.md`.

### 8.7 Entering `DATABASE_URL` safely (founder)

1. Supabase dashboard → the project (`xchigpviedftrkxldclk`) → **Connect**. Under
   **Session pooler**, copy the URI. It has the form
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-<n>-<region>.pooler.supabase.com:5432/postgres`.
   Don't use the direct connection (IPv6-only) or the transaction pooler (port 6543).
2. Open `backend/.env` in an editor (it is git-ignored) and add one line:
   `DATABASE_URL=<that URI with the real database password>`. Replace `[YOUR-PASSWORD]`
   **including the square brackets**; a password left wrapped in brackets fails with
   `password authentication failed` (seen on 2026-10-18). If the password contains
   `@ : / ? # %`, URL-encode it. Repeated failed logins can get your IP temporarily
   banned by the pooler, so fix the line before trying again. Make sure `SUPABASE_URL=https://<ref>.supabase.co` is also
   set; the checker compares the two.
3. Never paste the URI into chat, a terminal command line, a ticket or a screenshot.
4. Run `python -m app.ops.check_migration_target --target-only` and confirm the host,
   `project_ref` and `session_pooler`. Then run it without the flag.
5. Remove the line from `backend/.env` once the migration work is finished, unless local
   work against the real database is intended.

### 8.8 Rehearsal on Supabase's Postgres image (2026-10-18, local, throwaway)

This is not the real project. `supabase/postgres:17.11.0.003` (Postgres 17.11) has the
`anon` and `authenticated` roles, and its `postgres` role is not a superuser, as on real
Supabase.

| Step | Result |
|---|---|
| Checker before | `fresh`; roles present; `can_create_schema: true` |
| `alembic upgrade 0002` | `at_revision_0002`; 4 tables; RLS on for all 4 |
| `anon` / `authenticated` selecting `app.users`, `app.mood_checkins` | `InsufficientPrivilege` (denied) |
| `alembic downgrade base` | `fresh_empty_app_schema` |
| Re-upgrade | `at_revision_0002` |
| Forced failure in `0002` (a pre-existing table) | `DuplicateTable`; `0001`'s tables rolled back too |
