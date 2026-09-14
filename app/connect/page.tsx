import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";

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
};

const FALLBACK_ERROR = "Something went wrong connecting Gmail. Try again.";

/**
 * The screen that runs before Google's consent screen.
 *
 * Content is from design/Connect.dc.html. The point of it is in
 * docs/plan.md §3.1: a plain-English explanation of what is read and what is
 * stored, shown *before* the consent screen rather than buried in a policy.
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
    <main className="flex flex-1 justify-center bg-paper px-6 py-14">
      <div className="w-full max-w-xl">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">
          Before you connect Gmail
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-ink-soft">
          Google&rsquo;s permission screen comes next, and it is written by
          lawyers. This one is written by the person who built the app. Read
          this one first.
        </p>

        {errorMessage && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-accent/20 bg-accent-tint px-5 py-4 text-[14px] leading-6 text-ink"
          >
            {errorMessage}
          </p>
        )}

        <Section title="What it reads">
          <Item>
            Message headers — who wrote, who received it, and when
          </Item>
        </Section>

        <Section title="What it keeps">
          <Item>
            Message metadata — sender, recipients, date, and whether you sent
            it or received it
          </Item>
          <Item emphasis>
            Not message bodies, subject lines or attachments. Those stay in
            Gmail.
          </Item>
        </Section>

        <Section title="What it will never do">
          <Item>
            Send an email. The permission it asks for is read-only.
          </Item>
          <Item>Track whether anyone opened or read a message</Item>
        </Section>

        <p className="mt-8 rounded-xl border border-accent/20 bg-accent-tint px-5 py-4 text-[14px] leading-6 text-ink">
          <strong className="font-semibold">Worth knowing:</strong>{" "}
          Google&rsquo;s read-only permission covers whole messages, not just
          headers. This app only ever asks Gmail for headers — but you are
          granting more than that, so you should hear it from me rather than
          notice it on the next screen.
        </p>

        <div className="mt-8 flex flex-col items-start gap-4">
          {/*
            A form POST, not a link: a link can be triggered by any other
            site (an <img> or a redirect pointing at /api/auth/google), a
            cross-site POST is much harder to forge. The route answers with a
            303 redirect to Google's consent screen.
          */}
          <form action="/api/auth/google" method="post">
            <button
              type="submit"
              className="rounded-lg bg-ink px-5 py-3 text-[15px] font-medium text-white transition hover:bg-[#17181a]"
            >
              Continue to Google
            </button>
          </form>

          <Link
            href="/privacy"
            className="text-[14px] font-medium text-accent hover:text-accent-dark"
          >
            Read the full privacy page
          </Link>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded-xl border border-line bg-white p-6">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
        {title}
      </h2>
      <ul className="mt-4 flex flex-col gap-3">{children}</ul>
    </section>
  );
}

function Item({
  children,
  emphasis = false,
}: {
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <li className="flex gap-3 text-[15px] leading-6">
      <span
        aria-hidden="true"
        className={`mt-[9px] size-1.5 shrink-0 rounded-full ${
          emphasis ? "bg-affirm" : "bg-ink-faint"
        }`}
      />
      <span className={emphasis ? "font-medium text-ink" : "text-ink-soft"}>
        {children}
      </span>
    </li>
  );
}
