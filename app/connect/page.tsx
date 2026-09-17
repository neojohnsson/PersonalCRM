import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import {
  BrandTile,
  Callout,
  Divider,
  Icon,
  Item,
  Section,
} from "@/app/intro-screen";

export const metadata = { title: `Connect Gmail · ${APP_NAME}` };

/**
 * The error codes app/api/auth/google/callback/route.ts redirects here with.
 *
 * Fixed messages only, never the raw `?error=` text — same reason as the
 * login page: anyone can craft a link to /connect?error=anything.
 */
const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch:
    "That connection attempt couldn't be verified, so it was stopped. If you started it, try again from the button below.",
  denied:
    "Gmail wasn't connected — the permission was cancelled on Google's screen. You can try again whenever you like.",
  token_exchange:
    "Google approved the connection, but finishing it failed. Try again from the button below.",
  scope_missing:
    "Gmail wasn't connected — read access to Gmail wasn't granted on Google's screen. It's needed to find the people you talk to. Try again and leave the Gmail box ticked.",
  no_refresh_token:
    "Google didn't hand over the long-term access this app needs to sync while you're away. Try again from the button below.",
  save_failed:
    "Google approved the connection, but saving it failed. Nothing was stored. Try again from the button below.",
};

const FALLBACK_ERROR = "Something went wrong connecting Gmail. Try again.";

/**
 * The screen that runs before Google's consent screen.
 *
 * Layout and most wording are design/Connect.dc.html's. Differences, on
 * purpose — a privacy screen that describes what the app doesn't do would
 * mislead:
 *   - The permission is still read-only: drafts, and the design's line about
 *     the draft permission, arrive with slice 5.
 *   - No "opt in, one contact at a time" for keeping bodies: not built.
 *   - Summaries are "editable", not "editable and deletable": an approved
 *     summary can be changed, not yet deleted (slice 7).
 *   - No "Read the full privacy page" link: that page is slice 7
 *     (docs/plan.md §3.12), same as on /login.
 *
 * The point of the screen is in docs/plan.md §3.1: a plain-English
 * explanation of what is read and what is stored, shown *before* the consent
 * screen rather than buried in a policy.
 */
export default async function ConnectPage({
  searchParams,
}: PageProps<"/connect">) {
  await requireUser();

  const { error } = await searchParams;
  const errorMessage =
    typeof error === "string"
      ? (ERROR_MESSAGES[error] ?? FALLBACK_ERROR)
      : null;

  return (
    <main className="flex flex-1 items-center justify-center bg-paper px-6 py-14 text-ink">
      <div className="flex w-full max-w-[620px] flex-col gap-[26px]">
        <div className="flex flex-col gap-[18px]">
          <BrandTile />
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.035em] sm:text-[33px]">
              Before you connect Gmail
            </h1>
            <p className="max-w-[530px] text-[15.5px] leading-[1.55] text-ink-soft">
              Google&rsquo;s permission screen comes next, and it is written by
              lawyers. This one is written by the person who built the app.
              Read this one first.
            </p>
          </div>
        </div>

        {errorMessage && (
          <Callout role="alert" icon="alert">
            {errorMessage}
          </Callout>
        )}

        <div className="flex flex-col gap-[22px] rounded-[18px] bg-white px-6 py-[26px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] sm:px-[30px]">
          <Section title="What it reads">
            <Item icon="check" tone="info">
              Message headers — who wrote, when, and the subject line
            </Item>
            <Item icon="check" tone="info">
              Message bodies — only for the one contact you ask to summarise, and only when you
              ask
            </Item>
          </Section>

          <Divider />

          <Section title="What it keeps">
            <Item icon="check" tone="affirm">
              Contact details, your notes, and message{" "}
              <span className="font-semibold">metadata</span> — sender, date, subject, direction
            </Item>
            <Item icon="check" tone="affirm">
              Summaries the AI writes and you approve — every one editable
            </Item>
            <Item icon="check" tone="affirm">
              <span className="font-semibold">Not</span> message bodies or attachments. Those stay
              in Gmail.
            </Item>
          </Section>

          <Divider />

          <Section title="What it will never do">
            <Item icon="cross" tone="muted">
              Send an email. The permission it asks for is read-only.
            </Item>
            <Item icon="cross" tone="muted">
              Track whether anyone opened or read a message
            </Item>
          </Section>
        </div>

        <Callout icon="info">
          Worth knowing: Google&rsquo;s read-only permission covers{" "}
          <span className="font-semibold">every message</span>, whole. This app reads a
          message&rsquo;s text only when you ask for a summary of that contact, sends it to OpenAI
          for that one request, and doesn&rsquo;t store it — but you are granting more than that,
          so you should hear it from me rather than notice it on the next screen.
        </Callout>

        <div className="flex flex-wrap items-center gap-4">
          {/*
            A form POST, not a link: a link can be triggered by any other
            site (an <img> or a redirect pointing at /api/auth/google), a
            cross-site POST is much harder to forge. The route answers with a
            303 redirect to Google's consent screen.
          */}
          <form action="/api/auth/google" method="post">
            <button
              type="submit"
              className="flex items-center gap-[9px] rounded-full bg-ink-deep px-[26px] py-3.5 text-[14.5px] font-semibold tracking-[-0.01em] text-white transition hover:bg-ink/85"
            >
              Continue to Google
              <Icon name="arrow" className="size-4" />
            </button>
          </form>

        </div>
      </div>
    </main>
  );
}
