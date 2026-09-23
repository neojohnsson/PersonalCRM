import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLDING_TABLES } from "@/lib/privacy/holdings";
import { supabaseError } from "@/lib/supabase/errors";
import { DEFAULT_PAGE_SIZE, readAll } from "@/lib/supabase/read-all";

/**
 * Handing the data back (plan.md §3.12; docs/slice-7-plan.md, Part 2).
 *
 * Three files, for three different questions:
 *
 *   everything      "what do you have on me?", asked by the account holder
 *   contacts.csv    "I want my list somewhere else"
 *   one person      "what do you have on *me*?", asked by somebody in the list
 *
 * The last one is the one plan.md §5.2 is about: "A person in your database can
 * demand a copy of what you hold on them, and demand deletion — from you.
 * Including the AI summary." It has to be a file you can send, not a screen you
 * describe over the phone.
 *
 * Nothing is written anywhere. The file is built for the request and streamed
 * to the browser.
 */

/** What the export refuses to hand over, and why. */
const REDACTED: Record<string, string[]> = {
  // Encrypted with a key that isn't in the file, so it could only ever be
  // noise — and a secret, even an unreadable one, has no business in a
  // download that gets forwarded and saved.
  google_accounts: ["refresh_token_encrypted"],
  google_calendar: ["refresh_token_encrypted"],
};

export type Everything = {
  exported_at: string;
  account: { id: string; email: string | null };
  note: string;
  tables: Record<string, Record<string, unknown>[]>;
};

/** Every row of every table this user owns. */
export async function exportEverything(
  db: SupabaseClient,
  userId: string,
  email: string | null,
): Promise<Everything> {
  const tables: Everything["tables"] = {};

  for (const table of HOLDING_TABLES) {
    const rows = await readAll<Record<string, unknown>>(
      (from, to) => db.from(table).select("*").eq("user_id", userId).range(from, to),
      `Couldn't export ${table}`,
      DEFAULT_PAGE_SIZE,
    );
    tables[table] = rows.map((row) => without(row, REDACTED[table] ?? []));
  }

  return {
    exported_at: new Date().toISOString(),
    account: { id: userId, email },
    note: "Message bodies are not stored by this app and so are not in this file. The Gmail refresh token is left out on purpose.",
    tables,
  };
}

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  emails: string[] | null;
  tags: string[] | null;
  message_count: number | null;
  last_contact_at: string | null;
  created_at: string;
};

/** The contact list as a spreadsheet, for taking somewhere else. */
export async function contactsCsv(db: SupabaseClient, userId: string): Promise<string> {
  const rows = await readAll<ContactRow>(
    (from, to) =>
      db
        .from("contact_list")
        .select("id, first_name, last_name, company, role, emails, tags, message_count, last_contact_at, created_at")
        .eq("user_id", userId)
        .order("last_name")
        .range(from, to),
    "Couldn't export the contacts",
  );

  const header = [
    "first_name",
    "last_name",
    "company",
    "role",
    "emails",
    "tags",
    "messages",
    "last_contact",
    "added",
  ];

  const lines = rows.map((row) =>
    [
      row.first_name ?? "",
      row.last_name ?? "",
      row.company ?? "",
      row.role ?? "",
      (row.emails ?? []).join(" "),
      (row.tags ?? []).join(" "),
      String(row.message_count ?? 0),
      row.last_contact_at ?? "",
      row.created_at,
    ]
      .map(csvCell)
      .join(","),
  );

  return [header.join(","), ...lines].join("\r\n");
}

export type PersonExport = {
  exported_at: string;
  note: string;
  contact: Record<string, unknown> | null;
  email_addresses: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  ai_summaries: Record<string, unknown>[];
  next_touches: Record<string, unknown>[];
  promises: Record<string, unknown>[];
  settled_threads: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
  assistant_actions: Record<string, unknown>[];
};

/**
 * One person's record, to hand to that person.
 *
 * Their messages are found by address, the same way the app decides which mail
 * is theirs — so the file matches what the app actually treats as their record,
 * rather than a second, kinder answer.
 */
export async function exportPerson(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<PersonExport> {
  const [contact, addresses] = await Promise.all([
    db.from("contacts").select("*").eq("user_id", userId).eq("id", contactId).maybeSingle(),
    db.from("contact_emails").select("*").eq("user_id", userId).eq("contact_id", contactId),
  ]);
  if (contact.error) throw supabaseError(contact.error, "Couldn't export the contact");
  if (addresses.error) throw supabaseError(addresses.error, "Couldn't export the addresses");

  const theirAddresses = (addresses.data ?? []).map((row) => String(row.email));

  const [summaries, touches, promises, settled, drafts, assistantActions, messages] = await Promise.all([
    rowsFor(db, "contact_summaries", userId, contactId),
    rowsFor(db, "next_touches", userId, contactId),
    rowsFor(db, "promises", userId, contactId),
    rowsFor(db, "settled_threads", userId, contactId),
    rowsFor(db, "contact_drafts", userId, contactId),
    rowsFor(db, "assistant_actions", userId, contactId),
    messagesFor(db, userId, theirAddresses),
  ]);

  return {
    exported_at: new Date().toISOString(),
    note: "Everything this app holds about this person. Message bodies are not stored — only who wrote to whom, when, and the subject line.",
    contact: contact.data ?? null,
    email_addresses: addresses.data ?? [],
    messages,
    ai_summaries: summaries,
    next_touches: touches,
    promises,
    settled_threads: settled,
    drafts,
    assistant_actions: assistantActions,
  };
}

async function rowsFor(
  db: SupabaseClient,
  table: string,
  userId: string,
  contactId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .eq("contact_id", contactId);
  if (error) throw supabaseError(error, `Couldn't export ${table}`);
  return data ?? [];
}

/** Mail to or from any of their addresses — the same rule the app matches by. */
async function messagesFor(
  db: SupabaseClient,
  userId: string,
  addresses: string[],
): Promise<Record<string, unknown>[]> {
  if (addresses.length === 0) return [];

  const list = addresses
    .map((address) => `"${address.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");

  return readAll<Record<string, unknown>>(
    (from, to) =>
      db
        .from("gmail_messages")
        .select("*")
        .eq("user_id", userId)
        .or(`from_email.in.(${list}),to_emails.ov.{${list}},cc_emails.ov.{${list}}`)
        .order("internal_date")
        .range(from, to),
    "Couldn't export the messages",
  );
}

function without(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  if (columns.length === 0) return row;
  const kept = { ...row };
  for (const column of columns) delete kept[column];
  return kept;
}

/** RFC 4180: quote anything with a comma, a quote or a line break in it. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
