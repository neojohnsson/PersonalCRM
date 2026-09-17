import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY_PROFILE, parseProfileForm, type Profile } from "@/lib/profile/profile";
import { loadProfile, saveProfile } from "@/lib/profile/store";

/** The Profile form's rules, and saving and loading it as two users. */

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  return data;
}

/** The errors of a parse that failed, or {} if it didn't. */
const errorsOf = (parsed: ReturnType<typeof parseProfileForm>) => ("errors" in parsed ? parsed.errors : {});

describe("parseProfileForm", () => {
  it("reads every field: text trimmed, choices, lists and links", () => {
    const parsed = parseProfileForm(
      form({
        display_name: "  Neo Johnsson ",
        based_in: "Växjö",
        what_you_do: "Systems science student",
        looking_for: "",
        signature: "Neo\r\nLinnéuniversitetet",
        languages: ["Swedish", "English", "swedish", ""],
        tone: "professional",
        length: "short",
        address_by: "full_name",
        sign_off: "Vänliga hälsningar",
        never_write: ["Just circling back", ""],
        link_label: ["GitHub", "LinkedIn", ""],
        link_url: ["github.com/neojohnsson", "https://www.linkedin.com/in/neo", ""],
        link_in_signature: ["true", "false", "false"],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      profile: {
        display_name: "Neo Johnsson",
        based_in: "Växjö",
        what_you_do: "Systems science student",
        looking_for: null,
        signature: "Neo\nLinnéuniversitetet",
        languages: ["Swedish", "English"],
        tone: "professional",
        length: "short",
        address_by: "full_name",
        sign_off: "Vänliga hälsningar",
        never_write: ["Just circling back"],
        links: [
          { label: "GitHub", url: "github.com/neojohnsson", in_signature: true },
          { label: "LinkedIn", url: "https://www.linkedin.com/in/neo", in_signature: false },
        ],
      },
    });
  });

  it("falls back to the defaults for choices it doesn't know", () => {
    const parsed = parseProfileForm(form({ tone: "rude", length: "", address_by: "nickname" }));
    expect(parsed).toEqual({ ok: true, profile: EMPTY_PROFILE });
  });

  it("refuses overlong text, too many list items and links that aren't addresses, keeping what was typed", () => {
    const parsed = parseProfileForm(
      form({
        what_you_do: "x".repeat(501),
        languages: Array.from({ length: 11 }, (_, i) => `Language ${i}`),
        never_write: ["y".repeat(101)],
        link_label: ["GitHub"],
        link_url: ["not an address"],
        link_in_signature: ["false"],
      }),
    );
    expect(parsed.ok).toBe(false);
    expect(errorsOf(parsed)).toEqual({
      what_you_do: "Keep it under 500 characters.",
      languages: "At most 10 languages.",
      never_write: "Keep each phrase under 100 characters.",
      links: "GitHub's address doesn't look like one — for example github.com/you.",
    });
    expect(parsed.profile.what_you_do).toHaveLength(501);
  });

  it("asks for a name and an address for each link", () => {
    expect(errorsOf(parseProfileForm(form({ link_label: [""], link_url: ["github.com/x"], link_in_signature: ["false"] })))).toEqual({
      links: "Give each link a name, like GitHub.",
    });
    expect(errorsOf(parseProfileForm(form({ link_label: ["GitHub"], link_url: [""], link_in_signature: ["false"] })))).toEqual({
      links: "Add the address for GitHub.",
    });
    expect(
      parseProfileForm(form({ link_label: ["Bad"], link_url: ["javascript:alert(1)"], link_in_signature: ["false"] })).ok,
    ).toBe(false);
  });
});

// ── Against the database ────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signedInUser(label: string): Promise<{ user: User; db: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `profile-${label}-${randomUUID()}@example.com`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email: data.user.email!, password: PASSWORD });
  if (signInError) throw signInError;
  return { user: data.user, db };
}

describe("loadProfile and saveProfile", () => {
  let alice: User;
  let bob: User;
  let aliceDb: SupabaseClient;
  let bobDb: SupabaseClient;

  beforeAll(async () => {
    ({ user: alice, db: aliceDb } = await signedInUser("alice"));
    ({ user: bob, db: bobDb } = await signedInUser("bob"));
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  const alicesProfile: Profile = {
    ...EMPTY_PROFILE,
    display_name: "Alice",
    languages: ["Swedish"],
    tone: "brief",
    never_write: ["Just circling back"],
    links: [{ label: "GitHub", url: "github.com/alice", in_signature: true }],
  };

  it("gives the defaults before anything is saved", async () => {
    expect(await loadProfile(aliceDb, alice.id)).toEqual({ ...EMPTY_PROFILE, updated_at: null });
  });

  it("saves the whole profile, then saves over it", async () => {
    const first = await saveProfile(aliceDb, alice.id, alicesProfile);
    expect(first).toMatchObject(alicesProfile);
    expect(first.updated_at).not.toBeNull();

    await saveProfile(aliceDb, alice.id, { ...alicesProfile, tone: "casual", links: [] });
    expect(await loadProfile(aliceDb, alice.id)).toMatchObject({ tone: "casual", links: [], display_name: "Alice" });
  });

  it("never shows or changes one user's profile for another", async () => {
    expect(await loadProfile(bobDb, alice.id)).toEqual({ ...EMPTY_PROFILE, updated_at: null });
    await expect(saveProfile(bobDb, alice.id, { ...EMPTY_PROFILE, display_name: "attacker" })).rejects.toThrow();
    expect((await loadProfile(aliceDb, alice.id)).display_name).toBe("Alice");
  });
});
