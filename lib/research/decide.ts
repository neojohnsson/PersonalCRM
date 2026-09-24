import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseError } from "@/lib/supabase/errors";
import type { Identity, ResearchFact } from "./research";

/**
 * Deciding what a search found (slice 12, commit 4; docs/slice-12-plan.md §4).
 *
 *   keep the ticked ones   the waiting set becomes kept, with only the facts
 *                          you ticked. None ticked is the same as discard.
 *   discard all            the waiting set is deleted -- not hidden
 *   remove one kept fact   that fact is taken out; the last one out deletes
 *                          the row
 *
 * Everything runs as you, so RLS (migration 0026) decides which rows exist:
 * somebody else's research is simply not found.
 */

export type ResearchRow = {
  id: string;
  status: "pending" | "kept";
  identity: Identity;
  identityWhy: string;
  facts: ResearchFact[];
  foundAt: string;
};

export class ResearchNotFound extends Error {
  constructor() {
    super("That research isn't there any more.");
    this.name = "ResearchNotFound";
  }
}

const COLUMNS = "id, status, identity, identity_why, facts, found_at";

function toRow(row: Record<string, unknown>): ResearchRow {
  return {
    id: row.id as string,
    status: row.status as ResearchRow["status"],
    identity: row.identity as Identity,
    identityWhy: row.identity_why as string,
    facts: (row.facts as ResearchFact[]) ?? [],
    foundAt: row.found_at as string,
  };
}

/** The waiting set, if any, and every kept one, newest first. */
export async function loadResearch(
  db: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<{ pending: ResearchRow | null; kept: ResearchRow[] }> {
  const { data, error } = await db
    .from("contact_research")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .order("found_at", { ascending: false });
  if (error) throw supabaseError(error, "Couldn't load what was found on the web");
  const rows = data.map(toRow);
  return { pending: rows.find((row) => row.status === "pending") ?? null, kept: rows.filter((row) => row.status === "kept") };
}

async function one(db: SupabaseClient, userId: string, id: string, status: ResearchRow["status"]): Promise<ResearchRow> {
  const { data, error } = await db
    .from("contact_research")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", status)
    .maybeSingle();
  if (error) throw supabaseError(error, "Couldn't load that research");
  if (!data) throw new ResearchNotFound();
  return toRow(data);
}

/** Keep the facts at these positions; none ticked discards the set. */
export async function keepTicked(db: SupabaseClient, userId: string, id: string, ticked: number[]): Promise<void> {
  const set = await one(db, userId, id, "pending");
  const keep = [...new Set(ticked)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < set.facts.length)
    .sort((a, b) => a - b)
    .map((index) => set.facts[index]);
  if (keep.length === 0) return discardPending(db, userId, id);

  const { data, error } = await db
    .from("contact_research")
    .update({ status: "kept", facts: keep, decided_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw supabaseError(error, "Couldn't keep those facts");
  if (data.length === 0) throw new ResearchNotFound();
}

/** Discard a waiting set: deleted, so a fact you said no to is not kept anywhere. */
export async function discardPending(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { data, error } = await db
    .from("contact_research")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw supabaseError(error, "Couldn't discard that research");
  if (data.length === 0) throw new ResearchNotFound();
}

/** Take one kept fact out; the last one out deletes the row. */
export async function removeKeptFact(db: SupabaseClient, userId: string, id: string, index: number): Promise<void> {
  const set = await one(db, userId, id, "kept");
  if (!Number.isInteger(index) || index < 0 || index >= set.facts.length) throw new ResearchNotFound();
  const facts = set.facts.filter((_, at) => at !== index);

  const query =
    facts.length === 0
      ? db.from("contact_research").delete()
      : db.from("contact_research").update({ facts });
  const { error } = await query.eq("user_id", userId).eq("id", id).eq("status", "kept");
  if (error) throw supabaseError(error, "Couldn't remove that fact");
}
