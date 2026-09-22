import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DraftNotFound,
  DraftsNotAllowedHere,
  NewerDraftExists,
  discardDraft,
  gmailDraftsUrl,
  lastSavedDraft,
  pendingDraft,
  restoreDraft,
  saveDraftToGmail,
} from "@/lib/ai/draft-save";
import { GmailApiError } from "@/lib/google/gmail";
import { buildReplyMessage, decodeRawMessage, encodeHeader } from "@/lib/google/message";
import { GMAIL_COMPOSE, GMAIL_READONLY } from "@/lib/google/scopes";

/**
 * Saving an approved draft into Gmail: the message it builds, and that nothing
 * reaches Gmail without the permission or a draft waiting.
 */

describe("the message Gmail is given", () => {
  it("encodes a subject with å ä ö, and leaves plain ASCII alone", () => {
    expect(encodeHeader("Re: Examensarbete")).toBe("Re: Examensarbete");
    // RFC 2047, UTF-8 base64 — decoded back here rather than hardcoded.
    const encoded = encodeHeader("Re: Hälsningar");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(encoded.slice(10, -2), "base64").toString("utf8")).toBe("Re: Hälsningar");
    expect(encodeHeader("Re:\r\nsplit")).toBe("Re: split");
  });

  it("builds a reply with the headers that thread it, and a UTF-8 body", () => {
    const raw = buildReplyMessage({
      to: "karin@fortnox.se",
      subject: "Re: Examensarbete",
      body: "Hej Karin,\n\nTack för svaret!\n\nVänliga hälsningar\nNeo",
      inReplyTo: "<second@fortnox.se>",
      references: "<first@mail.gmail.com> <second@fortnox.se>",
    });

    const { headers, body } = decodeRawMessage(raw);
    expect(headers).toContain("To: karin@fortnox.se");
    expect(headers).toContain("Subject: Re: Examensarbete");
    expect(headers).toContain("In-Reply-To: <second@fortnox.se>");
    expect(headers).toContain("References: <first@mail.gmail.com> <second@fortnox.se>");
    expect(headers).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(body).toBe("Hej Karin,\n\nTack för svaret!\n\nVänliga hälsningar\nNeo");
  });

  it("leaves out In-Reply-To and References when the thread has none", () => {
    const { headers } = decodeRawMessage(
      buildReplyMessage({ to: "a@b.se", subject: "Re:", body: "Hej", inReplyTo: null, references: null }),
    );
    expect(headers).not.toContain("In-Reply-To");
    expect(headers).not.toContain("References");
  });

  it("links to Gmail's drafts in the connected account", () => {
    expect(gmailDraftsUrl("neo@example.se")).toBe("https://mail.google.com/mail/?authuser=neo%40example.se#drafts");
    expect(gmailDraftsUrl(null)).toBe("https://mail.google.com/mail/u/0/#drafts");
  });
});

// ── Against the database, with a fake Gmail ─────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "test-password-that-is-long-enough";
const fakeToken = async () => "ya29.fake";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const b64 = (text: string) => Buffer.from(text).toString("base64url");

/** Fake Gmail: reads messages, and records what a draft request was given. */
function fakeGmail(options: { draftStatus?: number } = {}) {
  const realFetch = globalThis.fetch;
  const drafts: { raw: string; threadId: string }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://gmail.googleapis.com/")) return realFetch(input, init);

      if (url.endsWith("/drafts")) {
        if (options.draftStatus) {
          return Response.json({ error: { message: "nope" } }, { status: options.draftStatus });
        }
        const sent = JSON.parse(String(init?.body)).message as { raw: string; threadId: string };
        drafts.push(sent);
        return Response.json({ id: `r-${drafts.length}`, message: { id: "m-new", threadId: sent.threadId } });
      }

      const id = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
      return Response.json({
        id,
        threadId: "t-save",
        internalDate: "0",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "Re: Examensarbete" },
            { name: "Message-ID", value: "<latest@fortnox.se>" },
            { name: "From", value: "Karin <karin@fortnox.se>" },
          ],
          body: { data: b64("Hör av dig i oktober.") },
        },
      });
    }),
  );
  return drafts;
}

describe("saveDraftToGmail", () => {
  let alice: User;
  let bob: User;
  let db: SupabaseClient;
  let bobDb: SupabaseClient;
  let karinId: string;

  async function signIn(email: string) {
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    for (const label of ["alice", "bob"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `save-${label}-${randomUUID()}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      if (label === "alice") alice = data.user;
      else bob = data.user;
    }
    db = await signIn(alice.email!);
    bobDb = await signIn(bob.email!);

    const { data: contact, error } = await db
      .from("contacts")
      .insert({ user_id: alice.id, first_name: "Karin", source: "gmail" })
      .select("id")
      .single();
    if (error) throw error;
    karinId = contact.id;

    await db
      .from("contact_emails")
      .insert({ user_id: alice.id, contact_id: karinId, email: "karin@fortnox.se", is_primary: true });
    await db.from("gmail_messages").insert({
      user_id: alice.id,
      gmail_message_id: "s-1",
      thread_id: "t-save",
      internal_date: "2026-09-02T09:00:00Z",
      from_email: "karin@fortnox.se",
      to_emails: ["alice@example.se"],
      cc_emails: [],
      has_list_unsubscribe: false,
      direction: "inbound",
      subject: "Re: Examensarbete",
    });
    await db.from("google_accounts").insert({
      user_id: alice.id,
      email: "alice@example.se",
      refresh_token_encrypted: "x",
      scopes: [GMAIL_READONLY, GMAIL_COMPOSE],
    });
  });

  afterAll(async () => {
    if (alice) await admin.auth.admin.deleteUser(alice.id);
    if (bob) await admin.auth.admin.deleteUser(bob.id);
  });

  async function makePending(): Promise<string> {
    await db.from("contact_drafts").delete().eq("user_id", alice.id).eq("status", "pending");
    const { data, error } = await db
      .from("contact_drafts")
      .insert({
        user_id: alice.id,
        contact_id: karinId,
        thread_id: "t-save",
        subject: "Re: Examensarbete",
        body: "Hej Karin, tack!",
        language: "Swedish",
        tone: "friendly",
        model: "gpt-5-mini",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  beforeEach(async () => {
    await db.from("contact_drafts").delete().eq("user_id", alice.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the Gmail draft with your edited text, then keeps only its id", async () => {
    const drafts = fakeGmail();
    const id = await makePending();

    const saved = await saveDraftToGmail(db, alice.id, id, "  Hej Karin,\r\n\r\nJag hör av mig i oktober.  ", {
      accessToken: fakeToken,
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].threadId).toBe("t-save");
    const { headers, body } = decodeRawMessage(drafts[0].raw);
    expect(headers).toContain("To: karin@fortnox.se");
    expect(headers).toContain("In-Reply-To: <latest@fortnox.se>");
    expect(body).toBe("Hej Karin,\n\nJag hör av mig i oktober.");

    expect(saved).toMatchObject({ status: "saved", body: null, gmail_draft_id: "r-1" });
    expect(saved.saved_at).not.toBeNull();
    expect(await pendingDraft(db, alice.id, karinId)).toBeNull();
    expect(await lastSavedDraft(db, alice.id, karinId)).toMatchObject({ gmail_draft_id: "r-1" });
  });

  it("refuses an empty draft, and one that isn't waiting any more", async () => {
    fakeGmail();
    const id = await makePending();

    await expect(saveDraftToGmail(db, alice.id, id, "   ", { accessToken: fakeToken })).rejects.toThrow(/can't be empty/);
    await saveDraftToGmail(db, alice.id, id, "Hej", { accessToken: fakeToken });
    await expect(saveDraftToGmail(db, alice.id, id, "Again", { accessToken: fakeToken })).rejects.toBeInstanceOf(
      DraftNotFound,
    );
  });

  it("keeps the draft waiting when Gmail refuses it", async () => {
    fakeGmail({ draftStatus: 403 });
    const id = await makePending();

    await expect(saveDraftToGmail(db, alice.id, id, "Hej", { accessToken: fakeToken })).rejects.toBeInstanceOf(
      GmailApiError,
    );
    expect(await pendingDraft(db, alice.id, karinId)).toMatchObject({ id, status: "pending" });
  });

  it("sends nothing to Gmail without the draft permission", async () => {
    const drafts = fakeGmail();
    const id = await makePending();
    await db.from("google_accounts").update({ scopes: [GMAIL_READONLY] }).eq("user_id", alice.id);

    await expect(saveDraftToGmail(db, alice.id, id, "Hej", { accessToken: fakeToken })).rejects.toBeInstanceOf(
      DraftsNotAllowedHere,
    );
    expect(drafts).toEqual([]);

    await db
      .from("google_accounts")
      .update({ scopes: [GMAIL_READONLY, GMAIL_COMPOSE] })
      .eq("user_id", alice.id);
  });

  it("lets nobody else save or discard your draft", async () => {
    const drafts = fakeGmail();
    const id = await makePending();

    for (const userId of [bob.id, alice.id]) {
      await expect(saveDraftToGmail(bobDb, userId, id, "attacker", { accessToken: fakeToken })).rejects.toBeInstanceOf(
        DraftNotFound,
      );
      await expect(discardDraft(bobDb, userId, id)).rejects.toBeInstanceOf(DraftNotFound);
    }
    expect(drafts).toEqual([]);
    expect(await pendingDraft(db, alice.id, karinId)).toMatchObject({ id });
  });

  it("discards a pending draft, which was never in Gmail", async () => {
    fakeGmail();
    const id = await makePending();
    await discardDraft(db, alice.id, id);
    expect(await pendingDraft(db, alice.id, karinId)).toBeNull();
  });

  /**
   * Slice 9b, Part 3 (migration 0024): Discard sat next to Save with nothing
   * in between, and a draft costs money and a minute of waiting.
   */
  describe("undoing a discard", () => {
    it("keeps the row, throws the text away, and puts back what the browser had", async () => {
      fakeGmail();
      const id = await makePending();

      await discardDraft(db, alice.id, id);

      // The row is still there, marked discarded, holding no message text.
      const { data: row } = await db
        .from("contact_drafts")
        .select("status, body, discarded_at, model")
        .eq("id", id)
        .single();
      expect(row!.status).toBe("discarded");
      expect(row!.body).toBeNull();
      expect(row!.discarded_at).not.toBeNull();
      // What it cost and which model wrote it are still recorded.
      expect(row!.model).toBeTruthy();

      await restoreDraft(db, alice.id, id, "Hej Karin, det text\u00adrutan hade.");

      const back = await pendingDraft(db, alice.id, karinId);
      expect(back).toMatchObject({ id, body: "Hej Karin, det text\u00adrutan hade." });
      const { data: after } = await db.from("contact_drafts").select("discarded_at").eq("id", id).single();
      expect(after!.discarded_at).toBeNull();
    });

    it("refuses to put back nothing at all", async () => {
      fakeGmail();
      const id = await makePending();
      await discardDraft(db, alice.id, id);

      await expect(restoreDraft(db, alice.id, id, "   ")).rejects.toBeInstanceOf(DraftNotFound);
    });

    it("won't restore twice, and won't restore what was never discarded", async () => {
      fakeGmail();
      const id = await makePending();

      // Never discarded: there is nothing to put back.
      await expect(restoreDraft(db, alice.id, id, "Hej")).rejects.toBeInstanceOf(DraftNotFound);

      await discardDraft(db, alice.id, id);
      await restoreDraft(db, alice.id, id, "Hej");
      await expect(restoreDraft(db, alice.id, id, "Hej again")).rejects.toBeInstanceOf(DraftNotFound);
    });

    it("says so when a newer draft has been written since", async () => {
      // One pending draft per contact (migration 0014), so this cannot happen
      // -- and the toast has to say why rather than swallow it.
      fakeGmail();
      const first = await makePending();
      await discardDraft(db, alice.id, first);
      const second = await makePending();

      await expect(restoreDraft(db, alice.id, first, "the old one")).rejects.toBeInstanceOf(NewerDraftExists);
      expect(await pendingDraft(db, alice.id, karinId)).toMatchObject({ id: second });
    });

    it("lets nobody else put your discarded draft back", async () => {
      fakeGmail();
      const id = await makePending();
      await discardDraft(db, alice.id, id);

      for (const userId of [bob.id, alice.id]) {
        await expect(restoreDraft(bobDb, userId, id, "attacker")).rejects.toBeInstanceOf(DraftNotFound);
      }
      expect(await pendingDraft(db, alice.id, karinId)).toBeNull();
    });
  });
});
