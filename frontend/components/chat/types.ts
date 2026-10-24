import type { ChatCitation, ChatStatus, ChatTopic, RefusalReason, SupportKind } from "@/lib/api/backend";

export type Entry =
  | {
      id: string;
      kind: "user";
      text: string;
      topic: ChatTopic | null;
      createdAt: string;
      /** What the AI provider received (identifiers removed), when the user opted in. */
      shared?: string | null;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      signature: string;
      citations: ChatCitation[];
      createdAt: string;
    }
  | {
      id: string;
      kind: "notice";
      status: ChatStatus;
      reason: RefusalReason | null;
      text: string;
      createdAt: string;
      /** A better-suited assistant, suggested only. */
      handoff?: string | null;
      /** Which support message to show, in the visitor's language. */
      supportKind?: SupportKind | null;
      /** Vetted sources shown with a safety notice. */
      resources?: ChatCitation[];
    };

export type Suggestion = { id: string; text: string; followUp: boolean };
