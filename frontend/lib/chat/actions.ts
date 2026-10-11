"use server";

import { redirect } from "next/navigation";

import { type ChatResponse, type ChatTurn, sendChatMessage } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { CHAT_PATH, MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";

export type ChatActionResult =
  | { kind: "response"; response: ChatResponse }
  | { kind: "error"; message: string };

const GENERIC_ERROR = "The assistant couldn't respond right now. Please try again.";

function cleanHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (t): t is ChatTurn =>
        typeof t === "object" &&
        t !== null &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.text === "string" &&
        (t.signature === undefined || typeof t.signature === "string"),
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => (t.role === "assistant" ? { role: t.role, text: t.text, signature: t.signature } : { role: t.role, text: t.text }));
}

export async function sendChat(message: string, history: ChatTurn[]): Promise<ChatActionResult> {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHAT_PATH}`);

  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return { kind: "error", message: "Type a message first." };
  if (text.length > MAX_MESSAGE_CHARS) {
    return { kind: "error", message: `Messages can be up to ${MAX_MESSAGE_CHARS} characters.` };
  }

  const result = await sendChatMessage(session.accessToken, text, cleanHistory(history));
  if (result.ok) return { kind: "response", response: result.data };
  if (result.status === 401) redirect(`/sign-in?next=${CHAT_PATH}`);
  if (result.error === "consent_required") redirect(ONBOARDING_CONSENT);
  if (result.error === "rate_limited") {
    return { kind: "error", message: "You're sending messages quickly. Please wait a minute." };
  }
  if (result.error === "invalid_history") {
    return { kind: "error", message: "This conversation couldn't be verified. Please start over." };
  }
  return { kind: "error", message: GENERIC_ERROR };
}
