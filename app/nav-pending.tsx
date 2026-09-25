"use client";

import { useLinkStatus } from "next/link";

/**
 * "Going there" on a navigation item, from the moment it is pressed until the
 * page changes (UI quality pass, milestone 3). Before, a press changed nothing
 * on screen until the new page arrived.
 *
 * Always rendered and the same size, only its opacity changes, so nothing
 * moves; and it waits 100ms before showing (.nav-pending, app/globals.css), so
 * a fast navigation does not flash it. Must sit inside a <Link>: useLinkStatus
 * reads the Link it is in.
 */
export function NavPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`nav-pending ${pending ? "is-pending" : ""}`} />;
}
