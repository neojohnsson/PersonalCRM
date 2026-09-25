import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "@/lib/contacts/display";
import { LIMITS, MAX_TAGS, MAX_TAG_LENGTH } from "@/lib/contacts/contact-form";
import { dayMonth } from "@/lib/format";
import { daysBetweenDates, isIsoDate } from "@/lib/relationship/dates";
import { loadRelationship } from "@/lib/relationship/load";
import {
  MAX_DAYS_AHEAD,
  MAX_REASON_LENGTH,
  finishNextTouch,
  openNextTouch,
  reopenNextTouch,
  setNextTouch,
  type NextTouch,
} from "@/lib/relationship/next-touch";
import { ContactNotFound, reopenThreadRow, setNeverChaseRow, settleThreadRow, settledAt } from "@/lib/relationship/settle";
import { supabaseError } from "@/lib/supabase/errors";
import { addContact, type NewContact } from "@/lib/contacts/edit-fields";

/**
 * The five things the Assistant may do on its own (AGENTS.md, amended
 * 2026-09-23; docs/slice-11-plan.md §2), and the Undo of each.
 *
 *   note                a dated line added to the contact's notes
 *   tags                tags added or taken away
 *   next_touch          a next touch set, moved or cleared
 *   conversation_done   the latest conversation marked done
 *   reminders           reminders about this person on or off
 *
 * Every one follows the same four steps, and the order matters:
 *
 *   1. read what is there now — the BEFORE
 *   2. make the change, through the same library function a button uses
 *   3. write both to `assistant_actions` (migration 0025)
 *   4. if that record cannot be written, put the before back
 *
 * Step 4 is why the exception in AGENTS.md can promise "logged": there is no
 * way for the Assistant to change something and leave no record of it. A
 * change nobody can see or undo is exactly what the exception does not allow.
 *
 * Nothing here can send, book, delete a contact or merge. Those are not
 * missing by accident; they have no function to call.
 */

export type ActionKind = "note" | "tags" | "next_touch" | "conversation_done" | "reminders" | "contact_creation";

type TouchState = { id: string; dueOn: string; reason: string | null; kind: string | null } | null;

/** What was there, and what there is now — the shapes Undo reads back. */
export type ActionState =
  | { kind: "note"; notes: string | null }
  | { kind: "tags"; tags: string[] }
  | { kind: "next_touch"; touch: TouchState }
  | { kind: "conversation_done"; threadId: string; settledAt: string | null }
  | { kind: "reminders"; neverChase: boolean }
  | { kind: "contact_creation"; snapshot: ContactCreationSnapshot | null };

export type ContactCreationSnapshot = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  createdAt: string;
};

export type LoggedAction = {
  id: string;
  contactId: string;
  kind: ActionKind;
  summary: string;
  before: ActionState;
  after: ActionState;
  createdAt: string;
  undoneAt: string | null;
};

/** The Assistant was not allowed to do it, in words it can pass on. */
export class ActionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRefused";
  }
}

/**
 * Undo pressed for something already undone — from the strip, then from the
 * chat's green box, say. The thing is as you wanted it, so the page treats
 * this as done rather than as a problem.
 */
export class AlreadyUndone extends ActionRefused {
  constructor() {
    super("That was already undone.");
    this.name = "AlreadyUndone";
  }
}

export type ActContext = {
  db: SupabaseClient;
  userId: string;
  /** YYYY-MM-DD, Swedish time. */
  today: string;
  /**
   * Every line of mail the Assistant has read in this conversation. A note may
   * not copy from these: a note that quotes a message is a way to store message
   * bodies, which the privacy page promises never happens.
   */
  mailSeen: string[];
};

/** The longest note line the Assistant may add. Its own words are short. */
export const MAX_ASSISTANT_NOTE = 500;

// ── The five ──────────────────────────────────────────────────────────────

/** A dated line added under whatever notes are there. Never replaces yours. */
export async function addNote(ctx: ActContext, contactId: string, text: string): Promise<LoggedAction> {
  const line = text.trim();
  if (!line) throw new ActionRefused("A note needs some words in it.");
  if (line.length > MAX_ASSISTANT_NOTE) {
    throw new ActionRefused(`A note from the Assistant is at most ${MAX_ASSISTANT_NOTE} characters.`);
  }
  if (copiesFrom(line, ctx.mailSeen)) {
    throw new ActionRefused(
      "That note copies words out of a message. Notes are written in your own words, and message text is never stored.",
    );
  }

  const contact = await loadContact(ctx, contactId);
  const dated = `${dayMonth(`${ctx.today}T12:00:00Z`)}: ${line}`;
  const notes = contact.notes?.trim() ? `${contact.notes.trimEnd()}\n\n${dated}` : dated;
  if (notes.length > LIMITS.notes) throw new ActionRefused("The notes on this contact are full.");

  await updateContact(ctx, contactId, { notes });
  return record(ctx, contactId, `Added a note to ${contact.name}`, { kind: "note", notes: contact.notes }, {
    kind: "note",
    notes,
  });
}

/** Tags added and taken away, cleaned the way the contact form cleans them. */
export async function changeTags(
  ctx: ActContext,
  contactId: string,
  add: string[],
  remove: string[],
): Promise<LoggedAction> {
  const contact = await loadContact(ctx, contactId);
  const removing = new Set(remove.map((tag) => tag.trim().toLowerCase()));
  const tags: string[] = [];
  for (const tag of [...contact.tags, ...add].map((value) => value.trim()).filter(Boolean)) {
    if (tag.length > MAX_TAG_LENGTH) throw new ActionRefused(`A tag is at most ${MAX_TAG_LENGTH} characters.`);
    if (removing.has(tag.toLowerCase())) continue;
    if (tags.some((kept) => kept.toLowerCase() === tag.toLowerCase())) continue;
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) throw new ActionRefused(`A contact has at most ${MAX_TAGS} tags.`);
  if (sameTags(tags, contact.tags)) throw new ActionRefused("Those tags are already as asked.");

  await updateContact(ctx, contactId, { tags });
  return record(ctx, contactId, `Changed the tags on ${contact.name}`, { kind: "tags", tags: contact.tags }, {
    kind: "tags",
    tags,
  });
}

/** A next touch set for a day, or the open one moved to it. */
/**
 * `waiting`: true when it is their move and the touch is to check in, false
 * when it is yours, null to keep what the open touch already is. Found
 * 2026-09-23: without this, moving a "waiting on them" touch passed no kind,
 * setNextTouch took that as "clear it", and the touch quietly became your move
 * -- Linda Jönsson's did.
 */
export async function setTouch(
  ctx: ActContext,
  contactId: string,
  dueOn: string,
  reason: string | null,
  waiting: boolean | null = null,
): Promise<LoggedAction> {
  if (!isIsoDate(dueOn)) throw new ActionRefused("A next touch needs a date like 2026-09-29.");
  if (dueOn < ctx.today) throw new ActionRefused("That day has already passed.");
  if (daysBetweenDates(ctx.today, dueOn) > MAX_DAYS_AHEAD) throw new ActionRefused("That is too far ahead.");
  const why = reason?.trim() || null;
  if (why && why.length > MAX_REASON_LENGTH) {
    throw new ActionRefused(`A reason is at most ${MAX_REASON_LENGTH} characters.`);
  }

  const contact = await loadContact(ctx, contactId);
  const before = touchState(await openNextTouch(ctx.db, ctx.userId, contactId));
  const kind = waiting === true ? "waiting_on_them" : waiting === false ? null : (before?.kind ?? null);
  const after = touchState(await setNextTouch(ctx.db, ctx.userId, contactId, { dueOn, reason: why, kind }));

  return record(
    ctx,
    contactId,
    before
      ? `Moved the next touch with ${contact.name} to ${dayMonth(`${dueOn}T12:00:00Z`)}`
      : `Set a next touch with ${contact.name} for ${dayMonth(`${dueOn}T12:00:00Z`)}`,
    { kind: "next_touch", touch: before },
    { kind: "next_touch", touch: after },
  );
}

/** The open next touch cleared — skipped, and kept as a record, as Skip does. */
export async function clearTouch(ctx: ActContext, contactId: string): Promise<LoggedAction> {
  const contact = await loadContact(ctx, contactId);
  const open = await openNextTouch(ctx.db, ctx.userId, contactId);
  if (!open) throw new ActionRefused(`Nothing is planned with ${contact.name}.`);

  await finishNextTouch(ctx.db, ctx.userId, open.id, "skipped");
  return record(
    ctx,
    contactId,
    `Cleared the next touch with ${contact.name}`,
    { kind: "next_touch", touch: touchState(open) },
    { kind: "next_touch", touch: null },
  );
}

/** The latest conversation with this contact marked done. */
export async function markDone(ctx: ActContext, contactId: string): Promise<LoggedAction> {
  const contact = await loadContact(ctx, contactId);
  const relationship = await loadRelationship(ctx.db, ctx.userId, contactId);
  if (relationship.turn.kind === "none") throw new ActionRefused(`There is no conversation with ${contact.name}.`);

  const threadId = relationship.turn.threadId;
  const was = await settledAt(ctx.db, ctx.userId, contactId, threadId);
  const now = new Date();
  await settleThreadRow(ctx.db, ctx.userId, contactId, threadId, now);

  return record(
    ctx,
    contactId,
    `Marked the conversation with ${contact.name} done`,
    { kind: "conversation_done", threadId, settledAt: was },
    { kind: "conversation_done", threadId, settledAt: now.toISOString() },
  );
}

/** Reminders about this person on or off ("Just a contact"). */
export async function setReminders(ctx: ActContext, contactId: string, on: boolean): Promise<LoggedAction> {
  const contact = await loadContact(ctx, contactId);
  if (contact.neverChase === !on) {
    throw new ActionRefused(`Reminders about ${contact.name} are already ${on ? "on" : "off"}.`);
  }

  await setNeverChaseRow(ctx.db, ctx.userId, contactId, !on);
  return record(
    ctx,
    contactId,
    `Turned reminders ${on ? "on" : "off"} for ${contact.name}`,
    { kind: "reminders", neverChase: contact.neverChase },
    { kind: "reminders", neverChase: !on },
  );
}

export async function createContact(ctx: ActContext, values: NewContact): Promise<LoggedAction> {
  const result = await addContact(ctx.db, ctx.userId, values);
  if (!result.ok) throw new ActionRefused(result.error);

  const { data, error } = await ctx.db
    .from("contacts")
    .select("id, first_name, last_name, company, role, created_at")
    .eq("user_id", ctx.userId)
    .eq("id", result.id)
    .maybeSingle();
  if (error) throw supabaseError(error, "Couldn't verify the created contact");
  if (!data) throw new ContactNotFound();
  const { data: email, error: emailError } = await ctx.db
    .from("contact_emails")
    .select("email")
    .eq("user_id", ctx.userId)
    .eq("contact_id", result.id)
    .order("is_primary", { ascending: false })
    .order("email")
    .limit(1)
    .maybeSingle();
  if (emailError) throw supabaseError(emailError, "Couldn't verify the created address");

  const snapshot: ContactCreationSnapshot = {
    id: result.id,
    firstName: data.first_name,
    lastName: data.last_name,
    email: (email?.email as string | undefined) ?? null,
    company: data.company,
    role: data.role,
    createdAt: data.created_at,
  };
  const name = displayName({ first_name: data.first_name, last_name: data.last_name, primary_email: snapshot.email });
  return record(
    ctx,
    result.id,
    `Created a new contact: ${name}`,
    { kind: "contact_creation", snapshot: null },
    { kind: "contact_creation", snapshot },
  );
}

// ── Undo ──────────────────────────────────────────────────────────────────

/**
 * Put back what one action changed, and stamp it undone.
 *
 * Only if nothing has changed since: if you edited the note by hand after the
 * Assistant added to it, putting back its "before" would throw your edit away.
 * Then Undo says so and does nothing, and the contact page is where to fix it.
 */
export async function undoAction(db: SupabaseClient, userId: string, actionId: string): Promise<LoggedAction> {
  const { data, error } = await db
    .from("assistant_actions")
    .select("id, contact_id, kind, summary, before, after, created_at, undone_at")
    .eq("user_id", userId)
    .eq("id", actionId)
    .maybeSingle();
  if (error) throw supabaseError(error, "Couldn't read what the Assistant did");
  if (!data) throw new ActionRefused("That action isn't there any more.");
  const action = toAction(data);
  if (action.undoneAt) throw new AlreadyUndone();

  const ctx: ActContext = { db, userId, today: "", mailSeen: [] };
  if (!(await stillAsLeft(ctx, action))) {
    throw new ActionRefused("It has changed since the Assistant did it, so Undo would throw your change away.");
  }

  await putBack(ctx, action.contactId, action.before, action.after);

  const undoneAt = new Date().toISOString();
  const { error: stampError } = await db
    .from("assistant_actions")
    .update({ undone_at: undoneAt })
    .eq("user_id", userId)
    .eq("id", actionId);
  if (stampError) throw supabaseError(stampError, "Couldn't mark it undone");

  return { ...action, undoneAt };
}

/** Whether the contact is still exactly as the action left it. */
async function stillAsLeft(ctx: ActContext, action: LoggedAction): Promise<boolean> {
  const after = action.after;
  switch (after.kind) {
    case "note":
    case "tags":
    case "reminders": {
      const contact = await loadContact(ctx, action.contactId);
      if (after.kind === "note") return (contact.notes ?? null) === (after.notes ?? null);
      if (after.kind === "tags") return sameTags(contact.tags, after.tags);
      return contact.neverChase === after.neverChase;
    }
    case "next_touch": {
      const open = touchState(await openNextTouch(ctx.db, ctx.userId, action.contactId));
      if (!after.touch) return open === null;
      return open !== null && open.id === after.touch.id && open.dueOn === after.touch.dueOn;
    }
    case "conversation_done": {
      const now = await settledAt(ctx.db, ctx.userId, action.contactId, after.threadId);
      return now !== null && new Date(now).getTime() === new Date(after.settledAt!).getTime();
    }
    case "contact_creation": {
      if (!after.snapshot) return false;
      const { data, error } = await ctx.db
        .from("contacts")
        .select("id, first_name, last_name, company, role, created_at")
        .eq("user_id", ctx.userId)
        .eq("id", after.snapshot.id)
        .maybeSingle();
      if (error || !data) return false;
      const { data: email } = await ctx.db
        .from("contact_emails")
        .select("email")
        .eq("user_id", ctx.userId)
        .eq("contact_id", after.snapshot.id)
        .order("is_primary", { ascending: false })
        .order("email")
        .limit(1)
        .maybeSingle();
      return data.first_name === after.snapshot.firstName && data.last_name === after.snapshot.lastName &&
        data.company === after.snapshot.company && data.role === after.snapshot.role &&
        data.created_at === after.snapshot.createdAt && ((email?.email as string | undefined) ?? null) === after.snapshot.email;
    }
  }
}

/** Write `before` back. Also what `record` uses when the log cannot be written. */
async function putBack(ctx: ActContext, contactId: string, before: ActionState, after: ActionState): Promise<void> {
  switch (before.kind) {
    case "note":
      return updateContact(ctx, contactId, { notes: before.notes });
    case "tags":
      return updateContact(ctx, contactId, { tags: before.tags });
    case "reminders":
      return setNeverChaseRow(ctx.db, ctx.userId, contactId, before.neverChase);
    case "conversation_done":
      if (before.settledAt === null) return reopenThreadRow(ctx.db, ctx.userId, contactId, before.threadId);
      return settleThreadRow(ctx.db, ctx.userId, contactId, before.threadId, new Date(before.settledAt));
    case "next_touch": {
      const made = after.kind === "next_touch" ? after.touch : null;
      if (before.touch === null) {
        // It made a touch where there was none: that touch goes.
        if (made) await deleteTouch(ctx, made.id);
        return;
      }
      if (made === null) {
        // It cleared one: the same touch opens again, on the day it had.
        await reopenNextTouch(ctx.db, ctx.userId, before.touch.id);
        return;
      }
      // It moved one: back to the day and reason it had.
      await setNextTouch(ctx.db, ctx.userId, contactId, {
        dueOn: before.touch.dueOn,
        reason: before.touch.reason,
        kind: before.touch.kind,
      });
      return;
    }
    case "contact_creation":
      if (!after || after.kind !== "contact_creation" || !after.snapshot) {
        throw new ActionRefused("That contact creation cannot be undone.");
      }
      {
        const { error } = await ctx.db.from("contacts").delete().eq("user_id", ctx.userId).eq("id", after.snapshot.id);
        if (error) throw supabaseError(error, "Couldn't undo the contact creation");
      }
      return;
  }
}

// ── Pieces ────────────────────────────────────────────────────────────────

/** Step 3, and step 4 if step 3 fails: no change without its record. */
async function record(
  ctx: ActContext,
  contactId: string,
  summary: string,
  before: ActionState,
  after: ActionState,
): Promise<LoggedAction> {
  const { data, error } = await ctx.db
    .from("assistant_actions")
    .insert({
      user_id: ctx.userId,
      contact_id: contactId,
      kind: before.kind,
      summary: summary.slice(0, 300),
      before,
      after,
    })
    .select("id, contact_id, kind, summary, before, after, created_at, undone_at")
    .single();

  if (error || !data) {
    await putBack(ctx, contactId, before, after).catch(() => undefined);
    throw error ? supabaseError(error, "Couldn't record what the Assistant did") : new Error("No record came back");
  }
  return toAction(data);
}

type ContactNow = { name: string; notes: string | null; tags: string[]; neverChase: boolean };

async function loadContact(ctx: ActContext, contactId: string): Promise<ContactNow> {
  // The row itself for what can change, and the list view for the name as the
  // app shows it (the view knows the primary address; the row does not).
  const [row, listed] = await Promise.all([
    ctx.db
      .from("contacts")
      .select("notes, tags, never_chase")
      .eq("user_id", ctx.userId)
      .eq("id", contactId)
      .maybeSingle<{ notes: string | null; tags: string[] | null; never_chase: boolean }>(),
    ctx.db
      .from("contact_list")
      .select("first_name, last_name, primary_email")
      .eq("user_id", ctx.userId)
      .eq("id", contactId)
      .maybeSingle<{ first_name: string | null; last_name: string | null; primary_email: string | null }>(),
  ]);
  if (row.error) throw supabaseError(row.error, "Couldn't load the contact");
  if (listed.error) throw supabaseError(listed.error, "Couldn't load the contact");
  // Somebody else's contact looks exactly like one that does not exist.
  if (!row.data || !listed.data) throw new ContactNotFound();

  return {
    name: displayName(listed.data),
    notes: row.data.notes ?? null,
    tags: row.data.tags ?? [],
    neverChase: Boolean(row.data.never_chase),
  };
}

async function updateContact(
  ctx: ActContext,
  contactId: string,
  change: { notes?: string | null; tags?: string[] },
): Promise<void> {
  const { data, error } = await ctx.db
    .from("contacts")
    .update(change)
    .eq("user_id", ctx.userId)
    .eq("id", contactId)
    .select("id");
  if (error) throw supabaseError(error, "Couldn't change the contact");
  if (data.length === 0) throw new ContactNotFound();
}

async function deleteTouch(ctx: ActContext, touchId: string): Promise<void> {
  const { error } = await ctx.db.from("next_touches").delete().eq("user_id", ctx.userId).eq("id", touchId);
  if (error) throw supabaseError(error, "Couldn't take the next touch away");
}

function touchState(touch: NextTouch | null): TouchState {
  return touch ? { id: touch.id, dueOn: touch.due_on, reason: touch.reason, kind: touch.kind } : null;
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function toAction(row: Record<string, unknown>): LoggedAction {
  return {
    id: row.id as string,
    contactId: row.contact_id as string,
    kind: row.kind as ActionKind,
    summary: row.summary as string,
    before: row.before as ActionState,
    after: row.after as ActionState,
    createdAt: row.created_at as string,
    undoneAt: (row.undone_at as string | null) ?? null,
  };
}

/**
 * Whether `text` repeats a run of `minRun` characters from any of `sources`,
 * ignoring case and spacing. Forty characters is about seven words: long
 * enough that a phrase anyone might use ("thanks for getting back to me") does
 * not trip it, short enough that a copied sentence does.
 */
export function copiesFrom(text: string, sources: string[], minRun = 40): boolean {
  const squash = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const note = squash(text);
  if (note.length < minRun) return false;
  const haystacks = sources.map(squash).filter((source) => source.length >= minRun);
  if (haystacks.length === 0) return false;

  for (let start = 0; start + minRun <= note.length; start += 1) {
    const run = note.slice(start, start + minRun);
    if (haystacks.some((source) => source.includes(run))) return true;
  }
  return false;
}
