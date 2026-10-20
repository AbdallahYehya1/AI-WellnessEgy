"""Application-layer encryption for saved chat history (OPEN_DECISIONS D-54).

Message bodies and conversation titles are encrypted in the backend with AES-256-GCM
before they reach PostgreSQL, so the database (and its backups, and anyone with read
access to the `app` schema) holds ciphertext only. This is NOT end-to-end encryption:
the backend holds the keys and decrypts to show users their own history.

Keys come from CHAT_HISTORY_KEYS, a protected backend environment variable:
``"<key id>:<base64 32-byte key>[,<older id>:<older key>...]"``. The first key encrypts;
every listed key can decrypt, so a new key can be added first and an old one removed
once nothing uses it. Losing every key makes saved history unreadable (no recovery
by design); see docs/DEPLOYMENT_RUNBOOK.md for backup and rotation.

Each ciphertext is bound (AES-GCM associated data) to its purpose, row id and owner,
so a ciphertext copied to another row or another user's account fails to decrypt.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_KEY_ID = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
_VERSION = "v1"


class HistoryKeyError(ValueError):
    """CHAT_HISTORY_KEYS is missing or malformed (the message never includes a key)."""


class HistoryDecryptError(Exception):
    """A stored value could not be decrypted (wrong key, tampering, or another row's)."""


def parse_keys(raw: str) -> dict[str, bytes]:
    keys: dict[str, bytes] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        key_id, sep, encoded = item.partition(":")
        if not sep or not _KEY_ID.match(key_id) or key_id in keys:
            raise HistoryKeyError("CHAT_HISTORY_KEYS must be '<id>:<base64 key>' entries")
        try:
            key = base64.b64decode(encoded.strip(), validate=True)
        except (binascii.Error, ValueError):
            raise HistoryKeyError("CHAT_HISTORY_KEYS contains a key that isn't base64") from None
        if len(key) != 32:
            raise HistoryKeyError("CHAT_HISTORY_KEYS keys must be 32 bytes (AES-256)")
        keys[key_id] = key
    if not keys:
        raise HistoryKeyError("CHAT_HISTORY_KEYS is empty")
    return keys


class HistoryCipher:
    def __init__(self, keys: dict[str, bytes]) -> None:
        if not keys:
            raise HistoryKeyError("at least one key is required")
        self._keys = {key_id: AESGCM(key) for key_id, key in keys.items()}
        self.current_key_id = next(iter(keys))

    @classmethod
    def from_env_value(cls, raw: str) -> HistoryCipher:
        return cls(parse_keys(raw))

    @staticmethod
    def _aad(purpose: str, row_id: uuid.UUID, owner_id: uuid.UUID) -> bytes:
        return f"{_VERSION}|{purpose}|{row_id}|{owner_id}".encode()

    def encrypt(
        self, plaintext: str, *, purpose: str, row_id: uuid.UUID, owner_id: uuid.UUID
    ) -> str:
        nonce = os.urandom(12)
        sealed = self._keys[self.current_key_id].encrypt(
            nonce, plaintext.encode("utf-8"), self._aad(purpose, row_id, owner_id)
        )
        body = base64.b64encode(nonce + sealed).decode("ascii")
        return f"{_VERSION}.{self.current_key_id}.{body}"

    def decrypt(self, token: str, *, purpose: str, row_id: uuid.UUID, owner_id: uuid.UUID) -> str:
        try:
            version, key_id, body = token.split(".", 2)
            if version != _VERSION:
                raise HistoryDecryptError("unknown format")
            aead = self._keys[key_id]
            raw = base64.b64decode(body, validate=True)
            plain = aead.decrypt(raw[:12], raw[12:], self._aad(purpose, row_id, owner_id))
        except (ValueError, KeyError, InvalidTag, binascii.Error):
            raise HistoryDecryptError("stored value could not be decrypted") from None
        return plain.decode("utf-8")
