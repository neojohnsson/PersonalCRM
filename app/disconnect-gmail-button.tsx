import { disconnectGmail } from "@/app/connect/actions";

/**
 * Same shape as SignOutButton: a plain form that POSTs to a Server Action, so
 * nothing runs in the browser.
 *
 * The action does its own requireUser() check — this button being hidden from
 * signed-out visitors is not what protects it.
 */
export function DisconnectGmailButton() {
  return (
    <form action={disconnectGmail}>
      <button
        type="submit"
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
      >
        Disconnect Gmail
      </button>
    </form>
  );
}
