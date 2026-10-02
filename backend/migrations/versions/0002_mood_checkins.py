"""M4: mood_checkins in the `app` schema.

Same security posture as 0001: RLS enabled with no policies, and all
privileges revoked from Supabase's `anon`/`authenticated` roles (they are
revoked per table, so a new table needs its own revoke).

Also fixes a naming defect from 0001: the metadata naming convention was
applied on top of explicit CHECK constraint names, producing names such as
`ck_users_ck_users_display_name_length`. Those five constraints are renamed
here (forward-only; 0001 is not edited because it may already be applied).
Names below are wrapped in `op.f()` so the convention is not applied twice.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"

# (table, doubled name created by 0001, intended name)
RENAMED_CHECKS = (
    ("users", "ck_users_ck_users_display_name_length", "ck_users_display_name_length"),
    ("users", "ck_users_ck_users_goals_is_array", "ck_users_goals_is_array"),
    ("users", "ck_users_ck_users_preferences_is_object", "ck_users_preferences_is_object"),
    ("consents", "ck_consents_ck_consents_consent_type_valid", "ck_consents_consent_type_valid"),
    (
        "consents",
        "ck_consents_ck_consents_withdrawal_only_for_optional",
        "ck_consents_withdrawal_only_for_optional",
    ),
)


def _rename_checks(*, forward: bool) -> None:
    for table, doubled, intended in RENAMED_CHECKS:
        old, new = (doubled, intended) if forward else (intended, doubled)
        op.execute(f"ALTER TABLE {SCHEMA}.{table} RENAME CONSTRAINT {old} TO {new}")


def upgrade() -> None:
    _rename_checks(forward=True)

    op.create_table(
        "mood_checkins",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mood_score", sa.SmallInteger(), nullable=False),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "mood_score BETWEEN 1 AND 5", name=op.f("ck_mood_checkins_mood_score_range")
        ),
        sa.CheckConstraint("cardinality(tags) <= 10", name=op.f("ck_mood_checkins_tags_count")),
        sa.CheckConstraint(
            "note IS NULL OR char_length(note) BETWEEN 1 AND 1000",
            name=op.f("ck_mood_checkins_note_length"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_mood_checkins_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mood_checkins")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_mood_checkins_user_submitted",
        "mood_checkins",
        ["user_id", "submitted_at"],
        schema=SCHEMA,
    )
    op.execute("ALTER TABLE app.mood_checkins ENABLE ROW LEVEL SECURITY")
    # Written without string interpolation: the table and role names are fixed.
    op.execute(
        """
        DO $$
        DECLARE role_name text;
        BEGIN
            FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                    EXECUTE format('REVOKE ALL ON app.mood_checkins FROM %I', role_name);
                END IF;
            END LOOP;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_mood_checkins_user_submitted", table_name="mood_checkins", schema=SCHEMA)
    op.drop_table("mood_checkins", schema=SCHEMA)
    _rename_checks(forward=False)
