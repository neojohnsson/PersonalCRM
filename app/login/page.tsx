import { APP_NAME } from "@/lib/app-config";
import { SignInButton } from "./sign-in-button";

export const metadata = { title: `Sign in · ${APP_NAME}` };

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
    <main className="flex flex-1 items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-line bg-white p-8 shadow-[0_1px_2px_rgba(26,27,30,0.04)]">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            {APP_NAME}
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-ink-soft">
            Imports the people you actually talk to, and tells you who is
            waiting on you.
          </p>

          {errorMessage && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-accent/20 bg-accent-tint px-4 py-3 text-[13px] leading-5 text-ink"
            >
              {errorMessage}
            </p>
          )}

          <div className="mt-7">
            <SignInButton />
          </div>

          <p className="mt-5 text-[13px] leading-5 text-ink-faint">
            Signing in only identifies you. Gmail stays untouched until you
            connect it on the next screen, and you get a plain-English summary
            of what that means first.
          </p>
        </div>
      </div>
    </main>
  );
}
