"""Audit-log guarantees and the migration itself."""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.audit.service import AuditMetadataError, record_event
from app.core.db import SCHEMA, Base
from tests.auth_helpers import api_client, bearer
from tests.conftest import alembic_config

# --- Audit writer -------------------------------------------------------------


@pytest.mark.parametrize(
    "metadata",
    [
        {"note": "free text with spaces"},
        {"email": "person@example.com"},
        {"token": "a" * 65},
        {"bad key!": "x"},
        {"fields": ["ok", "not ok"]},
        {"nested": {"a": "b"}},
    ],
)
def test_audit_metadata_rejects_non_reference_values(
    metadata: dict[str, object], db_engine: Engine
) -> None:
    with Session(db_engine) as session, pytest.raises(AuditMetadataError):
        record_event(
            session,
            action="user.created",
            actor_user_id=None,
            target_type="user",
            target_id=None,
            metadata=metadata,  # type: ignore[arg-type]  # deliberately invalid
        )


def test_audit_metadata_rejects_too_many_keys(db_engine: Engine) -> None:
    with Session(db_engine) as session, pytest.raises(AuditMetadataError):
        record_event(
            session,
            action="user.created",
            actor_user_id=None,
            target_type="user",
            target_id=None,
            metadata={f"k{i}": i for i in range(11)},
        )


def test_audit_metadata_accepts_reference_values(db_engine: Engine) -> None:
    target = uuid.uuid4()
    with Session(db_engine, expire_on_commit=False) as session, session.begin():
        event = record_event(
            session,
            action="consent.recorded",
            actor_user_id=None,
            target_type="consent",
            target_id=target,
            metadata={"version": "2026-09-29.draft-1", "granted": True, "ref": target, "n": 3},
        )
    assert event.metadata_ == {
        "version": "2026-09-29.draft-1",
        "granted": True,
        "ref": str(target),
        "n": 3,
    }


@pytest.mark.parametrize(
    "statement", ["UPDATE app.audit_events SET action = 'x'", "DELETE FROM app.audit_events"]
)
def test_audit_events_are_append_only_in_the_database(statement: str, db_engine: Engine) -> None:
    api_client().get("/me", headers=bearer())  # writes a user.created event
    with pytest.raises(DBAPIError, match="append-only"), db_engine.begin() as connection:
        connection.execute(text(statement))
    with db_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM app.audit_events")).scalar_one() == 1


# --- Migration ----------------------------------------------------------------


def test_models_match_the_migration(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={
                "include_schemas": True,
                "include_name": lambda name, type_, _p: type_ != "schema" or name == SCHEMA,
                "compare_type": True,
                "version_table_schema": SCHEMA,
            },
        )
        diff = compare_metadata(context, Base.metadata)
    assert diff == []


def test_tables_live_in_app_schema_with_rls_enabled(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        found = connection.execute(
            text(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname"
            )
        ).all()
        public: int = connection.execute(
            text(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' "
                "AND table_name IN ('users', 'consents', 'audit_events', 'mood_checkins')"
            )
        ).scalar_one()
    assert [(name, rls) for name, rls in found if name != "alembic_version"] == [
        ("audit_events", True),
        ("chat_conversations", True),
        ("chat_messages", True),
        ("chat_rate_events", True),
        ("consents", True),
        ("knowledge_chunks", True),
        ("knowledge_sources", True),
        ("mood_checkins", True),
        ("safety_events", True),
        ("users", True),
    ]
    assert public == 0


def test_migration_downgrades_and_reapplies_cleanly(
    test_database_url: str, db_engine: Engine
) -> None:
    config = alembic_config(test_database_url)
    command.downgrade(config, "base")
    inspector = sa.inspect(db_engine)
    assert [t for t in inspector.get_table_names(schema=SCHEMA) if t != "alembic_version"] == []
    command.upgrade(config, "head")
    assert set(sa.inspect(db_engine).get_table_names(schema=SCHEMA)) >= {
        "users",
        "consents",
        "audit_events",
    }


def _has_privilege(engine: Engine, sql: str, **params: str) -> bool:
    with engine.connect() as connection:
        return bool(connection.execute(text(sql), params).scalar_one())


CREATE_SUPABASE_ROLES = (
    "DO $$ BEGIN "
    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') "
    "THEN CREATE ROLE anon NOLOGIN; END IF; "
    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') "
    "THEN CREATE ROLE authenticated NOLOGIN; END IF; "
    "END $$"
)


SUPABASE_GUARDED_TABLES = (
    "app.users",
    "app.consents",
    "app.audit_events",
    "app.mood_checkins",
    "app.knowledge_sources",
    "app.knowledge_chunks",
    "app.safety_events",
    "app.chat_rate_events",
    "app.chat_conversations",
    "app.chat_messages",
)


def test_supabase_data_api_roles_get_no_access(test_database_url: str, db_engine: Engine) -> None:
    """Simulate Supabase's `anon`/`authenticated` roles and re-run the migration."""
    config = alembic_config(test_database_url)
    with db_engine.begin() as connection:
        connection.execute(text(CREATE_SUPABASE_ROLES))
    try:
        command.downgrade(config, "base")
        with db_engine.begin() as connection:
            # Mimic Supabase-style broad grants that the migration must remove.
            connection.execute(text("GRANT USAGE ON SCHEMA app TO anon, authenticated"))
        command.upgrade(config, "head")
        for role in ("anon", "authenticated"):
            assert not _has_privilege(
                db_engine, "SELECT has_schema_privilege(:r, 'app', 'USAGE')", r=role
            )
            for table in SUPABASE_GUARDED_TABLES:
                assert not _has_privilege(
                    db_engine, "SELECT has_table_privilege(:r, :t, 'SELECT')", r=role, t=table
                )
    finally:
        with db_engine.begin() as connection:
            connection.execute(text("DROP OWNED BY anon, authenticated"))
            connection.execute(text("DROP ROLE IF EXISTS anon, authenticated"))


EXPECTED_CONSTRAINTS = {
    ("audit_events", "fk_audit_events_actor_user_id_users"),
    ("audit_events", "pk_audit_events"),
    ("chat_conversations", "fk_chat_conversations_user_id_users"),  # 0005
    ("chat_conversations", "pk_chat_conversations"),
    ("chat_messages", "ck_chat_messages_language_valid"),
    ("chat_messages", "ck_chat_messages_role_valid"),
    ("chat_messages", "fk_chat_messages_conversation_id_chat_conversations"),
    ("chat_messages", "fk_chat_messages_user_id_users"),
    ("chat_messages", "pk_chat_messages"),
    ("chat_messages", "uq_chat_messages_conversation_id_client_message_id_role"),
    ("chat_messages", "uq_chat_messages_conversation_id_seq"),
    ("chat_rate_events", "fk_chat_rate_events_user_id_users"),
    ("chat_rate_events", "pk_chat_rate_events"),
    ("consents", "ck_consents_consent_type_valid"),
    ("consents", "ck_consents_withdrawal_only_for_optional"),
    ("consents", "fk_consents_user_id_users"),
    ("consents", "pk_consents"),
    ("knowledge_chunks", "ck_knowledge_chunks_content_length"),
    ("knowledge_chunks", "fk_knowledge_chunks_source_id_knowledge_sources"),
    ("knowledge_chunks", "pk_knowledge_chunks"),
    ("knowledge_chunks", "uq_knowledge_chunks_source_id_chunk_index"),
    ("knowledge_sources", "ck_knowledge_sources_age_bands_valid"),
    ("knowledge_sources", "ck_knowledge_sources_approved_requires_reviewer"),
    ("knowledge_sources", "ck_knowledge_sources_approved_requires_clinical_review"),  # 0004
    ("knowledge_chunks", "uq_knowledge_chunks_source_id_content_sha256"),  # 0004
    ("knowledge_sources", "ck_knowledge_sources_review_status_valid"),
    ("knowledge_sources", "pk_knowledge_sources"),
    ("knowledge_sources", "uq_knowledge_sources_slug_version_label"),
    ("mood_checkins", "ck_mood_checkins_mood_score_range"),
    ("mood_checkins", "ck_mood_checkins_entry_valid"),  # 0006
    ("mood_checkins", "ck_mood_checkins_factors_count"),  # 0006
    ("chat_rate_events", "ck_chat_rate_events_tokens_nonnegative"),  # 0006
    ("knowledge_sources", "ck_knowledge_sources_domains_valid"),  # 0006
    ("mood_checkins", "ck_mood_checkins_note_length"),
    ("mood_checkins", "ck_mood_checkins_tags_count"),
    ("mood_checkins", "fk_mood_checkins_user_id_users"),
    ("mood_checkins", "pk_mood_checkins"),
    ("safety_events", "fk_safety_events_actor_user_id_users"),
    ("safety_events", "pk_safety_events"),
    ("users", "ck_users_display_name_length"),
    ("users", "ck_users_goals_is_array"),
    ("users", "ck_users_preferences_is_object"),
    ("users", "pk_users"),
    ("users", "uq_users_supabase_user_id"),
}


def _constraint_names(engine: Engine) -> set[tuple[str, str]]:
    with engine.connect() as connection:
        return {
            (str(table), str(name))
            for table, name in connection.execute(
                text(
                    "SELECT cl.relname, c.conname FROM pg_constraint c "
                    "JOIN pg_class cl ON cl.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = cl.relnamespace "
                    "WHERE n.nspname = 'app' AND cl.relname <> 'alembic_version'"
                )
            )
        }


def test_constraint_names_follow_the_convention(db_engine: Engine) -> None:
    """Regression: 0001 created doubled names like `ck_users_ck_users_...`; 0002 fixes them."""
    assert _constraint_names(db_engine) == EXPECTED_CONSTRAINTS


def test_downgrade_to_0001_restores_its_names_and_reupgrade_works(
    test_database_url: str, db_engine: Engine
) -> None:
    config = alembic_config(test_database_url)
    command.downgrade(config, "0001")
    names = {name for _, name in _constraint_names(db_engine)}
    assert "ck_users_ck_users_display_name_length" in names
    assert "mood_checkins" not in sa.inspect(db_engine).get_table_names(schema=SCHEMA)
    command.upgrade(config, "head")
    assert _constraint_names(db_engine) == EXPECTED_CONSTRAINTS


def test_0005_keeps_existing_users_and_starts_everyone_with_history_off(
    test_database_url: str, db_engine: Engine
) -> None:
    config = alembic_config(test_database_url)
    command.downgrade(config, "0004")
    try:
        assert "chat_conversations" not in sa.inspect(db_engine).get_table_names(schema=SCHEMA)
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO app.users (id, supabase_user_id, display_name) VALUES "
                    "(gen_random_uuid(), gen_random_uuid(), 'Existing person')"
                )
            )
        command.upgrade(config, "head")
        with db_engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT display_name, chat_history_enabled, chat_history_consent_version "
                    "FROM app.users"
                )
            ).one()
        assert tuple(row) == ("Existing person", False, None)
    finally:
        command.upgrade(config, "head")


def test_0006_keeps_existing_check_ins_conversations_and_sources(
    test_database_url: str, db_engine: Engine
) -> None:
    config = alembic_config(test_database_url)
    command.downgrade(config, "0005")
    try:
        with db_engine.begin() as connection:
            user_id: object = connection.execute(
                text(
                    "INSERT INTO app.users (id, supabase_user_id) VALUES "
                    "(gen_random_uuid(), gen_random_uuid()) RETURNING id"
                )
            ).scalar_one()
            connection.execute(
                text(
                    "INSERT INTO app.mood_checkins (id, user_id, mood_score) "
                    "VALUES (gen_random_uuid(), :u, 4)"
                ),
                {"u": user_id},
            )
            connection.execute(
                text(
                    "INSERT INTO app.chat_conversations (id, user_id, title_enc) "
                    "VALUES (gen_random_uuid(), :u, 'v1.k1.x')"
                ),
                {"u": user_id},
            )
            connection.execute(
                text(
                    "INSERT INTO app.knowledge_sources (id, slug, title, publisher, source_ref, "
                    "version_label, content_type, language, age_bands, review_status) VALUES "
                    "(gen_random_uuid(), 'cdc-physical-activity-benefits-en', 't', 'p', 'r', "
                    "'v', 'c', 'en', ARRAY['adult'], 'draft')"
                )
            )
        command.upgrade(config, "head")
        with db_engine.connect() as connection:
            mood = connection.execute(
                text("SELECT mood_score, emotions, factors, entry_version FROM app.mood_checkins")
            ).one()
            assistant: str = connection.execute(
                text("SELECT assistant_id FROM app.chat_conversations")
            ).scalar_one()
            domains: list[str] = connection.execute(
                text("SELECT domains FROM app.knowledge_sources")
            ).scalar_one()
        assert tuple(mood) == (4, [], [], 1)  # the old score is kept, never turned into emotions
        assert assistant == "emotional"
        assert domains == ["fitness", "emotional"]
        with db_engine.begin() as connection:  # a reflection needs emotions and no score
            for sql in (
                "INSERT INTO app.mood_checkins (id, user_id, entry_version) "
                "VALUES (gen_random_uuid(), :u, 2)",
                "INSERT INTO app.mood_checkins (id, user_id, entry_version, mood_score, emotions) "
                "VALUES (gen_random_uuid(), :u, 2, 3, ARRAY['calm'])",
                "INSERT INTO app.mood_checkins (id, user_id) VALUES (gen_random_uuid(), :u)",
            ):
                with pytest.raises(sa.exc.IntegrityError), connection.begin_nested():
                    connection.execute(text(sql), {"u": user_id})
    finally:
        command.upgrade(config, "head")
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    "TRUNCATE app.chat_messages, app.chat_conversations, app.mood_checkins, "
                    "app.knowledge_chunks, app.knowledge_sources, app.users CASCADE"
                )
            )
