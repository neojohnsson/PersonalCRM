import { AppShell } from "@/app/app-shell";
import { DeletePanel } from "@/app/privacy/delete-panel";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { requireUser } from "@/lib/auth";
import { headline, isEmpty, loadHoldings, type Holding } from "@/lib/privacy/holdings";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: `Your data · ${APP_NAME}` };

/**
 * What this app holds, in plain words and real numbers (plan.md §3.12;
 * docs/slice-7-plan.md, Part 1).
 *
 * "Privacy controls — a real feature, not a footer link." The numbers are
 * counted from the database as the page loads, so it is either right or
 * obviously broken; a page describing what a developer believes is stored goes
 * stale the first time a migration lands.
 *
 * It is written to be read by the people in the list, not only by the person
 * using the app — the standard plan.md §5.2 sets for the AI summary, applied to
 * the page about the summary.
 *
 * No design covers this. It is Profile.dc.html's white cards, headings and
 * label/value rows, which is the nearest designed screen and the same kind of
 * page: settings about yourself rather than a list of people. It is reached
 * from Profile for the same reason, rather than taking a sixth place in the
 * sidebar — the account area is where it belongs, and the sidebar is for the
 * screens you open every day.
 */

const CARD =
  "flex flex-col gap-3.5 rounded-[18px] bg-white px-[22px] pt-[18px] pb-5 shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

export default async function PrivacyPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const holdings = await loadHoldings(supabase, user.id);

  const about = (group: Holding["group"]) => holdings.filter((holding) => holding.group === group);

  return (
    <AppShell userEmail={user.email} active="profile" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-[18px] px-4 pt-2 pb-[30px] sm:px-[30px]">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="text-[27px] leading-[1.1] font-bold tracking-[-0.035em]">Your data</h1>
          <p className="text-[13.5px] leading-[1.55] text-ink-soft">
            Everything this app has stored, counted as this page loaded. Most of it is about
            other people &mdash; people who never signed up for anything &mdash; so it is
            written to be read by them.
          </p>
          <p className="text-[14px] font-semibold tracking-[-0.01em]">{headline(holdings)}</p>
        </div>

        {isEmpty(holdings) && (
          <section className={`${CARD} max-w-3xl`}>
            <p className="text-[13.5px] leading-[1.55] text-ink-soft">
              Nothing is stored yet. Connect Gmail and the numbers below start filling in.
            </p>
          </section>
        )}

        <div className="flex max-w-3xl flex-col gap-[18px]">
          <HoldingCard
            title="About the people in your list"
            caption="Kept until you delete them"
            holdings={about("people")}
          />
          <HoldingCard title="About you" caption="Your account and settings" holdings={about("you")} />

          <section className={CARD}>
            <CardHeading title="What leaves this app" caption="And what those services keep" />
            <Away
              who="Google"
              what="Your mail is read to find who wrote to whom and when, and to read a message when a summary, a draft or a promise needs one. Drafts are written back into your Gmail. Nothing is ever sent."
              keeps="Google already has your mail. This app adds drafts, which sit in your Gmail until you send or delete them."
            />
            <Away
              who="OpenAI"
              what="The text of a conversation is sent when you ask for a summary, a draft or a promise scan — never on its own, never on sync."
              keeps="Nothing. Requests are made with storage switched off, so the text is not kept after the answer comes back."
            />
            <p className="text-[12px] leading-[1.5] text-ink-faint">
              Message bodies are never written to this app&rsquo;s database. They are read when
              something needs them and thrown away when the request ends &mdash; which is why
              there is no retention period here to set.
            </p>
          </section>

          <section className={CARD}>
            <CardHeading title="Take it with you" caption="Built when you ask, stored nowhere" />
            <p className="text-[13px] leading-[1.55] text-ink-body">
              Every row above, as a file. The Gmail refresh token is left out on purpose &mdash;
              it is encrypted with a key that isn&rsquo;t in the file, so it could only ever be
              noise in a download that gets forwarded and saved.
            </p>
            <div className="flex flex-wrap gap-[7px]">
              <a
                href="/privacy/export"
                className="rounded-full bg-ink-deep px-[15px] py-2 text-[12px] font-semibold text-white transition hover:bg-ink/85"
              >
                Export everything
              </a>
              <a
                href="/privacy/export?as=csv"
                className="rounded-full bg-line-soft px-3.5 py-2 text-[12px] font-semibold text-ink-body transition hover:bg-chip-track"
              >
                Contacts as a spreadsheet
              </a>
            </div>
          </section>

          <section className={CARD}>
            <CardHeading title="Delete it" caption="No undo, so each one is typed out" />
            <p className="text-[13px] leading-[1.55] text-ink-body">
              Deleting one person is on their own page. These two are the bigger ones, and both
              really delete &mdash; no archive, no soft delete, nothing kept to be helpful.
            </p>
            <DeletePanel
              email={user.email ?? ""}
              contactCount={holdings.find((holding) => holding.table === "contacts")?.count ?? 0}
            />
          </section>

          <section className={CARD}>
            <CardHeading title="If someone asks what you hold on them" caption="They are allowed to" />
            <p className="text-[13px] leading-[1.55] text-ink-body">
              Anyone in your list can ask for a copy of their record, including what the AI wrote
              about them, and can ask you to delete it. Open their page: <strong>Export this
              person</strong> gives you the copy, and <strong>Dismiss</strong> deletes them and
              their mail from here.
            </p>
            <p className="text-[12px] leading-[1.5] text-ink-faint">
              The written version of all of this, with the legal reasoning behind it, is in{" "}
              <code className="text-[11.5px]">docs/privacy.md</code> in the repository.
            </p>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function HoldingCard({
  title,
  caption,
  holdings,
}: {
  title: string;
  caption: string;
  holdings: Holding[];
}) {
  return (
    <section className={CARD}>
      <CardHeading title={title} caption={caption} />
      <ul className="flex flex-col">
        {holdings.map((holding) => (
          <li
            key={holding.table}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line-soft py-3 first:border-t-0 first:pt-0"
          >
            <span className="w-[52px] shrink-0 text-[15px] font-bold tabular-nums">
              {holding.count}
            </span>
            <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
              <span className="text-[13px] font-semibold tracking-[-0.01em]">{holding.label}</span>
              <span className="text-[12.5px] leading-[1.5] text-ink-soft">{holding.what}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Away({ who, what, keeps }: { who: string; what: string; keeps: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line-soft py-3 first:border-t-0 first:pt-0">
      <span className="text-[13px] font-semibold tracking-[-0.01em]">{who}</span>
      <span className="text-[12.5px] leading-[1.5] text-ink-soft">{what}</span>
      <span className="text-[12.5px] leading-[1.5] text-ink-muted">
        <span className="font-semibold">They keep:</span> {keeps}
      </span>
    </div>
  );
}

function CardHeading({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">{title}</h2>
      <span className="text-[12px] font-semibold text-ink-faint">{caption}</span>
    </div>
  );
}

