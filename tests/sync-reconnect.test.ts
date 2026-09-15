import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetSyncAfterReconnect } from "@/lib/sync/reconnect";

/**
 * Reconnecting Gmail un-sticks a sync parked in needs_reconnect — and leaves
 * every other state alone. Runs as a signed-in test user, like the callback.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-password-that-is-long-enough";

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("resetSyncAfterReconnect", () => {
  let user: User;
  let db: SupabaseClient;

  async function setState(fields: Record<string, unknown>) {
    const { error } = await db.from("gmail_sync_state").upsert({ user_id: user.id, ...fields });
    if (error) throw error;
  }

  async function state() {
    const { data, error } = await db.from("gmail_sync_state").select("*").maybeSingle();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `reconnect-${randomUUID()}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;

    db = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await db.auth.signInWithPassword({
      email: user.email!,
      password: PASSWORD,
    });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  beforeEach(async () => {
    await db.from("gmail_sync_state").delete().eq("user_id", user.id);
  });

  it("moves a sync stuck on a dead key back to ready, clearing its page and error", async () => {
    await setState({
      status: "needs_reconnect",
      history_id: "1000",
      page_token: "p2",
      last_error: "Gmail access expired or was revoked",
    });

    await resetSyncAfterReconnect(db, user.id);

    expect(await state()).toMatchObject({
      status: "ready",
      page_token: null,
      last_error: null,
    });
  });

  it("leaves a sync in any other state exactly where it was", async () => {
    await setState({ status: "backfilling", history_id: "1000", page_token: "p2" });

    await resetSyncAfterReconnect(db, user.id);

    expect(await state()).toMatchObject({ status: "backfilling", page_token: "p2" });
  });

  it("does nothing, without failing, when there's no sync state yet", async () => {
    await resetSyncAfterReconnect(db, user.id);

    expect(await state()).toBeNull();
  });
});
