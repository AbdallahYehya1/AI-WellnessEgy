"use server";

import { redirect } from "next/navigation";

import {
  type ChatResponse,
  type ChatTurn,
  type ConversationDetail,
  type ConversationPage,
  type ConversationSummary,
  type HistorySettings,
  deleteAllConversations,
  deleteConversation,
  fetchConversation,
  listConversations,
  renameConversation,
  sendChatMessage,
  updateHistorySettings,
} from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { CHAT_PATH, MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS, MAX_TITLE_CHARS } from "@/lib/chat/limits";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";

export type ChatErrorCode =
  | "invalid"
  | "rate_limited"
  | "invalid_history"
  | "disabled"
  | "not_available"
  | "history_off"
  | "history_full"
  | "not_found"
  | "failed";

export type ChatActionResult =
  | { kind: "response"; response: ChatResponse }
  | { kind: "error"; message: string; code?: ChatErrorCode };

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: ChatErrorCode };

const GENERIC_ERROR = "The assistant couldn't respond right now. Please try again.";
const HISTORY_ERROR = "Saved chats couldn't be loaded right now. Please try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function token(): Promise<string> {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHAT_PATH}`);
  return session.accessToken;
}

function handleAuth(status: number, error: string): void {
  if (status === 401) redirect(`/sign-in?next=${CHAT_PATH}`);
  if (error === "consent_required") redirect(ONBOARDING_CONSENT);
}

export type SendInput = {
  message: string;
  history?: ChatTurn[];
  conversationId?: string;
  clientMessageId?: string;
  assistantId?: string;
};

const ASSISTANT_ID = /^[a-z]{2,40}$/;

export async function sendChat(input: SendInput): Promise<ChatActionResult> {
  const accessToken = await token();
  const text = typeof input?.message === "string" ? input.message.trim() : "";
  if (!text) return { kind: "error", message: "Type a message first.", code: "invalid" };
  if (text.length > MAX_MESSAGE_CHARS) {
    return { kind: "error", message: `Messages can be up to ${MAX_MESSAGE_CHARS} characters.`, code: "invalid" };
  }
  const conversationId = typeof input.conversationId === "string" && UUID.test(input.conversationId) ? input.conversationId : undefined;
  const clientMessageId =
    typeof input.clientMessageId === "string" && UUID.test(input.clientMessageId) ? input.clientMessageId : undefined;

  const result = await sendChatMessage(accessToken, {
    message: text,
    // A saved conversation's context is loaded by the server; browser history is never sent with it.
    history: conversationId ? [] : cleanHistory(input.history),
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    assistant_id: typeof input.assistantId === "string" && ASSISTANT_ID.test(input.assistantId) ? input.assistantId : undefined,
  });
  if (result.ok) return { kind: "response", response: result.data };
  handleAuth(result.status, result.error);
  switch (result.error) {
    case "rate_limited":
      return { kind: "error", message: "You're sending messages quickly. Please wait a minute.", code: "rate_limited" };
    case "invalid_history":
      return { kind: "error", message: "This conversation couldn't be verified. Please start a new chat.", code: "invalid_history" };
    case "chat_unavailable":
      return { kind: "error", message: "The assistant has been switched off. Your message wasn't sent.", code: "disabled" };
    case "age_band_unavailable":
    case "chat_not_enabled":
      return { kind: "error", message: "The assistant isn't available for your account.", code: "not_available" };
    case "history_off":
      return { kind: "error", message: "Saved chats are switched off, so this saved chat can't continue.", code: "history_off" };
    case "history_full":
      return {
        kind: "error",
        message: "You've reached the number of saved chats. Delete some older chats to save more.",
        code: "history_full",
      };
    case "conversation_not_found":
      return { kind: "error", message: "This chat no longer exists.", code: "not_found" };
    case "assistant_unavailable":
    case "unknown_assistant":
      return { kind: "error", message: "This assistant isn't available yet.", code: "not_available" };
    case "assistant_mismatch":
      return { kind: "error", message: "This chat belongs to another assistant. Please start a new chat.", code: "invalid" };
    default:
      return { kind: "error", message: GENERIC_ERROR, code: "failed" };
  }
}

export async function loadConversations(
  cursor?: string,
  query?: string,
  assistant?: string,
): Promise<ActionResult<ConversationPage>> {
  const accessToken = await token();
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  const safeCursor = typeof cursor === "string" && cursor.length <= 200 ? cursor : undefined;
  const safeAssistant = typeof assistant === "string" && ASSISTANT_ID.test(assistant) ? assistant : undefined;
  const result = await listConversations(accessToken, { cursor: safeCursor, q: q || undefined, assistant: safeAssistant });
  if (result.ok) return { ok: true, data: result.data };
  handleAuth(result.status, result.error);
  return { ok: false, message: HISTORY_ERROR, code: "failed" };
}

export async function openConversation(id: string, before?: number): Promise<ActionResult<ConversationDetail>> {
  const accessToken = await token();
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, message: "This chat no longer exists.", code: "not_found" };
  const safeBefore = Number.isInteger(before) && (before as number) > 0 ? before : undefined;
  const result = await fetchConversation(accessToken, id, { before: safeBefore });
  if (result.ok) return { ok: true, data: result.data };
  handleAuth(result.status, result.error);
  if (result.status === 404) return { ok: false, message: "This chat no longer exists.", code: "not_found" };
  return { ok: false, message: HISTORY_ERROR, code: "failed" };
}

export async function renameChat(id: string, title: string): Promise<ActionResult<ConversationSummary>> {
  const accessToken = await token();
  const clean = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, message: "This chat no longer exists.", code: "not_found" };
  if (!clean || clean.length > MAX_TITLE_CHARS) {
    return { ok: false, message: `Titles can be 1 to ${MAX_TITLE_CHARS} characters.`, code: "invalid" };
  }
  const result = await renameConversation(accessToken, id, clean);
  if (result.ok) return { ok: true, data: result.data };
  handleAuth(result.status, result.error);
  if (result.status === 404) return { ok: false, message: "This chat no longer exists.", code: "not_found" };
  return { ok: false, message: "The chat couldn't be renamed. Please try again.", code: "failed" };
}

export async function deleteChat(id: string): Promise<ActionResult<null>> {
  const accessToken = await token();
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, message: "This chat no longer exists.", code: "not_found" };
  const result = await deleteConversation(accessToken, id);
  if (result.ok || result.status === 404) return { ok: true, data: null }; // already gone
  handleAuth(result.status, result.error);
  return { ok: false, message: "The chat couldn't be deleted. Please try again.", code: "failed" };
}

export async function deleteAllChats(): Promise<ActionResult<null>> {
  const accessToken = await token();
  const result = await deleteAllConversations(accessToken);
  if (result.ok) return { ok: true, data: null };
  handleAuth(result.status, result.error);
  return { ok: false, message: "Your saved chats couldn't be deleted. Please try again.", code: "failed" };
}

export async function setHistoryEnabled(enabled: boolean, consentVersion?: string): Promise<ActionResult<HistorySettings>> {
  const accessToken = await token();
  const version = typeof consentVersion === "string" ? consentVersion.slice(0, 40) : undefined;
  const result = await updateHistorySettings(accessToken, enabled === true, version);
  if (result.ok) return { ok: true, data: result.data };
  handleAuth(result.status, result.error);
  return { ok: false, message: "Your choice couldn't be saved. Please try again.", code: "failed" };
}
