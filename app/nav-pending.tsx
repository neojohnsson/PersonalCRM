"use client";

import Link, { useLinkStatus } from "next/link";

/**
 * "Going there" on a navigation item, from the moment it is pressed until the
 * page changes (UI quality pass, milestone 3). Before, a press changed nothing
 * on screen until the new page arrived.
 *
 * Always rendered and the same size, only its opacity changes, so nothing
 * moves; and it waits 100ms before showing (.nav-pending, app/globals.css), so
 * a fast navigation does not flash it. Must sit inside a <Link>: useLinkStatus
 * reads the Link it is in. `className` moves it, for an item whose word is
 * not where the bar would go (the Profile avatar on the rail).
 */
export function NavPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`nav-pending ${pending ? "is-pending" : ""} ${className}`} />;
}

/**
 * A contact's name that opens their page, and makes its whole row the click
 * target (the stretched-link utility). The row it sits in must be `relative`.
 *
 * While the contact's page loads, the row fades a little (.row-pending): a
 * contact's page is the slowest one in the app, and a click on a row used to
 * change nothing until it arrived. Six lists use this, so the stretch and the
 * fade are written once, here.
 */
export function RowLink({
  href,
  className = "",
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`stretched-link ${className}`}>
      {children}
      <RowPending />
    </Link>
  );
}

function RowPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`row-pending ${pending ? "is-pending" : ""}`} />;
}
