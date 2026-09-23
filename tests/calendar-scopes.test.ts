import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENTS,
  CALENDAR_EVENTS_READONLY,
  CALENDAR_FORBIDDEN_SCOPES,
  REQUESTED_CALENDAR_SCOPES,
  USERINFO_EMAIL,
  canReadCalendar,
  canWriteCalendar,
  parseGrantedScopes,
} from "@/lib/google/scopes";

/**
 * Slice 8a asked for nothing but reading, and this file failed if any source
 * mentioned any calendar write scope at all.
 *
 * Slice 10 reversed that on the user's request (docs/slice-10-plan.md): the app
 * creates events now. **So the guard narrows rather than disappearing** — a
 * test deleted the day it becomes inconvenient was never a guard.
 *
 * What it still holds the line on, and why each one matters:
 *
 *   - exactly three scopes asked for, pinned, so a fourth cannot be slipped in
 *   - the other five calendar write scopes appear nowhere: whole calendars,
 *     their sharing, and a narrower one that nothing uses
 *   - no guest, ever, on any event — Google emails an invitation to each one,
 *     and that is the app causing mail to reach a person
 *   - no update, no delete, no quickAdd, no import: the granted scope allows
 *     all of them and the code has none
 *
 * Same method as tests/no-send.test.ts: read every source file, because the
 * only thing standing between this app and somebody's calendar is what the
 * code does not contain.
 */

const SOURCE_DIRS = ["app", "lib"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

/** Where the lists themselves live: they hold the words as the thing described. */
const DECLARATIONS = [join("lib", "google", "scopes.ts")];

function offendersFor(patterns: { name: string; pattern: RegExp }[], skip = DECLARATIONS): string[] {
  return SOURCE_DIRS.flatMap(sourceFiles).flatMap((file) => {
    if (skip.some((allowed) => file.endsWith(allowed))) return [];
    const source = readFileSync(file, "utf8");
    return patterns.filter(({ pattern }) => pattern.test(source)).map(({ name }) => `${file}: ${name}`);
  });
}

describe("what the calendar consent asks for", () => {
  it("is exactly reading events, editing events, and which account it is", () => {
    expect(REQUESTED_CALENDAR_SCOPES.split(" ")).toEqual([
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("asks for no other calendar permission anywhere in the app", () => {
    // Whole calendars, who may see them, and one narrower scope nothing uses:
    // asking for a permission no code needs is its own kind of lie.
    const offenders = offendersFor(
      CALENDAR_FORBIDDEN_SCOPES.map((scope) => ({
        name: scope,
        // A longer scope contains a shorter one as a prefix: ".../calendar" is
        // inside ".../calendar.events". Match whole values only.
        pattern: new RegExp(`${scope}(?![\\w.])`),
      })),
    );

    expect(offenders).toEqual([]);
  });
});

describe("an event this app creates", () => {
  it("is written by one file and one file only", () => {
    // The guest rule below is about ONE file's contents, so it is worth
    // nothing unless that file is the only one that can write an event.
    // Reading is a different matter: lib/google/calendar.ts asks Google for
    // guest lists on purpose, because that is how a meeting is matched to a
    // contact.
    const writers = SOURCE_DIRS.flatMap(sourceFiles).filter((file) => {
      const source = readFileSync(file, "utf8");
      return /method:\s*["'`]POST["'`]/.test(source) && /calendar\/v3/.test(source);
    });

    expect(writers).toEqual([join("lib", "google", "calendar-create.ts")]);
  });

  it("can never carry a guest, and never asks Google to notify anybody", () => {
    // The rule this protects is the send rule: a guest list makes Google email
    // an invitation, so the one file that writes may not mention one -- and
    // its NewEvent type has no field to put one in either.
    const source = readFileSync(join("lib", "google", "calendar-create.ts"), "utf8");
    const body = source.slice(source.indexOf("export async function createEvent"));

    expect(body).not.toMatch(/attendees/i);
    expect(body).not.toMatch(/guestsCan/i);
    expect(body).toContain("sendUpdates=none");
    expect(body).not.toMatch(/sendUpdates=(all|externalOnly)/i);

    // Nowhere in the app asks Google to notify anybody about anything.
    expect(offendersFor([
      { name: "sendUpdates other than none", pattern: /sendUpdates[\s:="'`]*(all|externalOnly)/i },
    ])).toEqual([]);
  });

  it("is the only thing written: no update, no delete, no quickAdd, no import", () => {
    const offenders = offendersFor([
      { name: "events/quickAdd", pattern: /events\/quickAdd/i },
      { name: "events/import", pattern: /events\/import/i },
      { name: "events.update", pattern: /events\.(update|patch|delete)/i },
      // A PATCH, PUT or DELETE aimed at the Calendar API.
      { name: "PATCH/PUT/DELETE on an event", pattern: /method:\s*["'`](PATCH|PUT|DELETE)["'`][\s\S]{0,400}?calendars\//i },
      { name: "an event id in a write path", pattern: /calendars\/[^"'`\n]*\/events\/\$\{/i },
    ]);

    expect(offenders).toEqual([]);
  });

  it("really looks at the files it should", () => {
    const files = SOURCE_DIRS.flatMap(sourceFiles);

    expect(files.some((file) => file.endsWith(join("lib", "google", "scopes.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(join("lib", "google", "calendar.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(join("lib", "google", "calendar-create.ts")))).toBe(true);
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

  it("creates an event only when the write permission came back", () => {
    expect(canWriteCalendar([CALENDAR_EVENTS_READONLY, CALENDAR_EVENTS])).toBe(true);

    // Every calendar connected before slice 10, and anybody who unticked the
    // box: reading still works, and the Create buttons are simply not there.
    expect(canWriteCalendar([CALENDAR_EVENTS_READONLY])).toBe(false);
    expect(canWriteCalendar([])).toBe(false);

    // Reading is not writing, and writing does not imply reading.
    expect(canReadCalendar([CALENDAR_EVENTS])).toBe(false);
  });

  it("reads Google's space-separated reply the same way for both connections", () => {
    expect(parseGrantedScopes(`${CALENDAR_EVENTS_READONLY} ${CALENDAR_EVENTS} ${USERINFO_EMAIL}`)).toEqual([
      CALENDAR_EVENTS_READONLY,
      CALENDAR_EVENTS,
      USERINFO_EMAIL,
    ]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
  });
});

/**
 * Slice 10, decision 5: every screen and document that promised read-only is
 * corrected in the same slice as the change. Slice 8b spent a day with a
 * privacy page and a piece of code that disagreed, and this is that lesson
 * written as a test.
 */
describe("what the app says about the calendar", () => {
  const SENTENCES_THAT_ARE_NO_LONGER_TRUE = [
    "cannot create, change or delete anything in your calendar",
    "no event is ever created or changed",
    "Nothing in the calendar is ever created, changed or deleted",
    "view events and nothing else",
    "asks for permission to view events",
    "there never will be",
    // Missed by the first version of this list and found by hand on
    // 2026-09-23, on the Calendar page's own Connect card.
    "Nothing in your calendar is ever created or changed",
    "never asks Google for permission to",
  ];

  it("no longer says it cannot create an event", () => {
    const pages = SOURCE_DIRS.flatMap(sourceFiles).concat([
      join("docs", "privacy.md"),
      join("docs", "plan.md"),
    ]);

    const offenders = pages.flatMap((file) => {
      const raw = readFileSync(file, "utf8");
      // A code comment quoting the sentence it replaced is how this project
      // keeps its history -- it is the screen's own words that must not say
      // it. Markdown has no comments, so only source is stripped.
      const source = file.endsWith(".md")
        ? raw
        : raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      return SENTENCES_THAT_ARE_NO_LONGER_TRUE.filter((sentence) => source.includes(sentence)).map(
        (sentence) => `${file}: "${sentence}"`,
      );
    });

    expect(offenders).toEqual([]);
  });

  it("says on the consent screen what creating an event does and does not do", () => {
    const connect = readFileSync(join("app", "connect", "page.tsx"), "utf8");

    // The screen where you grant a permission is the last place that may
    // describe an old one.
    expect(connect).toContain("never with guests");
    expect(connect).toMatch(/editing and deleting/i);
  });

  it("says the same thing in the privacy document", () => {
    const privacy = readFileSync(join("docs", "privacy.md"), "utf8");

    expect(privacy).toContain("No guests, ever.");
    expect(privacy).toContain("Nothing is created without a press.");
    // And names the scope's real cost rather than only its use.
    expect(privacy).toContain("calendar.app.created");
  });
});
