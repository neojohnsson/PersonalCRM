import Link from "next/link";
import type { SyncLine } from "@/lib/sync/describe";

/**
 * Small pieces the list pages share: the sync status line from
 * design/Main.dc.html, and the white card an empty list shows instead.
 */

export const CARD =
  "rounded-xl bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const DOT: Record<SyncLine["tone"], string> = {
  ok: "bg-affirm",
  busy: "bg-info animate-pulse",
  problem: "bg-accent",
  idle: "bg-ink-soft",
};

/** "Last synced 4 minutes ago · 312 messages · 18 contacts", with its coloured dot. */
export function StatusLine({ line }: { line: SyncLine }) {
  return (
    // The dot sits on the first line, not in the middle of the block: on a
    // phone the text wraps, and a centred dot ended up alone between the two
    // lines (UI quality pass, milestone 5). 7px = (20px line - 6px dot) / 2.
    <div className="flex items-start gap-[9px]">
      <span aria-hidden="true" className={`mt-[7px] size-1.5 shrink-0 rounded-full ${DOT[line.tone]}`} />
      <p role="status" className="text-sm font-normal text-ink-soft">
        {line.text}
      </p>
    </div>
  );
}

const EMPTY_ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13h4l1.4 2.4h5.2L16 13h4" />
      <path d="M5.6 5h12.8l2.6 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.3" />
      <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 6.3M18 14.2c2 .7 3.2 2.5 3.2 5.3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  done: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
};

/**
 * What a list shows when it has nothing in it (UI quality pass, milestone 5).
 * Centred in the page, not clinging to its top-left corner; an icon for what
 * kind of emptiness it is; and at most one clear next step, as a button.
 * my-auto centres it in the room the page has left below its heading.
 */
export function EmptyCard({
  title,
  icon = "inbox",
  action,
  children,
}: {
  title: string;
  icon?: keyof typeof EMPTY_ICONS;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${CARD} mx-auto my-auto flex w-full max-w-md flex-col items-center px-[22px] py-8 text-center sm:px-8`}
    >
      <span aria-hidden="true" className="mb-3.5 flex size-10 items-center justify-center rounded-full bg-chip text-ink-soft">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          {EMPTY_ICONS[icon]}
        </svg>
      </span>
      <h2 className="text-base font-bold tracking-[-0.015em]">{title}</h2>
      <div className="mt-2 flex flex-col items-center text-sm text-ink-soft">{children}</div>
      {action && (
        <Link
          href={action.href}
          className="mt-5 rounded-full bg-ink-deep px-4 py-[9px] text-sm font-semibold text-white transition hover:bg-ink/85"
        >
          {action.label}
        </Link>
      )}
    </section>
  );
}
