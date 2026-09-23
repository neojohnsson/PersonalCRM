import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";
import { initials } from "@/lib/format";
import { visiblePages, type ActivePage, type PageKey } from "@/lib/nav";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/app/toasts";

/**
 * The frame around signed-in pages: design/Main.dc.html, ContactList.dc.html
 * and ReviewQueue.dc.html share it — a dark sidebar on the left, a header on top.
 *
 * Differences from the design, on purpose:
 *   - The sidebar holds only pages that exist: Home, Calendar, Contacts and
 *     Seen once. Calendar joined in slice 8b with design/Calendar.dc.html's
 *     own icon, taken from that screen's sidebar. The design's Add and
 *     Settings icons arrive with their pages, because a nav item that goes
 *     nowhere would be a lie.
 *   - Your week and Promises left the rail in slice 9b (docs/slice-9b-plan.md,
 *     Part 7). Both pages still work: Home links to Your week, and Your week
 *     links to Promises. They are deleted when the Assistant's cards replace
 *     what they do.
 *   - The Assistant (slice 11) sits second, and only for an account that
 *     includes it (`entitlements`, migration 0025). Everybody else gets the
 *     four; the rail, the bottom bar and the switcher all read the same
 *     filtered list, so none of them can show it when the others don't.
 *   - The header's search and notification icons are left out — nothing
 *     behind them yet. The right side holds what the design has no place
 *     for: the connected Gmail address and Sign out.
 *   - Below the sm breakpoint the sidebar is hidden and the app name shows
 *     in the header instead, so lists keep the width on a phone. The
 *     navigation is a bottom bar there (BottomBar, below). No design covers
 *     a phone at all — the canvas is a fixed 1440x900 frame.
 *
 * The sidebar is sticky: it stays the height of the window and doesn't move
 * while the page scrolls — the design is a fixed 900px frame, so it never
 * had to say what happens below the fold.
 */

/**
 * One icon per entry in lib/nav.ts, each taken from the design's own sidebar.
 * The list of pages lives there, as data, so the rail, the bottom bar and a
 * test can all read the same truth; only the drawing is here.
 */
/** The pages one person sees: the four, plus the Assistant when it is theirs. */
type VisiblePages = ReturnType<typeof visiblePages>;

const ICONS: Record<PageKey, React.ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.4V20h13V9.4" />
    </>
  ),
  // The approved Assistant design's own mark: a four-pointed spark and a
  // small one beside it (https://claude.ai/artifact/5ZpxKE8QYemKm7ceo9Twgg).
  assistant: (
    <>
      <path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z" />
      <path d="M18.2 15.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  // design/Calendar.dc.html's own sidebar icon, from the screen it belongs to:
  // a month box with two pegs on top.
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.6" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  contacts: (
    <>
      <circle cx="9.5" cy="8" r="3.3" />
      <path d="M3.5 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6" />
      <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.5" />
      <path d="M18.4 14.9c1.9.7 2.9 2.5 2.9 5.1" />
    </>
  ),
  "seen-once": (
    <>
      <path d="M4 13h4l1.4 2.4h5.2L16 13h4" />
      <path d="M5.6 5h12.8l2.6 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
    </>
  ),
};

export async function AppShell({
  userEmail,
  headerRight,
  active = "contacts",
  seenOnceCount = 0,
  children,
}: {
  userEmail: string | undefined;
  headerRight?: React.ReactNode;
  /** Which navigation entry is the current page. */
  active?: ActivePage;
  /** People waiting in Seen once; the design's orange dot shows when above 0. */
  seenOnceCount?: number;
  children: React.ReactNode;
}) {
  // Which pages this person has: the Assistant only when their account
  // includes it (slice 11). Every page renders the shell, so the check is
  // cached for the request and costs one tiny read.
  const user = await requireUser();
  const pages = visiblePages(await hasAssistant(await createClient(), user.id));

  return (
    <ToastProvider>
      <div className="flex flex-1 bg-paper text-ink">
        <a
          href="#main-content"
          className="sr-only fixed left-3 top-3 z-50 rounded-full bg-ink-deep px-4 py-2 text-[13px] font-semibold text-white focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-paper"
        >
          Skip to main content
        </a>
        <aside className="sticky top-0 z-40 hidden h-dvh w-14 shrink-0 flex-col items-center gap-[3px] self-start bg-ink-deep pt-3.5 pb-4 sm:flex">
          <div
            aria-hidden="true"
            className="mb-3 flex size-[30px] items-center justify-center rounded-[9px] bg-white"
          >
            <span className="text-[14px] font-extrabold tracking-[-0.03em] text-ink-deep">
              {APP_NAME.charAt(0)}
            </span>
          </div>

          <nav aria-label="Main" className="flex flex-col items-center gap-[3px]">
            {pages.map((page) => (
              <NavItem
                key={page.key}
                href={page.href}
                label={page.label}
                title={page.title}
                active={active === page.key}
                dot={page.key === "seen-once" && seenOnceCount > 0}
              >
                {ICONS[page.key]}
              </NavItem>
            ))}
          </nav>

          <div className="flex-grow" />

          {userEmail && (
            // Opens Profile, as in design/Profile.dc.html, which also shows its
            // active state: a lighter tile behind the avatar with a white ring.
            <Link
              href="/profile"
              aria-current={active === "profile" ? "page" : undefined}
              className={`group relative mt-1.5 flex size-9 items-center justify-center rounded-[11px] transition-colors ${
                active === "profile" ? "bg-rail-active" : "hover:bg-rail-active"
              }`}
            >
              <span
                // A rounded square like the logo tile, not the design's circle:
                // changed at the user's request, 2026-09-16.
                className={`flex items-center justify-center rounded-[9px] bg-rail-avatar ${
                  active === "profile" ? "size-7 ring-[1.5px] ring-white" : "size-[30px]"
                }`}
              >
                <span className="text-[10.5px] font-bold text-white">{initials(null, userEmail)}</span>
                <span className="sr-only">Profile</span>
              </span>
              <HoverLabel>{`Profile · ${userEmail}`}</HoverLabel>
            </Link>
          )}
        </aside>

        {/* Room for the bottom bar, which is fixed and would otherwise cover the
            last row of every page. */}
        <div className="flex min-w-0 flex-1 flex-col pb-[74px] sm:pb-0">
          <header className="relative flex h-[60px] shrink-0 items-center gap-3 px-4 sm:px-[26px]">
            <span className="text-[15px] font-semibold tracking-tight sm:hidden">{APP_NAME}</span>
            <PageSwitcher active={active} pages={pages} />
            <div className="ml-auto flex items-center gap-2">{headerRight}</div>
          </header>

          <div id="main-content" className="flex min-w-0 flex-1 flex-col focus:outline-none" tabIndex={-1}>
            {children}
          </div>
        </div>

        <BottomBar active={active} pages={pages} seenOnceCount={seenOnceCount} userEmail={userEmail} />
      </div>
    </ToastProvider>
  );
}

/**
 * The header's centred page switcher — the white pill of words that five of
 * the designs carry (design/Main.dc.html, ContactList.dc.html,
 * ReviewQueue.dc.html, Calendar.dc.html and ContactDetail.dc.html). It was
 * left out of every one of them until now, on the grounds that the rail
 * already went to those pages; you asked for it on 2026-09-22, and it is in
 * the Assistant design we agreed before building.
 *
 * The **word** variant, not the icon one. The designs have both — icons on
 * Main, ContactList and ReviewQueue, words on Calendar and ContactDetail —
 * and the first outside test of the app could not tell the rail's icons
 * apart, so four more unlabelled pills would have been the same mistake
 * twice. The measurements are ContactDetail's: 4px of padding round the pill,
 * 6px by 15px per word, 12.5px type, the active one on #f1f1ef.
 *
 * Differences from the design, on purpose:
 *   - An inactive word is ink-soft (#6f7177), not the design's #9c9ea4, which
 *     is about 2.6:1 against white at 12.5px and hard to read.
 *   - Hidden below md. Centred absolutely, it would sit under Sign out on a
 *     narrow window, and on a phone the bottom bar is the switcher.
 */
function PageSwitcher({ active, pages }: { active: ActivePage; pages: VisiblePages }) {
  return (
    <nav
      aria-label="Switch page"
      className="absolute left-1/2 hidden -translate-x-1/2 gap-0.5 rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(20,20,25,.05),0_4px_12px_rgba(20,20,25,.06)] md:flex"
    >
      {pages.map((page) => {
        const current = active === page.key;
        return (
          <Link
            key={page.key}
            href={page.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-full px-[15px] py-1.5 text-[12.5px] transition-colors ${
              current ? "bg-chip font-semibold text-ink" : "font-medium text-ink-soft hover:text-ink"
            }`}
          >
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The navigation on a phone (slice 9b, Part 1). Below the sm breakpoint the
 * rail is hidden, and until now nothing replaced it: no hamburger, no bar,
 * zero ways to reach another page. The first outside test of the app found it
 * in a minute.
 *
 * Fixed to the bottom rather than in the page flow, so it is there without
 * scrolling. Words under the icons, because the same test could not tell the
 * icons apart even on desktop, where they at least had tooltips. Each entry is
 * the full height of the bar, so the target is well over the 44px a thumb
 * needs.
 *
 * Profile is on it, which the rail keeps separate at the bottom: Sign out,
 * Disconnect Gmail and the privacy page all live behind it, and on a phone
 * there would otherwise be no way in at all.
 */
function BottomBar({
  active,
  pages,
  seenOnceCount,
  userEmail,
}: {
  active: ActivePage;
  pages: VisiblePages;
  seenOnceCount: number;
  userEmail: string | undefined;
}) {
  return (
    <nav
      aria-label="Pages"
      // The safe-area padding keeps the labels clear of the home indicator on
      // an iPhone. Written without the bracket syntax on purpose: Tailwind
      // scans comments too, and a class candidate in one broke the build.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_2px_rgba(20,20,25,.04)] sm:hidden"
    >
      {pages.map((page) => (
        <BottomItem
          key={page.key}
          href={page.href}
          label={page.label}
          active={active === page.key}
          dot={page.key === "seen-once" && seenOnceCount > 0}
        >
          {ICONS[page.key]}
        </BottomItem>
      ))}
      {userEmail && (
        <BottomItem href="/profile" label="You" active={active === "profile"}>
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
        </BottomItem>
      )}
    </nav>
  );
}

function BottomItem({
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
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
        active ? "text-ink" : "text-ink-soft"
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute top-0 h-[2.5px] w-6 rounded-full bg-accent"
        />
      )}
      <span className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-[19px]"
        >
          {children}
        </svg>
        {dot && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-accent-soft"
          />
        )}
      </span>
      <span className={`text-[10px] ${active ? "font-bold" : "font-semibold"}`}>{label}</span>
    </Link>
  );
}

function NavItem({
  href,
  label,
  title,
  active,
  dot = false,
  children,
}: {
  href: string;
  label: string;
  title: string;
  active: boolean;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex size-9 items-center justify-center rounded-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep ${
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
      <span className="sr-only">{label === title ? label : `${label} — ${title}`}</span>
      <HoverLabel>{title}</HoverLabel>
    </Link>
  );
}

/**
 * The word for a rail icon, shown beside it on hover or keyboard focus (slice
 * 9b, Part 1). It replaces the `title` attribute, which the browser shows
 * after a second-long wait and which the first outside test said was not
 * enough to tell the icons apart.
 *
 * It floats over the page instead of widening the rail: the design's rail is
 * 56px, and a rail that grew on hover would shove every list sideways.
 */
function HoverLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full z-40 ml-2 hidden whitespace-nowrap rounded-[9px] bg-ink-deep px-2.5 py-1.5 text-[12px] font-semibold text-white opacity-0 shadow-[0_4px_12px_rgba(20,20,25,.18)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block"
    >
      {children}
    </span>
  );
}
