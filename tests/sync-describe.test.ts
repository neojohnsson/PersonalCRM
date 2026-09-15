import { describe, expect, it } from "vitest";
import { describeSync, type SyncSummary } from "@/lib/sync/describe";

const NOW = new Date("2026-09-15T12:00:00Z");

function sync(fields: Partial<SyncSummary>): SyncSummary {
  return {
    status: "synced",
    message_count: 312,
    last_synced_at: "2026-09-15T11:56:00Z",
    last_error: null,
    ...fields,
  };
}

describe("describeSync", () => {
  it("says not synced yet before there's any sync state", () => {
    expect(describeSync(null, 0, NOW)).toEqual({ tone: "idle", text: "Not synced yet" });
  });

  it("reads like the design once synced", () => {
    expect(describeSync(sync({}), 48, NOW)).toEqual({
      tone: "ok",
      text: "Last synced 4 minutes ago · 312 messages · 48 people",
    });
  });

  it("shows progress while backfilling and while checking for new mail", () => {
    expect(describeSync(sync({ status: "backfilling", message_count: 100 }), 12, NOW)).toEqual({
      tone: "busy",
      text: "Syncing · 100 messages so far",
    });
    expect(describeSync(sync({ status: "incremental" }), 48, NOW)).toEqual({
      tone: "busy",
      text: "Checking for new mail · 312 messages",
    });
  });

  it("tells the user to reconnect when the Gmail key is dead", () => {
    expect(describeSync(sync({ status: "needs_reconnect" }), 48, NOW)).toEqual({
      tone: "problem",
      text: "Gmail access expired — reconnect to keep syncing",
    });
  });

  it("shows the error instead of hiding it", () => {
    expect(
      describeSync(sync({ status: "error", last_error: "Gmail /messages failed with HTTP 500" }), 48, NOW),
    ).toEqual({ tone: "problem", text: "Last sync failed: Gmail /messages failed with HTTP 500" });
  });

  it("treats ready as never synced, unless an earlier sync finished", () => {
    expect(describeSync(sync({ status: "ready", last_synced_at: null }), 0, NOW)).toEqual({
      tone: "idle",
      text: "Not synced yet",
    });
    expect(describeSync(sync({ status: "ready" }), 48, NOW).tone).toBe("ok");
  });

  it("uses singular words for one", () => {
    expect(describeSync(sync({ message_count: 1 }), 1, NOW).text).toBe(
      "Last synced 4 minutes ago · 1 message · 1 person",
    );
  });
});
