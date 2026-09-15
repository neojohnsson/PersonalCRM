import { APP_NAME } from "@/lib/app-config";
import { initials } from "@/lib/format";

/**
 * The frame around signed-in pages: design/Main.dc.html and
 * ContactList.dc.html share it — a dark sidebar on the left, a header on top.
 *
 * Differences from the design, on purpose:
 *   - The sidebar shows only People. The design's Home, Seen once, Calendar
 *     and Settings pages don't exist until later slices, and a nav item that
 *     goes nowhere would be a lie. The header's centred page switcher is left
 *     out for the same reason: with one page there's nothing to switch.
 *   - The header's search and notification icons are left out — nothing
 *     behind them yet. The right side holds what the design has no place
 *     for: the connected Gmail address, Disconnect and Sign out.
 *   - Below the sm breakpoint the sidebar is hidden and the app name shows
 *     in the header instead, so the list keeps the width on a phone.
 */
export function AppShell({
  userEmail,
  headerRight,
  children,
}: {
  userEmail: string | undefined;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 bg-paper text-ink">
      <aside className="hidden w-14 shrink-0 flex-col items-center gap-[3px] bg-ink-deep pt-3.5 pb-4 sm:flex">
        <div
          aria-hidden="true"
          className="mb-3 flex size-[30px] items-center justify-center rounded-[9px] bg-white"
        >
          <span className="text-[14px] font-extrabold tracking-[-0.03em] text-ink-deep">
            {APP_NAME.charAt(0)}
          </span>
        </div>

        <nav aria-label="Main">
          <span
            aria-current="page"
            title="People"
            className="flex size-9 items-center justify-center rounded-[11px] bg-rail-active text-white"
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
              <circle cx="9.5" cy="8" r="3.3" />
              <path d="M3.5 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6" />
              <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.5" />
              <path d="M18.4 14.9c1.9.7 2.9 2.5 2.9 5.1" />
            </svg>
            <span className="sr-only">People</span>
          </span>
        </nav>

        <div className="flex-grow" />

        {userEmail && (
          <div
            title={userEmail}
            className="mt-1.5 flex size-[30px] items-center justify-center rounded-full bg-rail-avatar"
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
