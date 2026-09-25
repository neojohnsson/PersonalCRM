import Link from "next/link";
import { BrandTile } from "@/app/intro-screen";
import { LEGAL_REVIEWED, LEGAL_UPDATED, OPERATOR } from "@/lib/legal/operator";

/**
 * The frame of the three public pages: /terms, /privacy-policy and
 * /sub-processors (slice 13, commit 6; docs/slice-13-plan.md §5).
 *
 * No design covers them. It is the Login screen's frame, as /pricing is
 * (design/Login.dc.html): the paper page, the brand tile, a heading, then one
 * white card of plain text, because they are read outside the app.
 *
 * Two honest gaps, shown rather than hidden:
 *   - "Draft": nobody who knows Swedish and EU law has read these yet.
 *   - Who runs the service: empty until the business is registered
 *     (lib/legal/operator.ts). A made-up name would be worse than a gap.
 */

export function LegalPage({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 justify-center bg-paper px-4 py-12 text-ink sm:px-6 sm:py-14">
      <div className="flex w-full max-w-[720px] flex-col gap-[22px]">
        <div className="flex flex-col gap-[18px]">
          <BrandTile />
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.035em] sm:text-[33px]">{title}</h1>
            <p className="text-[15.5px] leading-[1.55] text-ink-soft">{lead}</p>
            <p className="text-[12.5px] text-ink-quiet">Last changed {LEGAL_UPDATED}</p>
          </div>
        </div>

        {!LEGAL_REVIEWED && (
          <p
            role="note"
            className="rounded-[14px] bg-accent-tint px-4 py-3 text-[13px] leading-[1.5] font-medium text-accent-dark"
          >
            Draft. Nobody who knows Swedish and EU law has reviewed this page yet, and the app is not open to the
            public. It says what the app really does today; the wording may change before launch.
          </p>
        )}

        <article className="flex flex-col gap-[22px] rounded-[18px] bg-white px-6 py-[24px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] sm:px-[30px]">
          {children}
        </article>

        <nav className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] text-ink-quiet" aria-label="Legal pages">
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy-policy" className="underline underline-offset-2 hover:text-ink">
            Privacy policy
          </Link>
          <Link href="/sub-processors" className="underline underline-offset-2 hover:text-ink">
            Sub-processors
          </Link>
          <Link href="/pricing" className="underline underline-offset-2 hover:text-ink">
            Plans
          </Link>
        </nav>
      </div>
    </main>
  );
}

export function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[16px] font-bold tracking-[-0.02em]">{title}</h2>
      <div className="flex flex-col gap-2.5 text-[14px] leading-[1.6] text-ink-body">{children}</div>
    </section>
  );
}

export function Points({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5">{children}</ul>;
}

/** Who runs the service, or the plain gap until that is decided. */
export function Operator() {
  if (OPERATOR.name && OPERATOR.email) {
    return (
      <>
        {OPERATOR.name}, {OPERATOR.country}.{" "}
        <a href={`mailto:${OPERATOR.email}`} className="font-semibold underline underline-offset-2">
          {OPERATOR.email}
        </a>
      </>
    );
  }
  return (
    <span className="font-semibold text-accent-dark">
      Not filled in yet: the business that will run the service is not registered. Its name, organisation number and
      contact address go here before launch.
    </span>
  );
}
