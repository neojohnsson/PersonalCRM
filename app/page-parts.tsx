import type { SyncLine } from "@/lib/sync/describe";

/**
 * Small pieces the list pages share: the sync status line from
 * design/Main.dc.html, and the white card an empty list shows instead.
 */

export const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)]";

const DOT: Record<SyncLine["tone"], string> = {
  ok: "bg-affirm",
  busy: "bg-info animate-pulse",
  problem: "bg-accent",
  idle: "bg-ink-faint",
};

/** "Last synced 4 minutes ago · 312 messages · 18 contacts", with its coloured dot. */
export function StatusLine({ line }: { line: SyncLine }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[line.tone]}`} />
      <p role="status" className="text-[12.5px] font-medium text-ink-quiet">
        {line.text}
      </p>
    </div>
  );
}

export function EmptyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${CARD} flex max-w-xl flex-col px-[22px] py-6 sm:px-8`}>
      <h2 className="text-[14.5px] font-bold tracking-[-0.015em]">{title}</h2>
      <div className="mt-2 flex flex-col text-[13.5px] leading-[1.55] text-ink-soft">{children}</div>
    </section>
  );
}
