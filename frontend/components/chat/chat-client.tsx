"use client";

import { type FormEvent, useState, useTransition } from "react";

import type { ChatCitation, ChatStatus, ChatTurn } from "@/lib/api/backend";
import type { ChatActionResult } from "@/lib/chat/actions";
import { MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS } from "@/lib/chat/limits";

type Entry =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; signature: string; citations: ChatCitation[] }
  | { id: number; kind: "notice"; status: ChatStatus; text: string };

type Props = {
  send: (message: string, history: ChatTurn[]) => Promise<ChatActionResult>;
};

/** Only user turns and server-signed assistant turns go back to the server. */
function historyFrom(entries: Entry[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const e of entries) {
    if (e.kind === "user") turns.push({ role: "user", text: e.text });
    else if (e.kind === "assistant") turns.push({ role: "assistant", text: e.text, signature: e.signature });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

export function ChatClient({ send }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextId, setNextId] = useState(1);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    const history = historyFrom(entries);
    const userEntry: Entry = { id: nextId, kind: "user", text: message };
    setNextId((n) => n + 2);
    setError(null);
    startTransition(async () => {
      const result = await send(message, history);
      if (result.kind === "error") {
        setError(result.message);
        return;
      }
      const { response } = result;
      const answer: Entry =
        response.status === "reply" && response.reply
          ? {
              id: userEntry.id + 1,
              kind: "assistant",
              text: response.reply.text,
              signature: response.reply.signature,
              citations: response.reply.citations,
            }
          : {
              id: userEntry.id + 1,
              kind: "notice",
              status: response.status,
              text: response.notice ?? "The assistant couldn't answer that.",
            };
      setEntries((current) => [...current, userEntry, answer]);
      setDraft("");
    });
  }

  return (
    <div className="space-y-4">
      <ol aria-label="Conversation" aria-live="polite" className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.kind === "user" ? (
              <div className="ml-8 rounded-lg bg-calm-100 p-3 text-sm">
                <span className="sr-only">You: </span>
                <p className="whitespace-pre-wrap" dir="auto">{entry.text}</p>
              </div>
            ) : entry.kind === "assistant" ? (
              <div className="mr-8 space-y-2 rounded-lg border border-calm-100 bg-white p-3 text-sm">
                <span className="sr-only">Assistant: </span>
                <p className="whitespace-pre-wrap" dir="auto">{entry.text}</p>
                <Citations citations={entry.citations} />
              </div>
            ) : (
              <div
                role="note"
                data-status={entry.status}
                className="mr-8 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"
              >
                <span className="sr-only">Assistant notice: </span>
                <p>{entry.text}</p>
              </div>
            )}
          </li>
        ))}
      </ol>

      {pending ? (
        <p role="status" className="text-sm text-calm-700">
          The assistant is replying…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <form onSubmit={submit} className="space-y-2" noValidate>
        <label htmlFor="chat-message" className="text-sm font-medium">
          Your message
        </label>
        <textarea
          id="chat-message"
          name="message"
          dir="auto"
          rows={3}
          maxLength={MAX_MESSAGE_CHARS}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-describedby="chat-hint"
          className="w-full rounded-md border border-calm-100 bg-white p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-calm-900"
        />
        <p id="chat-hint" className="text-xs text-calm-700">
          Arabic, English or Arabizi. Don&apos;t include names or details that identify you.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="rounded-md bg-calm-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-calm-900"
          >
            Send
          </button>
          {entries.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setEntries([]);
                setError(null);
              }}
              disabled={pending}
              className="text-sm font-medium text-calm-700 underline"
            >
              Start over
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Citations({ citations }: { citations: ChatCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="border-t border-calm-100 pt-2">
      <p className="text-xs font-medium text-calm-700">Sources</p>
      <ul className="space-y-1 text-xs text-calm-700">
        {citations.map((c) => (
          <li key={c.chunk_id}>
            {c.source_title} · {c.publisher} · v{c.version_label}
            {c.synthetic ? (
              <span className="ml-1 rounded bg-amber-100 px-1 font-semibold text-amber-900">
                Synthetic test content
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
