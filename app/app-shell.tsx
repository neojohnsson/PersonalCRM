import { hasAssistant } from "@/lib/assistant/entitlement";
import { requireUser } from "@/lib/auth";
import { visiblePages, type ActivePage } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { ShellFrame } from "@/app/shell-frame";

/**
 * The frame around signed-in pages: who you are, and which pages you have,
 * then the frame itself (app/shell-frame.tsx, where the rail, header and
 * bottom bar and their design notes live). Split in two in the UI quality
 * pass (milestone 3): the loading skeletons draw the same frame straight
 * away, in the browser, and cannot import the sign-in check.
 */
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
    <ShellFrame pages={pages} active={active} seenOnceCount={seenOnceCount} userEmail={userEmail} headerRight={headerRight}>
      {children}
    </ShellFrame>
  );
}

