import type { SupabaseClient } from "@supabase/supabase-js";
import { touchesByContact, type ContactAddress, type StoredMessage, type Touch } from "@/lib/relationship/touches";
import { warmth, type Warmth, type WarmthMeeting } from "@/lib/relationship/warmth";
import { whoseTurn, type Turn } from "@/lib/relationship/whose-turn";
import { supabaseError } from "@/lib/supabase/errors";
import { DEFAULT_PAGE_SIZE, readAll } from "@/lib/supabase/read-all";

/**
 * Whose turn and warmth for every one of a user's contacts, from two queries:
 * their contact addresses and their stored message headers
 * (docs/slice-3-plan.md, step 3).
 *
 * The calculations run here, on the server, rather than once per contact in
 * the database: one pass over a few thousand small rows, with the rules living
 * in tested TypeScript (lib/relationship/whose-turn.ts and warmth.ts).
 *
 * Takes the client and user id, like the sync, and filters by user_id itself.
 */

export type Relationship = {
  turn: Turn;
  warmth: Warmth | null;
  messageCount: number;
  /**
   * When you said nothing more was owed in the contact's *latest* thread, if
   * you did (migration 0018). Older threads aren't loaded: the app only ever
   * talks about the newest one.
   */
  settledAt: Date | null;
  /** "Just a contact": never prompted about. */
  neverChase: boolean;
};

/** For a contact with no stored mail at all. */
export const NO_MAIL: Relationship = {
  turn: { kind: "none" },
  warmth: null,
  messageCount: 0,
  settledAt: null,
  neverChase: false,
};

/** A thread the user has said needs nothing more, and when they said it. */
type SettledRow = { contact_id: string; thread_id: string; settled_at: string };

/** A meeting with a contact (slice 8a). Warmth needs only when it started. */
type MeetingRow = { contact_id: string; started_at: string };

const MESSAGE_COLUMNS =
  "gmail_message_id, thread_id, direction, internal_date, from_email, to_emails, cc_emails, subject";

export async function loadRelationships(
  db: SupabaseClient,
  userId: string,
  options: { now?: Date; pageSize?: number } = {},
): Promise<Map<string, Relationship>> {
  const now = options.now ?? new Date();
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  const [addresses, messages, settled, contacts, meetings] = await Promise.all([
    readAll<ContactAddress>(
      (from, to) =>
        db
          .from("contact_emails")
          .select("contact_id, email")
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load contact addresses",
      pageSize,
    ),
    readAll<StoredMessage>(
      (from, to) =>
        db
          .from("gmail_messages")
          .select(MESSAGE_COLUMNS)
          .eq("user_id", userId)
          .order("id")
          .range(from, to),
      "Couldn't load messages",
      pageSize,
    ),
    readAll<SettledRow>(
      (from, to) =>
        db
          .from("settled_threads")
          .select("contact_id, thread_id, settled_at")
          .eq("user_id", userId)
          .order("thread_id")
          .range(from, to),
      "Couldn't load settled threads",
      pageSize,
    ),
    readAll<{ id: string; never_chase: boolean }>(
      (from, to) =>
        db.from("contacts").select("id, never_chase").eq("user_id", userId).order("id").range(from, to),
      "Couldn't load contacts",
      pageSize,
    ),
    // Meetings, if the calendar is connected. A missing table would be an
    // error; an unconnected calendar is simply no rows.
    readAll<MeetingRow>(
      (from, to) =>
        db
          .from("calendar_meetings")
          .select("contact_id, started_at")
          .eq("user_id", userId)
          .eq("accepted", true)
          .order("started_at")
          .range(from, to),
      "Couldn't load meetings",
      pageSize,
    ),
  ]);

  const settledBy = settledByContact(settled);
  const metBy = meetingsByContact(meetings);

  // Every contact gets an entry, not only the ones with mail: "never chase" is
  // a thing you said about the person, and it holds whether they ever wrote.
  const relationships = new Map<string, Relationship>();
  for (const contact of contacts) {
    relationships.set(contact.id, { ...NO_MAIL, neverChase: contact.never_chase });
  }

  for (const [contactId, touches] of touchesByContact(messages, addresses)) {
    const turn = whoseTurn(touches, now);
    relationships.set(contactId, {
      turn,
      warmth: warmth(touches, now, metBy.get(contactId) ?? []),
      messageCount: touches.length,
      settledAt: settledFor(settledBy.get(contactId), turn),
      neverChase: relationships.get(contactId)?.neverChase ?? false,
    });
  }

  return relationships;
}

function meetingsByContact(rows: MeetingRow[]): Map<string, WarmthMeeting[]> {
  const byContact = new Map<string, WarmthMeeting[]>();
  for (const row of rows) {
    const met = byContact.get(row.contact_id) ?? [];
    met.push({ startedAt: new Date(row.started_at) });
    byContact.set(row.contact_id, met);
  }
  return byContact;
}

function settledByContact(rows: SettledRow[]): Map<string, Map<string, Date>> {
  const byContact = new Map<string, Map<string, Date>>();
  for (const row of rows) {
    const threads = byContact.get(row.contact_id) ?? new Map<string, Date>();
    threads.set(row.thread_id, new Date(row.settled_at));
    byContact.set(row.contact_id, threads);
  }
  return byContact;
}

/** The settle on the thread the turn is about — the newest one. */
function settledFor(threads: Map<string, Date> | undefined, turn: Turn): Date | null {
  if (!threads || turn.kind === "none") return null;
  return threads.get(turn.threadId) ?? null;
}

/**
 * The same, for one contact — for their own page, where loading every message
 * in the mailbox would be wasted work. The database hands back only mail from
 * or to one of their addresses; the rules that decide whether it's a touch
 * are still touchesByContact's, so the answer is the same as in the list.
 *
 * Addresses are stored lowercased on both sides (lib/google/parse.ts,
 * lib/contacts/contact-form.ts), so exact matching finds them all.
 */
export async function loadRelationship(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  options: { now?: Date; pageSize?: number } = {},
): Promise<Relationship> {
  const now = options.now ?? new Date();

  const [touches, settledResult, contactResult, meetingsResult] = await Promise.all([
    contactTouches(db, userId, contactId, options),
    db
      .from("settled_threads")
      .select("contact_id, thread_id, settled_at")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .returns<SettledRow[]>(),
    db
      .from("contacts")
      .select("never_chase")
      .eq("user_id", userId)
      .eq("id", contactId)
      .maybeSingle<{ never_chase: boolean }>(),
    db
      .from("calendar_meetings")
      .select("contact_id, started_at")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .eq("accepted", true)
      .order("started_at")
      .returns<MeetingRow[]>(),
  ]);
  if (settledResult.error) throw supabaseError(settledResult.error, "Couldn't load settled threads");
  if (contactResult.error) throw supabaseError(contactResult.error, "Couldn't load the contact");
  if (meetingsResult.error) throw supabaseError(meetingsResult.error, "Couldn't load meetings");

  const neverChase = contactResult.data?.never_chase ?? false;
  if (!touches) return { ...NO_MAIL, neverChase };

  const turn = whoseTurn(touches, now);
  return {
    turn,
    warmth: warmth(touches, now, meetingsResult.data.map((row) => ({ startedAt: new Date(row.started_at) }))),
    messageCount: touches.length,
    settledAt: settledFor(settledByContact(settledResult.data).get(contactId), turn),
    neverChase,
  };
}

/**
 * Every touch with one contact, oldest first — null if there are none. Used
 * by loadRelationship, and by the AI summary to pick which messages to read.
 */
export async function contactTouches(
  db: SupabaseClient,
  userId: string,
  contactId: string,
  options: { pageSize?: number } = {},
): Promise<Touch[] | null> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  const { data: addresses, error } = await db
    .from("contact_emails")
    .select("contact_id, email")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .returns<ContactAddress[]>();
  if (error) throw supabaseError(error, "Couldn't load the contact's addresses");
  if (addresses.length === 0) return null;

  const list = postgrestList(addresses.map((address) => address.email));
  const messages = await readAll<StoredMessage>(
    (from, to) =>
      db
        .from("gmail_messages")
        .select(MESSAGE_COLUMNS)
        .eq("user_id", userId)
        .or(`from_email.in.(${list}),to_emails.ov.{${list}},cc_emails.ov.{${list}}`)
        .order("id")
        .range(from, to),
    "Couldn't load the contact's messages",
    pageSize,
  );

  return touchesByContact(messages, addresses).get(contactId) ?? null;
}

/**
 * Values for a PostgREST filter list, each in double quotes so a comma, brace
 * or bracket inside an address can't end the list early.
 */
function postgrestList(values: string[]): string {
  return values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
}
