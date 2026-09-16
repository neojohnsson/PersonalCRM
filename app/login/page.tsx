import { APP_NAME } from "@/lib/app-config";
import { SignInButton } from "./sign-in-button";

export const metadata = { title: `Sign in · ${APP_NAME}` };

/**
 * The sign-in page, built from design/Login.dc.html — and, when a sign-in
 * went wrong, design/LoginError.dc.html: the same page with a message above
 * the card.
 *
 * Differences from the design, on purpose:
 *   - The subtitle doesn't say the app "tells you whose turn it is to write":
 *     that's slice 3. It says what the app does today.
 *   - "Read the full privacy page" is left out until the page exists (slice 7).
 */

/**
 * The error codes app/auth/callback/route.ts redirects here with.
 *
 * The page only ever shows these fixed messages, never the raw `?error=` text.
 * Anyone can craft a link to /login?error=anything, so rendering the query
 * string would let a stranger put their own words on your sign-in page.
 */
const ERROR_MESSAGES: Record<string, string> = {
  missing_code:
    "Google didn't send a sign-in code back. Try again from the button below.",
  code_exchange:
    "That sign-in link expired or was already used. Sign in again.",
};

const FALLBACK_ERROR = "Something went wrong signing in. Try again.";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorMessage =
    typeof error === "string"
      ? (ERROR_MESSAGES[error] ?? FALLBACK_ERROR)
      : null;

  return (
    <main className="flex flex-1 items-center justify-center bg-paper px-4 py-14 text-ink">
      <div className="flex w-full max-w-[460px] flex-col gap-[26px]">
        <div className="flex flex-col gap-[18px]">
          <div
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-xl bg-ink-deep"
          >
            <span className="text-[18px] font-extrabold tracking-[-0.03em] text-white">
              {APP_NAME.charAt(0)}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.035em] sm:text-[33px]">
              Who&rsquo;s waiting on you?
            </h1>
            <p className="text-[15.5px] leading-[1.55] text-ink-soft">
              {APP_NAME} finds the people you actually talk to in Gmail, and
              keeps them in one list — most recent first.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-[14px] bg-accent-tint px-[18px] py-[15px]"
          >
            <Icon name="alert" className="mt-0.5 size-[17px] shrink-0 text-accent" />
            <p className="text-[13.5px] leading-[1.55] text-[#7c3a12]">{errorMessage}</p>
          </div>
        )}

        <div className="flex flex-col gap-[22px] rounded-[18px] bg-white px-6 py-[26px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] sm:px-[30px]">
          <SignInButton />

          <div aria-hidden="true" className="h-px bg-line" />

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-bold tracking-[0.09em] text-ink-faint uppercase">
              What signing in does
            </h2>
            <ul className="flex flex-col gap-[9px]">
              <li className="flex items-start gap-[11px]">
                <Icon name="check" className="mt-0.5 size-[17px] shrink-0 text-info" />
                <p className="text-[14.5px] leading-[1.5]">
                  Tells the app who you are — your name and email address
                </p>
              </li>
              <li className="flex items-start gap-[11px]">
                <Icon name="cross" className="mt-0.5 size-[17px] shrink-0 text-ink-faint" />
                <p className="text-[14.5px] leading-[1.5]">
                  It does <span className="font-semibold">not</span> open Gmail.
                  That&rsquo;s the next screen, and you read what it means before
                  you agree.
                </p>
              </li>
            </ul>
          </section>
        </div>

        <p className="px-1 text-[13px] leading-[1.55] text-ink-quiet">
          Invite only for now. Google keeps the app in testing mode, so your
          Google account has to be added as a tester first.
        </p>
      </div>
    </main>
  );
}

const ICON_PATHS = {
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.2 2.6 2.6 5-5.4" />
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
};

function Icon({ name, className }: { name: keyof typeof ICON_PATHS; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
