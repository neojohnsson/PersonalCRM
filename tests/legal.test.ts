import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPolicyPage from "@/app/privacy-policy/page";
import SubProcessorsPage from "@/app/sub-processors/page";
import TermsPage from "@/app/terms/page";
import { LEGAL_REVIEWED, OPERATOR } from "@/lib/legal/operator";
import { SUB_PROCESSORS } from "@/lib/legal/sub-processors";
import { PLANS, PRICE_SEK } from "@/lib/plans/plans";
import { HOLDING_DESCRIPTIONS } from "@/lib/privacy/holdings";

/**
 * The public pages (slice 13, commit 6). A privacy policy that names the
 * wrong services, or a price page that promises what the app does not do, is
 * worse than none: these check the pages against the code.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

/** Every https host a line of CODE names -- not a comment, which only points at documentation. */
function hostsCalled(): Map<string, string> {
  const hosts = new Map<string, string>();
  for (const file of [...sourceFiles("lib"), ...sourceFiles("app"), ...sourceFiles("scripts")]) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) continue;
      for (const match of code.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.set(match[1], file);
    }
  }
  return hosts;
}

const listed = (host: string) =>
  SUB_PROCESSORS.some((each) => each.hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)));

const html = (page: () => React.ReactElement) =>
  renderToStaticMarkup(page())
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&rsquo;|’/g, "'")
    .replace(/\s+/g, " ");

describe("the sub-processor list", () => {
  it("names every outside service the code calls", () => {
    const missing = [...hostsCalled()].filter(([host]) => !listed(host)).map(([host, file]) => `${host} (${file})`);
    expect(missing).toEqual([]);
  });

  it("names every outside service the app has a library for", () => {
    const deps = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).dependencies);
    if (deps.includes("stripe")) expect(listed("api.stripe.com")).toBe(true);
    if (deps.some((dep) => dep.startsWith("@supabase/"))) expect(listed("x.supabase.co")).toBe(true);
    // OpenAI is called over plain fetch, so the host check above covers it.
    expect(listed("api.openai.com")).toBe(true);
  });

  it("is on the page, every one, with what it gets and where", () => {
    const page = html(SubProcessorsPage);
    for (const each of SUB_PROCESSORS) {
      expect(page).toContain(each.name);
      expect(page).toContain(each.where);
    }
  });
});

describe("the privacy policy", () => {
  const page = html(PrivacyPolicyPage);

  it("describes every table the app stores, in the Your data page's own words", () => {
    for (const holding of HOLDING_DESCRIPTIONS) expect(page).toContain(holding.label);
  });

  it("names every sub-processor", () => {
    for (const each of SUB_PROCESSORS) expect(page).toContain(each.name);
  });

  it("says what is never stored, and that there is no tracking", () => {
    expect(page).toContain("The text of your emails");
    expect(page).toContain("There is no analytics, no advertising and no tracking");
  });

  it("names where to complain", () => {
    expect(page).toContain("IMY, imy.se");
  });
});

describe("the terms", () => {
  const page = html(TermsPage);

  it("charge the prices the app charges, and give the allowance the app gives", () => {
    expect(page).toContain(`${PRICE_SEK.pro} kr a month`);
    expect(page).toContain(`${PRICE_SEK.premium} kr a month`);
    expect(page).toContain(`${PLANS.free.allowance!.summary} summaries`);
  });

  it("promise what the hard rules promise", () => {
    expect(page).toContain("It never sends an email");
    expect(page).toContain("It never invites anybody");
    expect(page).toContain("sold by Link");
  });
});

describe("the pages, until they are ready", () => {
  it("say they are drafts, on every page", () => {
    expect(LEGAL_REVIEWED).toBe(false);
    for (const page of [TermsPage, PrivacyPolicyPage, SubProcessorsPage]) {
      expect(html(page)).toContain("Draft. Nobody who knows Swedish and EU law has reviewed this page yet");
    }
  });

  it("show who runs the service as a plain gap, not a made-up name", () => {
    expect(OPERATOR.name).toBeNull();
    expect(html(TermsPage)).toContain("Not filled in yet");
  });
});
