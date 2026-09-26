import { AiNotConfigured } from "@/lib/ai/config";
import { DraftsNotAllowed } from "@/lib/ai/draft";
import { AddressNotOnContact, DraftNotFound, DraftsNotAllowedHere, NewerDraftExists } from "@/lib/ai/draft-save";
import { OpenAiError, OpenAiNoAnswer } from "@/lib/ai/openai";
import { NoThreadToReplyTo } from "@/lib/ai/reply";
import { AiCapReached, limitMessage } from "@/lib/ai/spend";
import { GmailApiError } from "@/lib/google/gmail";
import { GmailReconnectRequired } from "@/lib/google/tokens";

/**
 * Why a draft couldn't be written or saved, in words (slice 5a). Shared by the
 * draft panel on a contact's page and the Assistant's draft card (slice 11),
 * so the same failure reads the same in both places.
 *
 * Returns null for anything else: that is a bug, and goes to the error page.
 */
export function explainDraftFailure(error: unknown): string | null {
  if (error instanceof AiCapReached) {
    return limitMessage(error);
  }
  if (error instanceof DraftsNotAllowed || error instanceof DraftsNotAllowedHere) {
    return "Gmail isn't connected with permission to create drafts. Reconnect Gmail, then try again.";
  }
  if (error instanceof NoThreadToReplyTo) return "There's no mail with this contact to reply to yet.";
  if (error instanceof DraftNotFound) return "That draft isn't waiting any more — it was saved or discarded elsewhere.";
  if (error instanceof NewerDraftExists) return error.message;
  if (error instanceof AddressNotOnContact) return "That address isn't on this contact any more, so nothing was saved.";
  if (error instanceof AiNotConfigured) return "The AI isn't set up on this server: an OpenAI key is missing.";
  if (error instanceof GmailReconnectRequired) return "Gmail access has expired. Reconnect Gmail, then try again.";
  if (error instanceof OpenAiNoAnswer) return "The AI gave no usable answer, so nothing was saved. Try again.";
  if (error instanceof OpenAiError) return `OpenAI couldn't be reached (HTTP ${error.status}). Nothing was saved.`;
  if (error instanceof GmailApiError) return `Gmail couldn't be reached (HTTP ${error.status}). Nothing was saved.`;
  return null;
}
