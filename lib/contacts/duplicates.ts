import { normaliseName } from "@/lib/relationship/referral";

/**
 * Contacts that are probably the same person (plan.md §3.7;
 * docs/slice-6a-plan.md, Part 1).
 *
 * Plain rules over what's already stored — no AI, nothing sent anywhere. Each
 * pair carries the rule that matched, in words, because you are the one who
 * decides: "suggest a merge, show both records side by side, you press merge.
 * Never auto-merge."
 *
 * What is deliberately NOT a signal: a shared first name, a shared company, or
 * two addresses that merely look alike. A wrong merge can't be undone.
 */

export type DuplicateContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  emails: string[];
};

/** Which rule matched, and how sure it is. */
export type DuplicateReason = "same_thread" | "same_name" | "same_phone" | "name_in_addresses";

export type DuplicatePair = {
  /** The two contact ids, the one with more mail first — a suggestion for which to keep. */
  a: string;
  b: string;
  reason: DuplicateReason;
  /** The words the page shows. */
  because: string;
};

/** A message as this needs it: which thread, and every address on it. */
export type ThreadAddresses = { threadId: string; addresses: string[] };

const REASON_WORDS: Record<DuplicateReason, string> = {
  same_thread: "Their addresses are built from the same name, and both wrote in the same email thread.",
  same_name: "Both have the same name.",
  same_phone: "Both have the same phone number.",
  name_in_addresses: "Both addresses are built from the same name.",
};

/** Most convincing first: two people in one conversation beats two people with one name. */
const REASON_ORDER: DuplicateReason[] = ["same_thread", "same_name", "same_phone", "name_in_addresses"];

/** Digits only, last 9 — so +46 70 123 45 67 and 070-123 45 67 are the same number. */
export function phoneKey(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/** The full name, ignoring case, accents and punctuation; null when there isn't one. */
export function nameKey(contact: DuplicateContact): string | null {
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  const key = normaliseName(full);
  // One word is a first name, and first names are not evidence.
  return key && full.trim().split(/\s+/).length >= 2 ? key : null;
}

/**
 * The name an address is built from: "carl-johan.hultenheim@atea.se" →
 * "carljohanhultenheim". Only when it has two parts, so "info@" or "oskar@"
 * never match anyone.
 */
export function addressNameKey(email: string): string | null {
  const local = email.slice(0, email.lastIndexOf("@"));
  const parts = local.split(/[._-]+/).filter(Boolean);
  return parts.length >= 2 ? normaliseName(parts.join("")) : null;
}

/**
 * Pairs worth asking about. `dismissed` holds pairs already answered "not the
 * same person", as "idA:idB" with the ids sorted.
 */
export function findDuplicates(
  contacts: DuplicateContact[],
  threads: ThreadAddresses[],
  dismissed: Set<string> = new Set(),
): DuplicatePair[] {
  const byAddress = new Map<string, string>();
  for (const contact of contacts) {
    for (const email of contact.emails) byAddress.set(email.toLowerCase(), contact.id);
  }

  const found = new Map<string, DuplicateReason>();
  const note = (a: string, b: string, reason: DuplicateReason) => {
    if (a === b) return;
    const key = pairKey(a, b);
    if (dismissed.has(key)) return;
    const already = found.get(key);
    // Keep the most convincing reason for a pair.
    if (!already || REASON_ORDER.indexOf(reason) < REASON_ORDER.indexOf(already)) found.set(key, reason);
  };

  group(contacts, nameKey).forEach((ids) => pairs(ids, (a, b) => note(a, b, "same_name")));
  group(contacts, (contact) => phoneKey(contact.phone)).forEach((ids) =>
    pairs(ids, (a, b) => note(a, b, "same_phone")),
  );

  // The same name inside the addresses themselves — how an unnamed half of a
  // split contact is found.
  const byAddressName = new Map<string, Set<string>>();
  for (const contact of contacts) {
    for (const email of contact.emails) {
      const key = addressNameKey(email);
      if (!key) continue;
      byAddressName.set(key, (byAddressName.get(key) ?? new Set()).add(contact.id));
    }
  }
  byAddressName.forEach((ids) => pairs([...ids], (a, b) => note(a, b, "name_in_addresses")));

  // Sharing a thread is not evidence on its own — Pontus is in Carl-Johan's
  // thread and is a different person. It only strengthens a pair that another
  // rule already found, which is what the real case looks like: you wrote to
  // one address and the answer came from another, both built from one name.
  const sharedThread = new Set<string>();
  for (const thread of threads) {
    const inThread = [...new Set(thread.addresses.map((address) => byAddress.get(address.toLowerCase())))].filter(
      (id): id is string => id !== undefined,
    );
    pairs(inThread, (a, b) => sharedThread.add(pairKey(a, b)));
  }
  for (const key of found.keys()) if (sharedThread.has(key)) found.set(key, "same_thread");

  const messageCount = new Map(contacts.map((contact) => [contact.id, contact.emails.length]));
  return [...found.entries()]
    .map(([key, reason]) => {
      const [first, second] = key.split(":");
      // More addresses first: a hint at which one to keep, never a decision.
      const [a, b] = (messageCount.get(first) ?? 0) >= (messageCount.get(second) ?? 0) ? [first, second] : [second, first];
      return { a, b, reason, because: REASON_WORDS[reason] };
    })
    .sort((one, other) => REASON_ORDER.indexOf(one.reason) - REASON_ORDER.indexOf(other.reason));
}

/** "idA:idB", ids sorted, so a pair has one name whichever way round it's seen. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function group<T>(items: T[], keyOf: (item: T) => string | null): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), (item as { id: string }).id]);
  }
  return new Map([...groups].filter(([, ids]) => ids.length > 1));
}

function pairs(ids: string[], each: (a: string, b: string) => void): void {
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) each(ids[i], ids[j]);
}
