"""Groq chat-completions provider (OpenAI-compatible API), standard library only.

Only reachable through `safety.gate.generate_with_permit`, after the safety gate
authorised generation and retrieval found approved-status evidence. It is configured
only when the founder approves external processing (OPEN_DECISIONS D-47): Groq may log
inputs and outputs for up to 30 days unless Zero Data Retention is enabled, and stores
data in the United States.

Data minimisation: the request carries the current message, at most the last few
conversation turns and the retrieved passages. No user id, email or name.
Limits: one request, short timeout, bounded tokens. Quota errors (HTTP 429) and every
other failure raise ProviderError, so the pipeline answers "unavailable". There is no
fallback to any other (paid) model.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

from app.ai.provider.base import GenerationRequest, GenerationResult, ProviderError
from app.safety.gate import GenerationPermit

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
# Groq's edge (Cloudflare) answers urllib's default "Python-urllib/3.x" agent with
# 403 "error code: 1010" before the API sees the request; every production chat
# failed this way until an explicit agent was sent (2026-10-20).
USER_AGENT = "ai-wellness-egypt-backend/0.1"
REQUEST_TIMEOUT_SECONDS = 8.0  # inside PROVIDER_TIMEOUT_SECONDS
# Room for a short reply plus the low-effort reasoning gpt-oss models spend first.
MAX_OUTPUT_TOKENS = 1024
MAX_HISTORY_TURNS = 4
_PASSAGE_ID = re.compile(r"^P[1-9]$")

SYSTEM_RULES = """You are a general wellness information assistant in a test prototype.
Rules you must follow:
- Use ONLY the numbered passages provided. Do not add facts that are not in them.
- If the passages do not answer the question, say you don't have information about that.
- Never diagnose, never suggest or discuss medication, never claim to be a therapist or doctor.
- Be warm and brief. You may ask one gentle follow-up question.
- Reply in the language of the user's latest message. If they ask for Egyptian Arabic,
  reply in Egyptian Arabic.
- Respond with a JSON object only: {"reply": "<text>", "citations": ["P1", ...]} listing the
  passage ids you used. Keep the reply under {max_chars} characters."""


def _json_object(content: str) -> str:
    """The JSON object in the reply, tolerating stray text or code fences around it."""
    start, end = content.find("{"), content.rfind("}")
    return content[start : end + 1] if 0 <= start < end else content


class GroqProvider:
    kind = "model"

    def __init__(self, api_key: str, model: str, *, url: str = GROQ_CHAT_URL) -> None:
        if not api_key:
            raise ValueError("Groq API key is required")
        self._api_key = api_key
        self.model_name = model
        self._url = url

    def build_payload(self, request: GenerationRequest) -> tuple[dict[str, Any], dict[str, str]]:
        ids = {f"P{i}": p.chunk_id for i, p in enumerate(request.passages, start=1)}
        passages = "\n\n".join(
            f"[{pid}] {p.text}" for pid, p in zip(ids, request.passages, strict=True)
        )
        system = (
            SYSTEM_RULES.replace("{max_chars}", str(request.max_chars))
            + "\n"
            + request.instructions
        )
        messages: list[dict[str, str]] = [
            {"role": "system", "content": system},
            {"role": "system", "content": f"Passages:\n{passages}"},
        ]
        for role, text in request.history[-MAX_HISTORY_TURNS:]:
            messages.append(
                {"role": "assistant" if role == "assistant" else "user", "content": text}
            )
        messages.append({"role": "user", "content": request.message})
        payload: dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.2,
            "max_completion_tokens": MAX_OUTPUT_TOKENS,
            "response_format": {"type": "json_object"},
        }
        if self.model_name.startswith("openai/gpt-oss"):
            # Reasoning model: spend few tokens thinking and never return the reasoning.
            payload["reasoning_effort"] = "low"
            payload["include_reasoning"] = False
        return payload, ids

    def generate(self, permit: GenerationPermit, request: GenerationRequest) -> GenerationResult:
        payload, ids = self.build_payload(request)
        http_request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
            self._url,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(http_request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
                body = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            exc.close()  # release the connection; the body is never read
            # Never include the response body or headers: they may echo the request.
            raise ProviderError("quota" if exc.code == 429 else f"http_{exc.code}") from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            raise ProviderError("unreachable") from None
        return self._parse(body, ids)

    @staticmethod
    def _parse(body: Any, ids: dict[str, str]) -> GenerationResult:
        try:
            content = body["choices"][0]["message"]["content"]
            data = json.loads(_json_object(content))
            reply = data["reply"]
            cited = data["citations"]
        except (KeyError, IndexError, TypeError, ValueError):
            raise ProviderError("malformed") from None
        if not isinstance(reply, str) or not isinstance(cited, list):
            raise ProviderError("malformed")
        # Map passage ids back to chunk ids; anything else stays as-is so output
        # validation rejects citations of passages that were not retrieved.
        chunk_ids = [
            ids.get(c, str(c)) if isinstance(c, str) and _PASSAGE_ID.match(c) else str(c)
            for c in cited
        ]
        return GenerationResult(text=reply.strip(), cited_chunk_ids=chunk_ids)
