"""M3: users (profile), consents and audit_events in the `app` schema.

Security notes:
- Tables live in `app`, which Supabase's Data API does not expose by default.
- On Supabase (where the `anon`/`authenticated` roles exist) all privileges on
  the schema are revoked from those roles and RLS is enabled with no
  policies, so even an accidental exposure returns nothing. The backend
  connects as the table owner and is unaffected.
- audit_events is append-only: UPDATE and DELETE raise an error.

Revision ID: 0001
Revises:
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
TABLES = ("users", "consents", "audit_events")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("supabase_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=True),
        sa.Column(
            "goals", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column(
            "preferences",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "char_length(display_name) BETWEEN 1 AND 50", name="ck_users_display_name_length"
        ),
        sa.CheckConstraint("jsonb_typeof(goals) = 'array'", name="ck_users_goals_is_array"),
        sa.CheckConstraint(
            "jsonb_typeof(preferences) = 'object'", name="ck_users_preferences_is_object"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("supabase_user_id", name="uq_users_supabase_user_id"),
        schema=SCHEMA,
    )

    op.create_table(
        "consents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("consent_type", sa.String(length=16), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "consent_type IN ('required', 'optional')", name="ck_consents_consent_type_valid"
        ),
        sa.CheckConstraint(
            "withdrawn_at IS NULL OR consent_type = 'optional'",
            name="ck_consents_withdrawal_only_for_optional",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name="fk_consents_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_consents"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_consents_user_type_recorded",
        "consents",
        ["user_id", "consent_type", "recorded_at"],
        schema=SCHEMA,
    )

    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            [f"{SCHEMA}.users.id"],
            name="fk_audit_events_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_audit_events_actor_created",
        "audit_events",
        ["actor_user_id", "created_at"],
        schema=SCHEMA,
    )

    # Append-only audit log, enforced by the database.
    op.execute(
        f"""
        CREATE FUNCTION {SCHEMA}.forbid_audit_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only';
        END;
        $$;
        CREATE TRIGGER audit_events_append_only
            BEFORE UPDATE OR DELETE ON {SCHEMA}.audit_events
            FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_audit_change();
        """
    )

    # Supabase hardening. Guarded so the migration also runs on plain Postgres
    # (local development and CI), where these roles don't exist.
    for table in TABLES:
        op.execute(f"ALTER TABLE {SCHEMA}.{table} ENABLE ROW LEVEL SECURITY")
    # Written without string interpolation: the schema and role names are fixed.
    op.execute(
        """
        DO $$
        DECLARE role_name text;
        BEGIN
            FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                    EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', role_name);
                    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', role_name);
                END IF;
            END LOOP;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS audit_events_append_only ON {SCHEMA}.audit_events")
    op.execute(f"DROP FUNCTION IF EXISTS {SCHEMA}.forbid_audit_change()")
    op.drop_index("ix_audit_events_actor_created", table_name="audit_events", schema=SCHEMA)
    op.drop_table("audit_events", schema=SCHEMA)
    op.drop_index("ix_consents_user_type_recorded", table_name="consents", schema=SCHEMA)
    op.drop_table("consents", schema=SCHEMA)
    op.drop_table("users", schema=SCHEMA)
