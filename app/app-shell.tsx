import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";
import { initials } from "@/lib/format";

/**
 * The frame around signed-in pages: design/Main.dc.html, ContactList.dc.html
 * and ReviewQueue.dc.html share it — a dark sidebar on the left, a header on top.
 *
 * Differences from the design, on purpose:
 *   - The sidebar holds only pages that exist: Home, Contacts and Seen once.
 *     The design's Add, Calendar and Settings icons arrive with their pages,
 *     because a nav item that goes nowhere would be a lie. The header's centred
 *     page switcher is left out for the same reason.
 *   - The header's search and notification icons are left out — nothing
 *     behind them yet. The right side holds what the design has no place
 *     for: the connected Gmail address, Disconnect and Sign out.
 *   - Below the sm breakpoint the sidebar is hidden and the app name shows
 *     in the header instead, so lists keep the width on a phone.
 *
 * The sidebar is sticky: it stays the height of the window and doesn't move
 * while the page scrolls — the design is a fixed 900px frame, so it never
 * had to say what happens below the fold.
 */
export function AppShell({
  userEmail,
  headerRight,
  active = "contacts",
  seenOnceCount = 0,
  children,
}: {
  userEmail: string | undefined;
  headerRight?: React.ReactNode;
  /** Which sidebar entry is the current page. */
  active?: "home" | "contacts" | "seen-once";
  /** People waiting in Seen once; the design's orange dot shows when above 0. */
  seenOnceCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 bg-paper text-ink">
      <aside className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col items-center gap-[3px] self-start bg-ink-deep pt-3.5 pb-4 sm:flex">
        <div
          aria-hidden="true"
          className="mb-3 flex size-[30px] items-center justify-center rounded-[9px] bg-white"
        >
          <span className="text-[14px] font-extrabold tracking-[-0.03em] text-ink-deep">
            {APP_NAME.charAt(0)}
          </span>
        </div>

        <nav aria-label="Main" className="flex flex-col items-center gap-[3px]">
          <NavItem href="/" label="Who needs you today" active={active === "home"}>
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5.5 9.4V20h13V9.4" />
          </NavItem>
          <NavItem href="/contacts" label="Contacts" active={active === "contacts"}>
            <circle cx="9.5" cy="8" r="3.3" />
            <path d="M3.5 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6" />
            <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.5" />
            <path d="M18.4 14.9c1.9.7 2.9 2.5 2.9 5.1" />
          </NavItem>
          <NavItem
            href="/seen-once"
            label="Seen once"
            active={active === "seen-once"}
            dot={seenOnceCount > 0}
          >
            <path d="M4 13h4l1.4 2.4h5.2L16 13h4" />
            <path d="M5.6 5h12.8l2.6 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
          </NavItem>
        </nav>

        <div className="flex-grow" />

        {userEmail && (
          <div
            title={userEmail}
            // A rounded square like the logo tile, not the design's circle:
            // changed at the user's request, 2026-09-16.
            className="mt-1.5 flex size-[30px] items-center justify-center rounded-[9px] bg-rail-avatar"
          >
            <span className="text-[10.5px] font-bold text-white">
              {initials(null, userEmail)}
            </span>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-3 px-4 sm:px-[26px]">
          <span className="text-[15px] font-semibold tracking-tight sm:hidden">{APP_NAME}</span>
          <div className="ml-auto flex items-center gap-2">{headerRight}</div>
        </header>

        {children}
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  active,
  dot = false,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`relative flex size-9 items-center justify-center rounded-[11px] transition-colors ${
        active ? "bg-rail-active text-white" : "text-rail-icon hover:text-white"
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[18px]"
      >
        {children}
      </svg>
      {dot && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent-soft"
        />
      )}
      <span className="sr-only">{label}</span>
    </Link>
  );
}
