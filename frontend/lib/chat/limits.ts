// Mirrors backend/app/conversations/schemas.py. The conversation lives only in
// the browser (OPEN_DECISIONS D-37); only the last few turns are sent back.
export const CHAT_PATH = "/chat";
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_HISTORY_TURNS = 6;
