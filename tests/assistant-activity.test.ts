import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AlreadyUndone, addNote, undoAction } from "@/lib/assistant/act";
import { recentActions } from "@/lib/assistant/activity";

/**
 * "Everything it did" (slice 11, commit 7): the list on /assistant/activity
 * and the latest row in the strip on /assistant, both from assistant_actions.
 *
 * Two users, as every table: what the Assistant did for Alva is not Bea's to
 * see, and not Bea's to undo.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient; contactId: string };
let alva: Person;
let bea: Person;

async function person(label: string, first: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  const { data: contact } = await db
    .from("contacts")
    .insert({ user_id: data.user.id, first_name: first, last_name: "Test", source: "manual" })
    .select("id")
    .single();
  return { user: data.user, db, contactId: contact!.id };
}

const ctx = (who: Person) => ({ db: who.db, userId: who.user.id, today: "2026-09-23", mailSeen: [] });

beforeAll(async () => {
  alva = await person("activity-alva", "Karin");
  bea = await person("activity-bea", "Johan");
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("everything it did", () => {
  it("is empty before it has done anything", async () => {
    expect(await recentActions(alva.db, alva.user.id)).toEqual([]);
  });

  it("lists what it did, newest first, in the words written when it happened", async () => {
    const first = await addNote(ctx(alva), alva.contactId, "Wants the thesis dates.");
    const second = await addNote(ctx(alva), alva.contactId, "Prefers Teams.");

    const rows = await recentActions(alva.db, alva.user.id);
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows[0]).toMatchObject({
      kind: "note",
      summary: "Added a note to Karin Test",
      contactId: alva.contactId,
      undoneAt: null,
    });
  });

  it("shows an undone action as undone, and keeps it in the list", async () => {
    const [latest] = await recentActions(alva.db, alva.user.id, 1);
    await undoAction(alva.db, alva.user.id, latest.id);

    const rows = await recentActions(alva.db, alva.user.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].undoneAt).not.toBeNull();
    expect(rows[1].undoneAt).toBeNull();

    // Pressed again — from the chat's green box after the strip, say — it is
    // told apart from a real refusal, so the page can treat it as done.
    await expect(undoAction(alva.db, alva.user.id, latest.id)).rejects.toBeInstanceOf(AlreadyUndone);
  });

  it("gives the strip only the latest", async () => {
    expect(await recentActions(alva.db, alva.user.id, 1)).toHaveLength(1);
  });

  it("is only ever your own — not seen, and not undone, by anyone else", async () => {
    await addNote(ctx(bea), bea.contactId, "Owes me a reference.");
    const alvas = await recentActions(alva.db, alva.user.id);

    expect((await recentActions(bea.db, bea.user.id)).map((row) => row.summary)).toEqual([
      "Added a note to Johan Test",
    ]);
    // Asked for by Alva's id outright: RLS answers, not the filter.
    expect(await recentActions(bea.db, alva.user.id)).toEqual([]);
    // And Bea's Undo on Alva's action finds nothing to undo.
    await expect(undoAction(bea.db, bea.user.id, alvas[1].id)).rejects.toThrow(/isn't there any more/);
    const { data } = await admin.from("assistant_actions").select("undone_at").eq("id", alvas[1].id).single();
    expect(data!.undone_at).toBeNull();
  });
});

describe("the pages", () => {
  it("send you Home from the list when the Assistant isn't yours, as /assistant does", () => {
    const page = readFileSync("app/assistant/activity/page.tsx", "utf8");
    expect(page).toMatch(/if \(!\(await hasAssistant\(supabase, user\.id\)\)\) redirect\("\/"\)/);
  });

  it("link the strip to the full list", () => {
    const page = readFileSync("app/assistant/page.tsx", "utf8");
    expect(page).toContain('href="/assistant/activity"');
  });
});
