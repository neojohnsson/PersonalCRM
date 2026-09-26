import Link from "next/link";

/**
 * The one way back (UI quality pass, milestone 6). Six pages had a
 * "← Assistant" text link and a contact's page a bare round arrow; now all of
 * them have this: the arrow and the name of where it goes, so it says where,
 * not just "back".
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 self-start rounded-full bg-white py-1.5 pr-3.5 pl-2.5 text-sm font-semibold text-ink-body shadow-[0_1px_2px_rgba(20,20,25,.05)] transition-colors hover:text-ink"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      {children}
    </Link>
  );
}
