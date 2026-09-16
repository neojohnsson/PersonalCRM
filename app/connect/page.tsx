import Link from "next/link";
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
 * Layout is design/Connect.dc.html. The wording is not, on purpose: the design
 * describes the finished app (subject lines, bodies for summaries, the draft
 * permission). Slice 1 asks for read-only and stores no subject, and a privacy
 * screen that describes permissions the app isn't requesting would mislead.
 * The copy moves back towards the design as slices 4 and 5 land.
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
              Message headers — who wrote, who received it, and when
            </Item>
          </Section>

          <Divider />

          <Section title="What it keeps">
            <Item icon="check" tone="affirm">
              Message <span className="font-semibold">metadata</span> — sender,
              recipients, date, and whether you sent it or received it
            </Item>
            <Item icon="check" tone="affirm">
              <span className="font-semibold">Not</span> message bodies,
              subject lines or attachments. Those stay in Gmail.
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
          <span className="font-semibold">whole messages</span>, not just
          headers. This app only ever asks Gmail for headers — but you are
          granting more than that, so you should hear it from me rather than
          notice it on the next screen.
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
              className="flex items-center gap-[9px] rounded-full bg-[#17181a] px-[26px] py-3.5 text-[14.5px] font-semibold tracking-[-0.01em] text-white transition hover:bg-ink/85"
            >
              Continue to Google
              <Icon name="arrow" className="size-4" />
            </button>
          </form>

          <Link
            href="/privacy"
            className="text-[14px] font-medium text-ink-soft hover:text-ink"
          >
            Read the full privacy page
          </Link>
        </div>
      </div>
    </main>
  );
}
