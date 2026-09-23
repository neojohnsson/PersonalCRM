import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EditContactNotFound, addContact, applyFieldChanges } from "@/lib/contacts/edit-fields";
import { runTool, toolDefinitions, type ToolContext } from "@/lib/assistant/tools";

/**
 * The Assistant's contact cards (slice 11b, commit 3): a few details changed,
 * or a contact added, through the edit form's own checks and save_contact.
 *
 * Two users, and the one thing a card must never do: change something it did
 * not show, or overwrite a change you made after it was drawn.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Person = { user: User; db: SupabaseClient; ctx: ToolContext };
let alva: Person;
let bea: Person;
let karinId: string;
let karinEmail: string;

async function person(label: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  const ctx: ToolContext = { db, userId: data.user.id, today: "2026-09-23", now: new Date("2026-09-23T10:00:00Z"), mailSeen: [] };
  return { user: data.user, db, ctx };
}

async function karin() {
  const { data } = await admin
    .from("contacts")
    .select("first_name, last_name, company, role, phone, notes, tags")
    .eq("id", karinId)
    .single();
  const { data: emails } = await admin.from("contact_emails").select("email").eq("contact_id", karinId);
  return { ...data!, emails: emails!.map((row) => row.email) };
}

beforeAll(async () => {
  alva = await person("edit-alva");
  bea = await person("edit-bea");
  karinEmail = `karin@combitech-${randomUUID().slice(0, 6)}.se`;
  const { data, error } = await alva.db.rpc("save_contact", {
    p_user_id: alva.user.id,
    p_contact_id: null,
    p_contact: {
      first_name: "Karin",
      last_name: "Lindqvist",
      company: "Combitech",
      role: null,
      one_liner: null,
      how_known: null,
      phone: null,
      notes: "Met at the fair.",
      tags: ["thesis"],
    },
    p_emails: [karinEmail],
  });
  if (error) throw error;
  karinId = data as string;
});

afterAll(async () => {
  for (const who of [alva, bea]) if (who) await admin.auth.admin.deleteUser(who.user.id);
});

describe("changing a contact's details from a card", () => {
  it("changes only what the card showed, and leaves notes, tags and addresses alone", async () => {
    const result = await applyFieldChanges(alva.db, alva.user.id, karinId, [
      { field: "company", before: "Combitech", after: "Saab" },
      { field: "role", before: null, after: "Thesis supervisor" },
    ]);

    expect(result).toEqual({ ok: true });
    expect(await karin()).toEqual({
      first_name: "Karin",
      last_name: "Lindqvist",
      company: "Saab",
      role: "Thesis supervisor",
      phone: null,
      notes: "Met at the fair.",
      tags: ["thesis"],
      emails: [karinEmail],
    });
  });

  it("puts back exactly the old values when undone", async () => {
    const result = await applyFieldChanges(alva.db, alva.user.id, karinId, [
      { field: "company", before: "Saab", after: "Combitech" },
      { field: "role", before: "Thesis supervisor", after: null },
    ]);

    expect(result).toEqual({ ok: true });
    expect(await karin()).toMatchObject({ company: "Combitech", role: null, notes: "Met at the fair." });
  });

  it("never overwrites a change made after the card was drawn", async () => {
    // The card said Combitech; somebody has since typed something else.
    await admin.from("contacts").update({ company: "Combitech AB" }).eq("id", karinId);

    const result = await applyFieldChanges(alva.db, alva.user.id, karinId, [
      { field: "company", before: "Combitech", after: "Saab" },
    ]);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Company has changed since/) });
    expect((await karin()).company).toBe("Combitech AB");
  });

  it("refuses a field a card may not touch", async () => {
    const result = await applyFieldChanges(alva.db, alva.user.id, karinId, [
      // A POST can carry anything; notes are the add_note tool's, logged.
      { field: "notes" as never, before: "Met at the fair.", after: "Overwritten." },
    ]);
    expect(result).toMatchObject({ ok: false });
    expect((await karin()).notes).toBe("Met at the fair.");
  });

  it("keeps the form's own checks", async () => {
    const result = await applyFieldChanges(alva.db, alva.user.id, karinId, [
      { field: "phone", before: null, after: "call me maybe" },
    ]);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^Phone: /) });
  });

  it("finds nothing of somebody else's", async () => {
    await expect(
      applyFieldChanges(bea.db, bea.user.id, karinId, [{ field: "company", before: "Combitech AB", after: "Mine" }]),
    ).rejects.toBeInstanceOf(EditContactNotFound);
    // Even naming Alva as the owner: RLS answers, not the argument.
    await expect(
      applyFieldChanges(bea.db, alva.user.id, karinId, [{ field: "company", before: "Combitech AB", after: "Mine" }]),
    ).rejects.toBeInstanceOf(EditContactNotFound);
    expect((await karin()).company).toBe("Combitech AB");
  });
});

describe("adding a contact from a card", () => {
  it("adds one, as the Add contact form would", async () => {
    const email = `johan@wexnet-${randomUUID().slice(0, 6)}.se`;
    const result = await addContact(alva.db, alva.user.id, {
      first_name: "Johan",
      last_name: "Berg",
      company: "Wexnet",
      role: null,
      email,
    });

    expect(result).toMatchObject({ ok: true, id: expect.any(String) });
    const { data } = await admin
      .from("contacts")
      .select("first_name, company, user_id")
      .eq("id", (result as { id: string }).id)
      .single();
    expect(data).toEqual({ first_name: "Johan", company: "Wexnet", user_id: alva.user.id });
  });

  it("says whose an address already is", async () => {
    const result = await addContact(alva.db, alva.user.id, {
      first_name: "Karin",
      last_name: null,
      company: null,
      role: null,
      email: karinEmail,
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("already belongs to") });
  });
});

describe("the tools that offer them", () => {
  const call = (who: Person, name: string, args: Record<string, unknown>) => runTool(who.ctx, name, JSON.stringify(args));
  const blank = { first_name: null, last_name: null, company: null, role: null, one_liner: null, how_known: null, phone: null };

  it("offer only what would change, and save nothing by offering", async () => {
    const outcome = await call(alva, "propose_contact_edit", { ...blank, contact_id: karinId, company: "Saab", first_name: "Karin" });

    expect(outcome).toMatchObject({
      tier: "propose",
      proposal: { kind: "contact_edit", changes: [{ field: "company", before: "Combitech AB", after: "Saab" }] },
    });
    expect((await karin()).company).toBe("Combitech AB");
  });

  it("refuse an edit that changes nothing, or would not pass the form", async () => {
    expect(await call(alva, "propose_contact_edit", { ...blank, contact_id: karinId, company: "Combitech AB" })).toMatchObject({
      refused: expect.stringMatching(/Nothing would change/),
    });
    expect(await call(alva, "propose_contact_edit", { ...blank, contact_id: karinId, phone: "call me maybe" })).toMatchObject({
      refused: expect.stringMatching(/^Phone: /),
    });
  });

  it("have no way to change addresses, notes or tags", () => {
    const tool = toolDefinitions().find((definition) => definition.name === "propose_contact_edit")!;
    const fields = Object.keys((tool.parameters as { properties: object }).properties);
    expect(fields).not.toContain("email");
    expect(fields).not.toContain("emails");
    expect(fields).not.toContain("notes");
    expect(fields).not.toContain("tags");
  });

  it("will not offer a new contact whose address is already somebody's", async () => {
    const outcome = await call(alva, "propose_new_contact", {
      first_name: "Karin",
      last_name: null,
      email: karinEmail,
      company: null,
      role: null,
    });
    expect(outcome).toMatchObject({ refused: expect.stringContaining("already belongs to Karin Lindqvist") });
  });

  it("offer nothing about somebody else's contact", async () => {
    expect(await call(bea, "propose_contact_edit", { ...blank, contact_id: karinId, company: "Mine" })).toMatchObject({
      refused: expect.any(String),
    });
  });
});

describe("the cards", () => {
  it("press through these actions, which check you and the Assistant first", () => {
    const cards = readFileSync("app/assistant/needs-you.tsx", "utf8");
    expect(cards).toContain("saveProposedEdit(");
    expect(cards).toContain("addProposedContact(");
    const actions = readFileSync("app/assistant/actions.ts", "utf8");
    for (const name of ["saveProposedEdit", "addProposedContact"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      expect(body.slice(0, 600), name).toContain("if (!(await hasAssistant(supabase, user.id))) notFound();");
    }
  });
});
