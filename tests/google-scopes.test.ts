import { describe, expect, it } from "vitest";
import {
  GMAIL_COMPOSE,
  GMAIL_READONLY,
  REQUESTED_SCOPES,
  canDraft,
  canRead,
  parseGrantedScopes,
} from "@/lib/google/scopes";

/** Which Gmail permissions are asked for, and what the granted ones allow. */

describe("Gmail scopes", () => {
  it("asks for reading and drafts — and nothing that only sends", () => {
    expect(REQUESTED_SCOPES.split(" ")).toEqual([GMAIL_READONLY, GMAIL_COMPOSE]);
    expect(REQUESTED_SCOPES).not.toContain("gmail.send");
    expect(REQUESTED_SCOPES).not.toMatch(/mail\.google\.com/);
  });

  it("reads Google's space-separated reply, once each", () => {
    expect(parseGrantedScopes(`${GMAIL_READONLY}  ${GMAIL_COMPOSE} ${GMAIL_READONLY}`)).toEqual([
      GMAIL_READONLY,
      GMAIL_COMPOSE,
    ]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
  });

  it("allows drafts only when compose was granted, and reading only with readonly", () => {
    expect(canRead([GMAIL_READONLY])).toBe(true);
    expect(canDraft([GMAIL_READONLY])).toBe(false);
    expect(canDraft([GMAIL_READONLY, GMAIL_COMPOSE])).toBe(true);
    // A connection made before scopes were recorded counts as read-only.
    expect(canDraft([])).toBe(false);
  });
});
