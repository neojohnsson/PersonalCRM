import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contactsCsv, csvCell, exportEverything, exportPerson } from "@/lib/privacy/export";
import { HOLDING_TABLES } from "@/lib/privacy/holdings";

/**
 * Handing the data back (docs/slice-7-plan.md, Part 2).
 *
 * Two users, because an export that quietly included somebody else's rows
 * would be the worst possible bug in the feature whose whole point is being
 * trustworthy about data.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createUser(label: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `export-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function signInAs(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

describe("exporting", () => {
  let alice: User;
  let bob: User;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let karinId: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    aliceClient = await signInAs(alice.email!);
    bobClient = await signInAs(bob.email!);

    const { data: karin, error } = await aliceClient
      .from("contacts")
      .insert({
        user_id: alice.id,
        first_name: "Karin",
        last_name: "Lindqvist, PhD",
        company: 'Fortnox "the one in Växjö"',
        role: "Utvecklingschef",
        tags: ["thesis", "växjö"],
        source: "gmail",
      })
      .select("id")
      .single();
    if (error) throw error;
    karinId = karin.id;

    const { error: emailError } = await aliceClient.from("contact_emails").insert([
      { user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true },
      { user_id: alice.id, contact_id: karinId, email: "karin.l@gmail.com", is_primary: false },
    ]);
    if (emailError) throw emailError;

    const base = { user_id: alice.id, cc_emails: [], has_list_unsubscribe: false, thread_id: "t1" };
    const { error: messageError } = await aliceClient.from("gmail_messages").insert([
      {
        ...base,
        gmail_message_id: "msg-hers",
        internal_date: "2026-09-02T09:00:00Z",
        from_email: "karin@fortnox.se",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Examensarbete",
      },
      {
        ...base,
        gmail_message_id: "msg-someone-else",
        internal_date: "2026-09-03T09:00:00Z",
        from_email: "nobody@example.com",
        to_emails: ["alice@example.se"],
        direction: "inbound",
        subject: "Not about Karin",
      },
    ]);
    if (messageError) throw messageError;

    const { error: summaryError } = await aliceClient.from("contact_summaries").insert({
      user_id: alice.id,
      contact_id: karinId,
      who_they_are: "Runs the platform team.",
      discussed: "The thesis timeline.",
      sources: { discussed: [{ messageId: "msg-hers", threadId: "t1" }] },
      as_of: "2026-09-12T10:00:00Z",
      model: "test-model",
    });
    if (summaryError) throw summaryError;

    // Bob's contact, which must never appear in Alice's file.
    const { error: bobError } = await bobClient
      .from("contacts")
      .insert({ user_id: bob.id, first_name: "Bobs", last_name: "Person", source: "manual" });
    if (bobError) throw bobError;
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  it("has a section for every table the privacy page counts", async () => {
    const everything = await exportEverything(aliceClient, alice.id, alice.email!);

    // The page and the file read the same list, so one can't promise what the
    // other leaves out.
    expect(Object.keys(everything.tables).sort()).toEqual([...HOLDING_TABLES].sort());
  });

  it("contains the person's own rows, and nobody else's", async () => {
    const everything = await exportEverything(aliceClient, alice.id, alice.email!);

    expect(everything.account).toEqual({ id: alice.id, email: alice.email });
    expect(everything.tables.contacts).toHaveLength(1);
    expect(everything.tables.contacts[0]).toMatchObject({ first_name: "Karin" });
    expect(everything.tables.gmail_messages).toHaveLength(2);

    const asText = JSON.stringify(everything);
    expect(asText).not.toContain("Bobs");
    expect(asText).not.toContain(bob.id);
  });

  it("leaves the Gmail refresh token out, even encrypted", async () => {
    const { error } = await aliceClient.from("google_accounts").insert({
      user_id: alice.id,
      email: "alice@example.se",
      refresh_token_encrypted: "pretend-this-is-encrypted",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    if (error) throw error;

    const everything = await exportEverything(aliceClient, alice.id, alice.email!);
    const account = everything.tables.google_accounts[0];

    expect(account.email).toBe("alice@example.se");
    expect(account).not.toHaveProperty("refresh_token_encrypted");
    expect(JSON.stringify(everything)).not.toContain("pretend-this-is-encrypted");
  });

  it("writes a spreadsheet that survives commas and quotes in a company name", async () => {
    const csv = await contactsCsv(aliceClient, alice.id);
    const [header, ...rows] = csv.split("\r\n");

    expect(header).toBe("first_name,last_name,company,role,emails,tags,messages,last_contact,added");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('"Lindqvist, PhD"');
    expect(rows[0]).toContain('"Fortnox ""the one in Växjö"""');
    expect(rows[0]).toContain("karin@fortnox.se karin.l@gmail.com");
  });

  it("gives one person everything about them, and only them", async () => {
    const person = await exportPerson(aliceClient, alice.id, karinId);

    expect(person.contact).toMatchObject({ first_name: "Karin", company: 'Fortnox "the one in Växjö"' });
    expect(person.email_addresses).toHaveLength(2);
    expect(person.ai_summaries).toHaveLength(1);
    expect(person.ai_summaries[0]).toMatchObject({ who_they_are: "Runs the platform team." });

    // Found by address, the same way the app decides whose mail is whose.
    expect(person.messages).toHaveLength(1);
    expect(person.messages[0]).toMatchObject({ gmail_message_id: "msg-hers" });
    expect(JSON.stringify(person)).not.toContain("msg-someone-else");
  });

  it("finds nothing for a contact that isn't yours", async () => {
    const person = await exportPerson(bobClient, bob.id, karinId);

    expect(person.contact).toBeNull();
    expect(person.email_addresses).toEqual([]);
    expect(person.ai_summaries).toEqual([]);
  });
});

describe("csvCell", () => {
  it("quotes only what has to be quoted", () => {
    expect(csvCell("Fortnox")).toBe("Fortnox");
    expect(csvCell("Lindqvist, PhD")).toBe('"Lindqvist, PhD"');
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("")).toBe("");
  });
});
