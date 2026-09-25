/**
 * Who runs the service, for the public pages (slice 13, commit 6).
 *
 * Empty until the business exists (docs/release.md, step 1): a privacy policy
 * must name who is responsible and how to reach them, and a made-up name
 * would be worse than a plain gap. The pages show the gap as a gap.
 */
export const OPERATOR: { name: string | null; email: string | null; country: string } = {
  name: null,
  email: null,
  country: "Sweden",
};

/** When the public pages last changed. */
export const LEGAL_UPDATED = "25 September 2026";

/** Until a person who knows Swedish and EU law has read them (docs/slice-13-plan.md §5). */
export const LEGAL_REVIEWED = false;
