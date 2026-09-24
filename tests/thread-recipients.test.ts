import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/lib/ai/conversation";
import { buildPromiseInput } from "@/lib/ai/promises";
import { buildInput } from "@/lib/ai/summary";
import { loadThreadContext, participantNamer, recipientsOf } from "@/lib/ai/thread";
import { runTool, type ToolContext } from "@/lib/assistant/tools";

/**
 * Everyone on a thread, for every AI input (2026-09-24). The user asked who
 * Linda had sent a mail on to, and the Assistant could not say: it saw who
 * wrote each message, never who it went to. Summaries, drafts and the promise
 * scan had the same blind spot. The recipients were in the synced headers all
 * along; now every input names them, through one helper.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient };
let alva: Person;
let bea: Person;
let lindaId: string;
const tag = randomUUID().slice(0, 6);
const me = `alva-${tag}@example.se`;
const linda = `linda.jonsson@ljungby-${tag}.se`;
const karin = `karin@combitech-${tag}.se`;
const stranger = `kommunen-${tag}@example.org`;
const thread = `t-${randomUUID()}`;

async function person(label: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  return { user: data.user, db };
}

async function contact(who: Person, first: string, last: string, email: string): Promise<string> {
  const { data, error } = await who.db
    .from("contacts")
    .insert({ user_id: who.user.id, first_name: first, last_name: last, source: "gmail" })
    .select("id")
    .single();
  if (error) throw error;
  await who.db.from("contact_emails").insert({ user_id: who.user.id, contact_id: data.id, email, is_primary: true });
  return data.id;
}

beforeAll(async () => {
  alva = await person("recipients-alva");
  bea = await person("recipients-bea");
  lindaId = await contact(alva, "Linda", "Jönsson", linda);
  await contact(alva, "Karin", "Lindqvist", karin);
  await admin.from("google_accounts").insert({ user_id: alva.user.id, email: me, refresh_token_encrypted: "x", scopes: [] });

  // Linda writes to Alva and Karin, copying the council; Alva answers Linda.
  const rows = [
    { at: "2026-09-20T09:00:00Z", direction: "inbound", from: linda, to: [me, karin], cc: [stranger] },
    { at: "2026-09-21T09:00:00Z", direction: "outbound", from: me, to: [linda], cc: [karin] },
  ];
  for (const row of rows) {
    const { error } = await admin.from("gmail_messages").insert({
      user_id: alva.user.id,
      gmail_message_id: `m-${randomUUID()}`,
      thread_id: thread,
      internal_date: row.at,
      from_email: row.from,
      to_emails: row.to,
      cc_emails: row.cc,
      has_list_unsubscribe: false,
      direction: row.direction,
      subject: "Äldreomsorgen",
    });
    if (error) throw error;
  }
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("naming who was on a message", () => {
  it("says you, a contact's name, or the address", async () => {
    const nameOf = await participantNamer(alva.db, alva.user.id, [
      { direction: "inbound", from_email: linda, to_emails: [me, karin], cc_emails: [stranger] },
    ]);
    expect([me, karin, stranger, linda.toUpperCase()].map(nameOf)).toEqual([
      "you",
      "Karin Lindqvist",
      stranger,
      "Linda Jönsson",
    ]);
  });

  it("never names somebody else's contacts", async () => {
    const nameOf = await participantNamer(bea.db, bea.user.id, [
      { direction: "inbound", from_email: linda, to_emails: [karin], cc_emails: [] },
    ]);
    expect([linda, karin].map(nameOf)).toEqual([linda, karin]);
  });

  it("writes a line the model can read, and cuts a long list rather than dropping it", () => {
    expect(recipientsOf({ to: ["you", "Karin Lindqvist"], cc: [stranger] })).toBe(
      ` · to you, Karin Lindqvist · cc ${stranger}`,
    );
    expect(recipientsOf({ to: [], cc: [] })).toBe("");
    const many = Array.from({ length: 11 }, (_, n) => `p${n}@x.se`);
    expect(recipientsOf({ to: many })).toBe(` · to ${many.slice(0, 8).join(", ")}, and 3 more`);
  });
});

describe("every AI input sees everyone", () => {
  it("the thread loader gives each message its to and cc", async () => {
    const { items } = await loadThreadContext(alva.db, alva.user.id, lindaId);
    expect(items.map((item) => [item.from, item.to, item.cc])).toEqual([
      ["them", ["you", "Karin Lindqvist"], [stranger]],
      ["you", ["Linda Jönsson"], ["Karin Lindqvist"]],
    ]);
  });

  it("summaries and the promise scan put them on each message's line", async () => {
    const { items } = await loadThreadContext(alva.db, alva.user.id, lindaId);
    const conversation: ConversationMessage[] = items.map((item, index) => ({ ...item, ref: `m${index + 1}`, text: "…" }));

    for (const input of [
      buildInput("Linda Jönsson", [linda], conversation, "2026-09-24"),
      buildPromiseInput("Linda Jönsson", conversation, "2026-09-24"),
    ]) {
      expect(input).toContain(`from them · to you, Karin Lindqvist · cc ${stranger}`);
      expect(input).toContain("from you · to Linda Jönsson · cc Karin Lindqvist");
    }
  });

  it("the Assistant reads them too, still marked as mail", async () => {
    const ctx: ToolContext = { db: alva.db, userId: alva.user.id, today: "2026-09-24", now: new Date("2026-09-24T10:00:00Z"), mailSeen: [] };
    const outcome = await runTool(ctx, "read_latest_thread", JSON.stringify({ contact_id: lindaId }));
    const result = (outcome as { result: { untrusted_mail: boolean; messages: { from: string; to: string[]; cc: string[] }[] } }).result;

    expect(result.untrusted_mail).toBe(true);
    expect(result.messages.map((message) => [message.from, message.to, message.cc])).toEqual([
      ["you", ["Linda Jönsson"], ["Karin Lindqvist"]],
      ["Linda Jönsson", ["you", "Karin Lindqvist"], [stranger]],
    ]);
  });
});
