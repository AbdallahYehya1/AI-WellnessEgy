"""TEST-ONLY local stand-in for the Supabase Auth (GoTrue) HTTP API (E2E).

Never used outside local end-to-end tests. Implements what supabase-js uses:
signup (email confirmation required, PKCE), recovery (/recover), verify
links, password / pkce / refresh-token grants, GET/PUT /user, logout
(global sign-out revokes the user's sessions, so /user answers
session_not_found like the real Auth server), and an ES256 JWKS generated at
start-up. Emails go to an in-memory outbox at GET /__outbox; /__events lists
calls. No real credentials are involved.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

BASE = "http://127.0.0.1:54321"
ISSUER = f"{BASE}/auth/v1"
KID = "mock-es256-key"
PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
PUBLIC_JWK = {**json.loads(ECAlgorithm.to_jwk(PRIVATE_KEY.public_key())), "kid": KID, "alg": "ES256", "use": "sig"}

LOCK = threading.Lock()
USERS: dict[str, dict] = {}          # email -> user record
VERIFY_TOKENS: dict[str, dict] = {}  # token -> {email, redirect_to, challenge}
AUTH_CODES: dict[str, dict] = {}     # code -> {email, challenge}
REFRESH: dict[str, str] = {}         # refresh token -> email
OUTBOX: list[dict] = []
EVENTS: list[str] = []
SESSIONS: dict[str, str] = {}   # session_id -> email
REVOKED: set[str] = set()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def user_json(u: dict) -> dict:
    return {
        "id": u["id"], "aud": "authenticated", "role": "authenticated", "email": u["email"],
        "email_confirmed_at": u["confirmed_at"], "phone": "", "confirmation_sent_at": u["created_at"],
        "app_metadata": {"provider": "email", "providers": ["email"]}, "user_metadata": {},
        "identities": [], "created_at": u["created_at"], "updated_at": u["created_at"],
        "is_anonymous": False,
    }


def session_for(u: dict) -> dict:
    iat = int(time.time())
    claims = {
        "iss": ISSUER, "aud": "authenticated", "sub": u["id"], "email": u["email"], "phone": "",
        "role": "authenticated", "aal": "aal1", "amr": [{"method": "password", "timestamp": iat}],
        "session_id": (sid := str(uuid.uuid4())), "is_anonymous": False, "iat": iat, "exp": iat + 3600,
        "app_metadata": {"provider": "email"}, "user_metadata": {},
    }
    SESSIONS[sid] = u["email"]
    token = jwt.encode(claims, PRIVATE_KEY, algorithm="ES256", headers={"kid": KID})
    refresh = secrets.token_urlsafe(24)
    REFRESH[refresh] = u["email"]
    return {
        "access_token": token, "token_type": "bearer", "expires_in": 3600, "expires_at": iat + 3600,
        "refresh_token": refresh, "user": user_json(u),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # keep console quiet
        pass

    def _send(self, status: int, body: object | None = None, headers: dict | None = None) -> None:
        payload = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Supabase-Api-Version", "2024-01-01")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, status: int, code: str, msg: str) -> None:
        self._send(status, {"code": code, "error_code": code, "msg": msg, "message": msg})

    def _json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, headers={"Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})

    def do_GET(self) -> None:  # noqa: N802
        url = urlsplit(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        EVENTS.append(f"GET {url.path}")
        if url.path == "/auth/v1/.well-known/jwks.json":
            return self._send(200, {"keys": [PUBLIC_JWK]})
        if url.path == "/__outbox":
            return self._send(200, OUTBOX)
        if url.path == "/__events":
            return self._send(200, EVENTS)
        if url.path == "/auth/v1/verify":
            with LOCK:
                rec = VERIFY_TOKENS.pop(q.get("token", ""), None)
                if not rec:
                    sep = "&" if "?" in q.get("redirect_to", "") else "?"
                    return self._send(303, headers={"Location": f"{q.get('redirect_to', BASE)}{sep}error=access_denied&error_code=otp_expired"})
                USERS[rec["email"]]["confirmed_at"] = now_iso()
                code = str(uuid.uuid4())
                AUTH_CODES[code] = {"email": rec["email"], "challenge": rec["challenge"]}
            sep = "&" if "?" in rec["redirect_to"] else "?"
            return self._send(303, headers={"Location": f"{rec['redirect_to']}{sep}{urlencode({'code': code})}"})
        if url.path == "/auth/v1/user":
            token = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
            try:
                claims = jwt.decode(token, PRIVATE_KEY.public_key(), algorithms=["ES256"], audience="authenticated")
            except jwt.PyJWTError:
                return self._error(401, "bad_jwt", "invalid JWT")
            if claims.get("session_id") in REVOKED:
                return self._error(403, "session_not_found", "Session from session_id claim in JWT does not exist")
            u = next(u for u in USERS.values() if u["id"] == claims["sub"])
            return self._send(200, user_json(u))
        return self._error(404, "not_found", "not found")

    def do_PUT(self) -> None:  # noqa: N802
        url = urlsplit(self.path)
        body = self._json()
        EVENTS.append(f"PUT {url.path}")
        if url.path != "/auth/v1/user":
            return self._error(404, "not_found", "not found")
        token = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
        try:
            claims = jwt.decode(token, PRIVATE_KEY.public_key(), algorithms=["ES256"], audience="authenticated")
        except jwt.PyJWTError:
            return self._error(401, "bad_jwt", "invalid JWT")
        if claims.get("session_id") in REVOKED:
            return self._error(403, "session_not_found", "Session from session_id claim in JWT does not exist")
        with LOCK:
            u = next(u for u in USERS.values() if u["id"] == claims["sub"])
            new = body.get("password")
            if new is not None:
                if new == u["password"]:
                    return self._error(422, "same_password", "New password should be different from the old password.")
                if len(new) < 8:
                    return self._error(422, "weak_password", "Password is too weak")
                u["password"] = new
        return self._send(200, user_json(u))

    def do_POST(self) -> None:  # noqa: N802
        url = urlsplit(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        body = self._json()
        EVENTS.append(f"POST {url.path} {q.get('grant_type', q.get('scope', ''))}".strip())
        if url.path == "/auth/v1/signup":
            email = str(body.get("email", "")).lower()
            with LOCK:
                if email in USERS:  # enumeration-safe: look like success
                    return self._send(200, {**user_json(USERS[email]), "id": str(uuid.uuid4()), "identities": []})
                u = {"id": str(uuid.uuid4()), "email": email, "password": body.get("password"),
                     "confirmed_at": None, "created_at": now_iso()}
                USERS[email] = u
                token = secrets.token_urlsafe(16)
                VERIFY_TOKENS[token] = {"email": email, "redirect_to": q.get("redirect_to", BASE),
                                        "challenge": body.get("code_challenge")}
                OUTBOX.append({"to": email, "link": f"{BASE}/auth/v1/verify?{urlencode({'token': token, 'type': 'signup', 'redirect_to': q.get('redirect_to', BASE)})}"})
            return self._send(200, user_json(u))
        if url.path == "/auth/v1/recover":
            email = str(body.get("email", "")).lower()
            with LOCK:
                if email in USERS:
                    token = secrets.token_urlsafe(16)
                    VERIFY_TOKENS[token] = {"email": email, "redirect_to": q.get("redirect_to", BASE),
                                            "challenge": body.get("code_challenge")}
                    OUTBOX.append({"to": email, "type": "recovery", "link": f"{BASE}/auth/v1/verify?{urlencode({'token': token, 'type': 'recovery', 'redirect_to': q.get('redirect_to', BASE)})}"})
            return self._send(200, {})
        if url.path == "/auth/v1/token":
            grant = q.get("grant_type")
            with LOCK:
                if grant == "password":
                    u = USERS.get(str(body.get("email", "")).lower())
                    if not u or u["password"] != body.get("password"):
                        return self._error(400, "invalid_credentials", "Invalid login credentials")
                    if not u["confirmed_at"]:
                        return self._error(400, "email_not_confirmed", "Email not confirmed")
                    return self._send(200, session_for(u))
                if grant == "pkce":
                    rec = AUTH_CODES.pop(str(body.get("auth_code", "")), None)
                    verifier = str(body.get("code_verifier", ""))
                    digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
                    if not rec or rec["challenge"] != digest:
                        return self._error(400, "bad_code_verifier", "code challenge does not match")
                    return self._send(200, session_for(USERS[rec["email"]]))
                if grant == "refresh_token":
                    email = REFRESH.pop(str(body.get("refresh_token", "")), None)
                    if not email:
                        return self._error(400, "refresh_token_not_found", "Invalid Refresh Token")
                    return self._send(200, session_for(USERS[email]))
            return self._error(400, "validation_failed", "unsupported grant")
        if url.path == "/auth/v1/logout":
            if q.get("scope") == "global":
                token = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
                try:
                    claims = jwt.decode(token, PRIVATE_KEY.public_key(), algorithms=["ES256"], audience="authenticated")
                    with LOCK:
                        email = next(e for e, u in USERS.items() if u["id"] == claims["sub"])
                        for r in [r for r, e in REFRESH.items() if e == email]:
                            REFRESH.pop(r, None)
                        REVOKED.update(sid for sid, e in SESSIONS.items() if e == email)
                except (jwt.PyJWTError, StopIteration):
                    pass
            return self._send(204)
        return self._error(404, "not_found", "not found")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 54321), Handler).serve_forever()
