import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md: "No send capability. Drafts are written to Gmail and a human
 * presses send. No send endpoint, no send button, no scheduled send. Ever."
 *
 * The draft permission (gmail.compose) technically allows sending, so the only
 * thing standing between the app and a sent email is that no code asks Gmail
 * to send. This reads every source file and fails if any of it does.
 */

const SOURCE_DIRS = ["app", "lib"];

/** Gmail's two sending endpoints, and the send-only scope. */
const SEND_PATTERNS = [/messages\/send/i, /drafts\/send/i, /auth\/gmail\.send/i];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("no send capability", () => {
  it("has no code that calls Gmail's send endpoints or asks for the send scope", () => {
    const offenders = SOURCE_DIRS.flatMap(sourceFiles).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return SEND_PATTERNS.filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it("really looks at the files it should", () => {
    const files = SOURCE_DIRS.flatMap(sourceFiles);
    expect(files.some((file) => file.endsWith(join("lib", "google", "gmail.ts")))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });
});
