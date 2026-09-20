import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfig, type AiConfig } from "@/lib/ai/config";
import { readConversation } from "@/lib/ai/conversation";
import { estimateTokens, maxCostOf } from "@/lib/ai/models";
import { createStructuredResponse } from "@/lib/ai/openai";
import {
  PROMISE_INSTRUCTIONS,
  PROMISE_SCHEMA,
  buildPromiseInput,
  checkPromises,
  type DropReason,
  type FoundPromise,
  type RawPromises,
} from "@/lib/ai/promises";
import { AiCapReached, withSpendCap } from "@/lib/ai/spend";
import { loadThreadContext } from "@/lib/ai/thread";
import { getAccessToken } from "@/lib/google/tokens";
import { displayName } from "@/lib/contacts/display";
import { todayIn } from "@/lib/relationship/dates";
import { NO_MAIL, loadRelationships, type Relationship } from "@/lib/relationship/load";
import { supabaseError } from "@/lib/supabase/errors";
import { readAll } from "@/lib/supabase/read-all";

/**
 * Reading a mailbox for promises, and what that is allowed to cost
 * (docs/slice-6d-plan.md, Part 3).
 *
 * plan.md §5.4: "Summarising threads for one real mailbox costs real money,
 * every sync, forever." A scan reads many contacts in one press, so it is the
 * most expensive thing in the app, and nearly all of the work here is about not
 * reading what there is no reason to read:
 *
 *   no open thread       nothing to promise about
 *   settled              you said the conversation was finished
 *   just a contact       you said never to prompt about them
 *   a next touch already you have a date; there is nothing to find
 *   nothing new since    the last scan already read every message there is
 *
 * On a mailbox that has been scanned once, the last rule alone skips almost
 * everybody, which is what makes pressing the button again nearly free.
 */

/** Room for the answer. Four promises with their sentences is a small reply. */
export const PROMISE_MAX_OUTPUT_TOKENS = 1_200;

/**
 * Contacts read in one press.
 *
 * Reading one takes five to twelve seconds, nearly all of it waiting for the
 * model, against a 60 second budget for the whole request (maxDuration in
 * app/promises/page.tsx). Five fits even when every contact is slow. What is
 * left over is read by pressing again, and the button says how many that is.
 *
 * The alternative — read everything and hope — fails in the worst possible
 * way: the request is killed part way through, the spending is already
 * recorded, and the promises from the contact it was in the middle of are not
 * written. Stopping early on purpose costs a second press.
 */
export const SCAN_BATCH = 5;

/**
 * What one contact's thread is assumed to cost before Gmail has been read, for
 * the estimate on the button. Twenty messages of a few hundred tokens each,
 * plus the rules. Deliberately generous: the number shown should never be less
 * than what it turns out to cost.
 */
const ASSUMED_INPUT_TOKENS = 7_000;

export type ScanCandidate = {
  contactId: string;
  name: string;
  /** The newest message either way — what `promises_scanned_at` is compared to. */
  newestAt: Date;
};

export type ScanPlan = {
  contacts: ScanCandidate[];
  /** The most it could cost, in dollars. */
  estimateUsd: number;
  /** Worth reading, but over this press's batch: press again for these. */
  remaining: number;
};

export type ScanResult = {
  /** Contacts whose mail was actually read. */
  read: number;
  /** Promises found and written, after everything code throws away. */
  found: number;
  /** Stopped early because the monthly cap was reached. */
  stoppedAtCap: boolean;
  /** Contacts whose mail couldn't be read; the scan carried on past them. */
  failed: number;
  /** Still worth reading when this press finished. */
  remaining: number;
  /**
   * What the model offered and code refused, by reason. "Found nothing" and
   * "found four and rejected every one" are different answers, and only the
   * second means the rules are the thing to look at.
   */
  dropped: Partial<Record<DropReason, number>>;
};

export type ScanOptions = {
  config?: AiConfig;
  accessToken?: (db: SupabaseClient, userId: string) => Promise<string>;
  now?: Date;
  /** Read at most this many contacts in one press. */
  limit?: number;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  never_chase: boolean;
  promises_scanned_at: string | null;
};

/**
 * Who is worth reading, and what that would cost. Reads no mail and sends
 * nothing, so the button can say the price before anyone agrees to pay it.
 */
export async function planScan(
  db: SupabaseClient,
  userId: string,
  options: ScanOptions = {},
): Promise<ScanPlan> {
  const config = options.config ?? aiConfig();
  const now = options.now ?? new Date();

  const [contacts, relationships, touchesResult] = await Promise.all([
    readAll<ContactRow>(
      (from, to) =>
        db
          .from("contacts")
          .select("id, first_name, last_name, company, never_chase, promises_scanned_at")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load contacts",
    ),
    loadRelationships(db, userId, { now }),
    db
      .from("next_touches")
      .select("contact_id")
      .eq("user_id", userId)
      .eq("status", "open")
      .limit(1000),
  ]);
  if (touchesResult.error) throw supabaseError(touchesResult.error, "Couldn't load next touches");

  const planned = new Set((touchesResult.data ?? []).map((row) => row.contact_id as string));

  const candidates: ScanCandidate[] = [];
  for (const contact of contacts) {
    const relationship: Relationship = relationships.get(contact.id) ?? NO_MAIL;
    if (!worthReading(contact, relationship, planned)) continue;

    candidates.push({
      contactId: contact.id,
      name: displayName({ ...contact, primary_email: null }),
      // worthReading has already ruled out "none", so there is a message.
      newestAt: relationship.turn.kind === "none" ? now : relationship.turn.at,
    });
  }

  // Oldest scan first, so a limited run works through the backlog rather than
  // reading the same few contacts every time.
  candidates.sort((a, b) => a.newestAt.getTime() - b.newestAt.getTime());
  const contactsToRead = candidates.slice(0, options.limit ?? candidates.length);

  const perContact = maxCostOf(
    config.model,
    estimateTokens(PROMISE_INSTRUCTIONS) + ASSUMED_INPUT_TOKENS,
    PROMISE_MAX_OUTPUT_TOKENS,
  );

  return {
    contacts: contactsToRead,
    estimateUsd: perContact * contactsToRead.length,
    remaining: candidates.length - contactsToRead.length,
  };
}

function worthReading(
  contact: ContactRow,
  relationship: Relationship,
  planned: Set<string>,
): boolean {
  const { turn, settledAt, neverChase } = relationship;

  // Nothing said, nothing recent: no promise to find.
  if (turn.kind === "none" || turn.kind === "closed") return false;
  if (neverChase || planned.has(contact.id)) return false;
  // Settled: you said this conversation was finished (slice 6c).
  if (settledAt && settledAt.getTime() >= turn.at.getTime()) return false;

  // Already read every message this contact has.
  const scannedAt = contact.promises_scanned_at ? new Date(contact.promises_scanned_at) : null;
  return !scannedAt || turn.at.getTime() > scannedAt.getTime();
}

/**
 * Read each contact's latest thread and write what it finds, as pending.
 *
 * One contact at a time on purpose: the cap is checked before every request,
 * so a scan can stop in the middle having spent exactly what it was allowed to
 * and no more. A contact whose mail can't be read is stepped over — one
 * deleted thread shouldn't end the run — but the cap ends it immediately.
 *
 * `promises_scanned_at` is set for every contact that was read, including the
 * ones where nothing was found. "I looked and there was nothing" is the answer
 * that keeps the next scan cheap.
 */
export async function scanForPromises(
  db: SupabaseClient,
  userId: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const config = options.config ?? aiConfig();
  const now = options.now ?? new Date();
  const today = todayIn("Europe/Stockholm", now);

  const plan = await planScan(db, userId, { ...options, limit: options.limit ?? SCAN_BATCH });
  const result: ScanResult = {
    read: 0,
    found: 0,
    stoppedAtCap: false,
    failed: 0,
    remaining: plan.remaining,
    dropped: {},
  };
  if (plan.contacts.length === 0) return result;

  // Once for the whole scan. getAccessToken refreshes against Google every
  // call, so asking per contact would be one round trip per contact for a
  // token that is good for all of them.
  const token = await (options.accessToken ?? getAccessToken)(db, userId);

  for (const [index, candidate] of plan.contacts.entries()) {
    let found: { promises: FoundPromise[]; dropped: DropReason[] };
    try {
      found = await readOneContact(db, userId, candidate, today, config, token);
    } catch (failure) {
      if (failure instanceof AiCapReached) {
        result.stoppedAtCap = true;
        // Everything this press didn't get to is still waiting.
        result.remaining += plan.contacts.length - index;
        break;
      }
      // Gmail gone, a thread deleted, a token refused for one account: step
      // over it. The contact keeps its old scanned_at, so it is tried again.
      result.failed += 1;
      continue;
    }

    result.read += 1;
    for (const reason of found.dropped) result.dropped[reason] = (result.dropped[reason] ?? 0) + 1;
    if (found.promises.length > 0) {
      result.found += await writePromises(db, userId, candidate.contactId, found.promises);
    }

    const { error } = await db
      .from("contacts")
      .update({ promises_scanned_at: now.toISOString() })
      .eq("user_id", userId)
      .eq("id", candidate.contactId);
    if (error) throw supabaseError(error, "Couldn't record the scan");
  }

  return result;
}

/** One contact: read the thread, ask, check the answer. Nothing is written here. */
async function readOneContact(
  db: SupabaseClient,
  userId: string,
  candidate: ScanCandidate,
  today: string,
  config: AiConfig,
  token: string,
): Promise<{ promises: FoundPromise[]; dropped: DropReason[] }> {
  // Everything that can fail for free happens before the reservation, so a
  // request is only paid for when it is really sent (as generateSummary does).
  const { items: thread } = await loadThreadContext(db, userId, candidate.contactId);
  if (thread.length === 0) return { promises: [], dropped: [] };

  const conversation = await readConversation(token, thread);
  if (conversation.length === 0) return { promises: [], dropped: [] };

  const input = buildPromiseInput(candidate.name, conversation, today);
  const estimateUsd = maxCostOf(
    config.model,
    estimateTokens(PROMISE_INSTRUCTIONS + input) + 400,
    PROMISE_MAX_OUTPUT_TOKENS,
  );

  const raw = await withSpendCap(
    db,
    userId,
    {
      contactId: candidate.contactId,
      purpose: "promises",
      model: config.model,
      estimateUsd,
      capUsd: config.monthlyCapUsd,
    },
    async () => {
      const response = await createStructuredResponse<RawPromises>({
        apiKey: config.apiKey,
        model: config.model,
        instructions: PROMISE_INSTRUCTIONS,
        input,
        schemaName: "promises",
        schema: PROMISE_SCHEMA,
        maxOutputTokens: PROMISE_MAX_OUTPUT_TOKENS,
      });
      return { result: response.data, usage: response.usage };
    },
  );

  return checkPromises(raw, conversation, today);
}

/**
 * Write them as pending. A message that has already produced a promise this way
 * is left alone by the unique index — which is what makes "Not a promise"
 * stick, and what stops a second scan filling the queue with the same rows.
 */
async function writePromises(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  promises: FoundPromise[],
): Promise<number> {
  const { data, error } = await db
    .from("promises")
    .upsert(
      promises.map((promise) => ({
        user_id: userId,
        contact_id: contactId,
        thread_id: promise.threadId,
        message_id: promise.messageId,
        owed_by: promise.owedBy,
        due_on: promise.dueOn,
        reason: promise.reason,
      })),
      { onConflict: "user_id,message_id,owed_by", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw supabaseError(error, "Couldn't save what the scan found");

  return data?.length ?? 0;
}
