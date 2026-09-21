import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENTS_READONLY,
  CALENDAR_WRITE_SCOPES,
  REQUESTED_CALENDAR_SCOPES,
  USERINFO_EMAIL,
  canReadCalendar,
  parseGrantedScopes,
} from "@/lib/google/scopes";

/**
 * docs/slice-8-plan.md, Part 1: "Read-only, for good. No create, no edit, no
 * delete, no write scope requested."
 *
 * The only thing standing between this app and somebody's calendar being
 * edited is that no code asks Google for permission to do it. Same reasoning as
 * tests/no-send.test.ts, and the same method: read every source file and fail
 * if any of it asks.
 */

const SOURCE_DIRS = ["app", "lib"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("the calendar is read-only, for good", () => {
  it("asks for nothing but reading events and which account it is", () => {
    expect(REQUESTED_CALENDAR_SCOPES.split(" ")).toEqual([
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("has no code anywhere that asks for a calendar write scope", () => {
    const files = SOURCE_DIRS.flatMap(sourceFiles);

    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return CALENDAR_WRITE_SCOPES.filter((scope) => {
        // The list itself lives in scopes.ts, as the thing being banned.
        if (file.endsWith(join("lib", "google", "scopes.ts"))) return false;
        // A longer scope contains a shorter one as a prefix: ".../calendar"
        // is inside ".../calendar.events.readonly". Match whole values only.
        return new RegExp(`${scope}(?![\\w.])`).test(source);
      }).map((scope) => `${file}: ${scope}`);
    });

    expect(offenders).toEqual([]);
  });

  it("has no code that writes to the Calendar API", () => {
    // Google's write paths: POST/PUT/PATCH/DELETE on calendars/…/events.
    const writing = [/events\/quickAdd/i, /calendars\/[^"'`]*\/events\/import/i, /\.events\.insert/i];

    const offenders = SOURCE_DIRS.flatMap(sourceFiles).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return writing.filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });

  it("really looks at the files it should", () => {
    const files = SOURCE_DIRS.flatMap(sourceFiles);

    expect(files.some((file) => file.endsWith(join("lib", "google", "scopes.ts")))).toBe(true);
    expect(
      files.some((file) => file.endsWith(join("app", "api", "auth", "google", "calendar", "route.ts"))),
    ).toBe(true);
  });
});

describe("what Google actually granted", () => {
  it("reads events only when that permission came back", () => {
    expect(canReadCalendar([CALENDAR_EVENTS_READONLY])).toBe(true);
    expect(canReadCalendar([CALENDAR_EVENTS_READONLY, USERINFO_EMAIL])).toBe(true);

    // The box was unticked: knowing the address is no use on its own.
    expect(canReadCalendar([USERINFO_EMAIL])).toBe(false);
    expect(canReadCalendar([])).toBe(false);

    // A Gmail grant is not a calendar grant, whatever else it allows.
    expect(canReadCalendar(["https://www.googleapis.com/auth/gmail.readonly"])).toBe(false);
  });

  it("reads Google's space-separated reply the same way for both connections", () => {
    expect(parseGrantedScopes(`${CALENDAR_EVENTS_READONLY} ${USERINFO_EMAIL}`)).toEqual([
      CALENDAR_EVENTS_READONLY,
      USERINFO_EMAIL,
    ]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
  });
});
