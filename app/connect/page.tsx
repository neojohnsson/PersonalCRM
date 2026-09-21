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

  // The calendar's own consent, slice 8a. Separate codes, because "it didn't
  // work" is no help when two different connections can fail on this page.
  calendar_state_mismatch:
    "That calendar connection attempt couldn't be verified, so it was stopped. If you started it, try again from the calendar button.",
  calendar_denied:
    "The calendar wasn't connected — the permission was cancelled on Google's screen. Everything else carries on working.",
  calendar_token_exchange:
    "Google approved the calendar, but finishing it failed. Try again from the calendar button.",
  calendar_scope_missing:
    "The calendar wasn't connected — permission to view events wasn't granted on Google's screen. It's the only calendar permission this app asks for.",
  calendar_no_refresh_token:
    "Google didn't hand over the long-term access needed to read your calendar tomorrow as well as today. Try again from the calendar button.",
  calendar_save_failed:
    "Google approved the calendar, but saving it failed. Nothing was stored. Try again from the calendar button.",
};

const FALLBACK_ERROR = "Something went wrong connecting Gmail. Try again.";

/**
 * The screen that runs before Google's consent screen.
 *
 * Layout and most wording are design/Connect.dc.html's. Differences, on
 * purpose — a privacy screen that describes what the app doesn't do would
 * mislead:
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
              Message bodies — only for the one contact you ask to summarise or reply to, and only
              when you ask. Sent to OpenAI for that request, never stored
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
              Send an email. Drafts land in Gmail and <span className="font-semibold">you</span>{" "}
              press send.
            </Item>
            <Item icon="cross" tone="muted">
              Track whether anyone opened or read a message
            </Item>
          </Section>
        </div>

        <Callout icon="info">
          Worth knowing: Google&rsquo;s draft permission also technically permits{" "}
          <span className="font-semibold">sending</span>. There is no send endpoint anywhere in
          this app — but you are granting the ability, so you should hear it from me rather than
          notice it on the next screen. You can untick drafts there; everything but Draft reply
          still works.
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

        <Divider />

        {/*
          Slice 8a: the calendar, as its own connection with its own consent
          screen (docs/slice-8-plan.md, Part 1). Not in design/Connect.dc.html,
          which was drawn when Gmail was the only thing to connect; it reuses
          the same Section, Callout and button as the Gmail half above.

          Deliberately below the Gmail button and not beside it: Gmail is what
          the app needs, the calendar is what makes it more accurate. Connecting
          it is optional and everything works without it.
        */}
        <Section title="Your calendar, if you want it">
          <Item icon="check" tone="affirm">
            A meeting with someone says more about a relationship than any email does. With the
            calendar connected, a meeting counts towards how warm a contact is, and a suggested
            follow-up date will avoid a day you are already full — and will not suggest writing
            to somebody you are about to see anyway.
          </Item>
          <Item icon="check" tone="info">
            Only the start, the end and the guest addresses of each event are read. Never the
            description or attachments &mdash; people put private things in those, so this app
            does not ask Google for them at all.
          </Item>
          <Item icon="check" tone="info">
            Only meetings with someone already in your contacts are stored, as the date and
            which contact it was. No titles, no other guests.
          </Item>
          <Callout icon="info">
            This app asks for permission to <strong>view</strong> events and nothing else. It
            cannot create, change or delete anything in your calendar, because it never asks
            for the permission that would allow it. A follow-up date stays a date inside this
            app.
          </Callout>

          <div className="flex flex-wrap items-center gap-4">
            {/* A POST, for the same reason as the Gmail button above. */}
            <form action="/api/auth/google/calendar" method="post">
              <button
                type="submit"
                className="flex items-center gap-[9px] rounded-full bg-white px-[26px] py-3.5 text-[14.5px] font-semibold tracking-[-0.01em] shadow-[0_1px_2px_rgba(20,20,25,.05)] transition hover:bg-paper-tint"
              >
                Connect your calendar
                <Icon name="arrow" className="size-4" />
              </button>
            </form>
          </div>
        </Section>
      </div>
    </main>
  );
}
