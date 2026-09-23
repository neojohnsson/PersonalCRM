import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";

/**
 * The three things you can say about a contact (docs/slice-6c-plan.md), as
 * plain functions on the database.
 *
 * They lived inside app/relationship-actions.ts until slice 11. The Assistant
 * does two of them on its own, from a route that has no page to refresh — so
 * the writes moved here, and both the buttons and the Assistant call these.
 * One implementation of "mark this conversation done", whoever presses it.
 *
 * Every one filters by the user and runs as them: RLS and the composite
 * foreign key of migration 0018 decide which contacts and threads they may
 * touch.
 */

const FOREIGN_KEY_VIOLATION = "23503";

/** Not their contact, or gone: the same answer either way. */
export class ContactNotFound extends Error {
  constructor() {
    super("That contact doesn't exist.");
    this.name = "ContactNotFound";
  }
}

/**
 * "Conversation done": this conversation is finished, as of `at`.
 *
 * `at` is normally now. Undo of an Assistant action passes the moment it had
 * before, so putting a settle back puts back THAT settle.
 */
export async function settleThreadRow(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  threadId: string,
  at: Date = new Date(),
): Promise<void> {
  const { error } = await db.from("settled_threads").upsert(
    {
      user_id: userId,
      contact_id: contactId,
      thread_id: threadId,
      // Said again, meant again: the moment moves, so a message you have since
      // read and settled doesn't re-open the thread behind you.
      settled_at: at.toISOString(),
    },
    { onConflict: "user_id,contact_id,thread_id" },
  );
  if (error?.code === FOREIGN_KEY_VIOLATION) throw new ContactNotFound();
  if (error) throw supabaseError(error, "Couldn't settle the thread");
}

/** Undo of that: the conversation counts again from the message it was at. */
export async function reopenThreadRow(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  threadId: string,
): Promise<void> {
  const { error } = await db
    .from("settled_threads")
    .delete()
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("thread_id", threadId);
  if (error) throw supabaseError(error, "Couldn't reopen the thread");
}

/** When this thread was settled, or null if it isn't. What an undo needs. */
export async function settledAt(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  threadId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("settled_threads")
    .select("settled_at")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("thread_id", threadId)
    .maybeSingle<{ settled_at: string }>();
  if (error) throw supabaseError(error, "Couldn't read the thread");
  return data?.settled_at ?? null;
}

/** "Just a contact": never prompted about, until you say otherwise. */
export async function setNeverChaseRow(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  neverChase: boolean,
): Promise<void> {
  const { data, error } = await db
    .from("contacts")
    .update({ never_chase: neverChase })
    .eq("user_id", userId)
    .eq("id", contactId)
    .select("id");
  if (error) throw supabaseError(error, "Couldn't change how this contact is handled");
  if (data.length === 0) throw new ContactNotFound();
}
