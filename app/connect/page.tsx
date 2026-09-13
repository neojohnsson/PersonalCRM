import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";

export const metadata = { title: `Connect Gmail · ${APP_NAME}` };

/**
 * The screen that runs before Google's consent screen.
 *
 * Content is from design/Connect.dc.html. The point of it is in
 * docs/plan.md §3.1: a plain-English explanation of what is read and what is
 * stored, shown *before* the consent screen rather than buried in a policy.
 */
export default function ConnectPage() {
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

        <Section title="What it reads">
          <Item>
            Message headers — who wrote, when, and the subject line
          </Item>
          <Item>
            Message bodies — only for the one thread you ask to summarise or
            reply to
          </Item>
        </Section>

        <Section title="What it keeps">
          <Item>
            Contact details, your notes, and message metadata — sender, date,
            subject, direction
          </Item>
          <Item>
            Summaries you write or generate — every one editable and deletable
          </Item>
          <Item emphasis>
            Not message bodies. Those stay in Gmail unless you opt in, one
            contact at a time.
          </Item>
        </Section>

        <Section title="What it will never do">
          <Item>
            Send an email. Drafts land in Gmail and you press send.
          </Item>
          <Item>Track whether anyone opened or read a message</Item>
        </Section>

        <p className="mt-8 rounded-xl border border-accent/20 bg-accent-tint px-5 py-4 text-[14px] leading-6 text-ink">
          <strong className="font-semibold">Worth knowing:</strong>{" "}
          Google&rsquo;s draft permission also technically permits sending.
          There is no send endpoint anywhere in this app — but you are granting
          the ability, so you should hear it from me rather than notice it on
          the next screen.
        </p>

        <div className="mt-8 flex flex-col items-start gap-4">
          {/*
            A plain link, not a fetch: this hands the browser to your route,
            which builds the Google consent URL and redirects. A form POST
            would be the stricter choice (it can't be triggered by someone
            else's page), and is worth doing when you write the route.
          */}
          <Link
            href="/api/auth/google"
            className="rounded-lg bg-ink px-5 py-3 text-[15px] font-medium text-white transition hover:bg-[#17181a]"
          >
            Continue to Google
          </Link>

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
