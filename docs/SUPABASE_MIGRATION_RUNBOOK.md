# Runbook: applying migrations 0001 and 0002 to the real Supabase database

Status: **NOT EXECUTED.** This needs the founder's explicit go-ahead and a server-only
`DATABASE_URL` (OPEN_DECISIONS D-26). No step below has been run against Supabase. The
procedure was rehearsed only on local and CI Postgres 17 (§7).

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
