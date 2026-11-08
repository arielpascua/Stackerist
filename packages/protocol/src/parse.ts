/**
 * Text → message parsing (architecture §3.7). The server checks binary frames and byte size
 * (MAX_FRAME_BYTES) before calling `parseClientMessage`; both functions only see text.
 */
import type { ClientMessage, ServerMessage } from './messages.js';
import { ClientMessageSchema, ServerMessageSchema } from './schemas.js';

/** Why a client frame was rejected. Either way the server replies BAD_MESSAGE. */
export type ParseFailureReason = 'BAD_JSON' | 'BAD_SCHEMA';
export type ClientParseResult =
  | { readonly ok: true; readonly msg: ClientMessage }
  | { readonly ok: false; readonly reason: ParseFailureReason };

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | null {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return null;
  }
}

/** Parse one client frame. Never throws: bad JSON → BAD_JSON; anything the schema rejects → BAD_SCHEMA. */
export function parseClientMessage(text: string): ClientParseResult {
  const json = parseJson(text);
  if (json === null) {
    return { ok: false, reason: 'BAD_JSON' };
  }
  const result = ClientMessageSchema.safeParse(json.value);
  return result.success ? { ok: true, msg: result.data } : { ok: false, reason: 'BAD_SCHEMA' };
}

/** Parse one server frame on the client. Never throws: anything invalid → null. */
export function parseServerMessage(text: string): ServerMessage | null {
  const json = parseJson(text);
  if (json === null) {
    return null;
  }
  const result = ServerMessageSchema.safeParse(json.value);
  return result.success ? result.data : null;
}
