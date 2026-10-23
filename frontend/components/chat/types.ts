import type { ChatCitation, ChatStatus, ChatTopic, RefusalReason } from "@/lib/api/backend";

export type Entry =
  | { id: string; kind: "user"; text: string; topic: ChatTopic | null; createdAt: string }
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
    };

export type Suggestion = { id: string; text: string; followUp: boolean };
