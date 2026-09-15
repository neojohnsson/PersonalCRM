import { signOut } from "@/app/auth/actions";

/**
 * A plain form, not a "use client" component: the button submits a POST to
 * the signOut Server Action. Nothing runs in the browser.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}
