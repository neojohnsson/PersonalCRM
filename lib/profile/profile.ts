/**
 * Your Profile: what the drafting AI may know about you, and how drafts sound
 * (design/Profile.dc.html; docs/slice-5a-plan.md, Part 2).
 *
 * Plain values and a pure form parser, so the browser form and the server
 * share one set of rules. Loading and saving: lib/profile/store.ts.
 */

export const TONES = ["professional", "friendly", "casual", "brief"] as const;
export const LENGTHS = ["short", "medium", "long"] as const;
export const ADDRESS_BY = ["first_name", "full_name"] as const;

export type Tone = (typeof TONES)[number];
export type Length = (typeof LENGTHS)[number];
export type AddressBy = (typeof ADDRESS_BY)[number];

export type ProfileLink = { label: string; url: string; in_signature: boolean };

export type Profile = {
  display_name: string | null;
  based_in: string | null;
  what_you_do: string | null;
  looking_for: string | null;
  signature: string | null;
  languages: string[];
  tone: Tone;
  length: Length;
  address_by: AddressBy;
  sign_off: string | null;
  never_write: string[];
  links: ProfileLink[];
};

/** A profile nobody has filled in — the database's defaults (migration 0014). */
export const EMPTY_PROFILE: Profile = {
  display_name: null,
  based_in: null,
  what_you_do: null,
  looking_for: null,
  signature: null,
  languages: [],
  tone: "friendly",
  length: "medium",
  address_by: "first_name",
  sign_off: null,
  never_write: [],
  links: [],
};

/** The same limits as the database, plus each list item's own. */
export const PROFILE_LIMITS = {
  display_name: 100,
  based_in: 100,
  what_you_do: 500,
  looking_for: 500,
  signature: 500,
  sign_off: 100,
  language: 40,
  languages: 10,
  never_write_item: 100,
  never_write: 20,
  link_label: 40,
  link_url: 300,
  links: 10,
} as const;

export const TEXT_FIELDS = ["display_name", "based_in", "what_you_do", "looking_for", "signature", "sign_off"] as const;
export type ProfileTextField = (typeof TEXT_FIELDS)[number];

export type ProfileErrors = Partial<Record<ProfileTextField | "languages" | "never_write" | "links", string>>;

export type ParsedProfile = { ok: true; profile: Profile } | { ok: false; errors: ProfileErrors; profile: Profile };

/**
 * Reads the Profile form. Text fields are trimmed and empty means "not set".
 * Lists come as repeated fields: `languages`, `never_write`, and for links
 * `link_label`, `link_url`, `link_in_signature` in the same order.
 *
 * On errors, `profile` is still returned — what was typed, so the form keeps it.
 */
export function parseProfileForm(formData: FormData): ParsedProfile {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  };
  const list = (name: string) =>
    formData.getAll(name).map((value) => (typeof value === "string" ? value.trim() : ""));

  const errors: ProfileErrors = {};
  const profile = { ...EMPTY_PROFILE };

  for (const field of TEXT_FIELDS) {
    const value = text(field);
    profile[field] = value || null;
    if (value.length > PROFILE_LIMITS[field]) {
      errors[field] = `Keep it under ${PROFILE_LIMITS[field]} characters.`;
    }
  }

  const pick = <T extends string>(value: string, options: readonly T[], fallback: T): T =>
    (options as readonly string[]).includes(value) ? (value as T) : fallback;
  profile.tone = pick(text("tone"), TONES, EMPTY_PROFILE.tone);
  profile.length = pick(text("length"), LENGTHS, EMPTY_PROFILE.length);
  profile.address_by = pick(text("address_by"), ADDRESS_BY, EMPTY_PROFILE.address_by);

  profile.languages = unique(list("languages").filter(Boolean));
  if (profile.languages.length > PROFILE_LIMITS.languages) {
    errors.languages = `At most ${PROFILE_LIMITS.languages} languages.`;
  } else if (profile.languages.some((language) => language.length > PROFILE_LIMITS.language)) {
    errors.languages = `Keep each language under ${PROFILE_LIMITS.language} characters.`;
  }

  profile.never_write = unique(list("never_write").filter(Boolean));
  if (profile.never_write.length > PROFILE_LIMITS.never_write) {
    errors.never_write = `At most ${PROFILE_LIMITS.never_write} phrases.`;
  } else if (profile.never_write.some((phrase) => phrase.length > PROFILE_LIMITS.never_write_item)) {
    errors.never_write = `Keep each phrase under ${PROFILE_LIMITS.never_write_item} characters.`;
  }

  const labels = list("link_label");
  const urls = list("link_url");
  const inSignature = list("link_in_signature");
  profile.links = labels
    .map((label, index) => ({ label, url: urls[index] ?? "", in_signature: inSignature[index] === "true" }))
    .filter((link) => link.label || link.url);

  if (profile.links.length > PROFILE_LIMITS.links) {
    errors.links = `At most ${PROFILE_LIMITS.links} links.`;
  } else {
    const problem = profile.links.map(linkProblem).find(Boolean);
    if (problem) errors.links = problem;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors, profile } : { ok: true, profile };
}

/** Why a link can't be saved, or null. It's text the AI reads — never opened — but it should look like an address. */
function linkProblem(link: ProfileLink): string | null {
  if (!link.label) return "Give each link a name, like GitHub.";
  if (!link.url) return `Add the address for ${link.label}.`;
  if (link.label.length > PROFILE_LIMITS.link_label) return `Keep link names under ${PROFILE_LIMITS.link_label} characters.`;
  if (link.url.length > PROFILE_LIMITS.link_url) return `Keep addresses under ${PROFILE_LIMITS.link_url} characters.`;
  if (/\s/.test(link.url) || !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(link.url)) {
    return `${link.label}'s address doesn't look like one — for example github.com/you.`;
  }
  return null;
}

/** Each once, ignoring case, keeping the first spelling. */
function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
