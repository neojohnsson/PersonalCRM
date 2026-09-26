import { APP_NAME } from "@/lib/app-config";
import { BrandTile, Callout, Divider, Item, Section } from "@/app/intro-screen";
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

/**
 * The first screen a new visitor sees.
 *
 * Built from design/Login.dc.html, and its error state from
 * LoginError.dc.html. Differences from the design, on purpose:
 *   - No "Read the full privacy page" link. That page arrives in slice 7
 *     (docs/plan.md §3.12), and a link to nothing on the very first screen
 *     would be a broken promise.
 *   - Below the sm breakpoint the heading is 28px instead of 33px, the same
 *     phone fit /connect uses.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorMessage =
    typeof error === "string"
      ? (ERROR_MESSAGES[error] ?? FALLBACK_ERROR)
      : null;

  return (
    <main className="flex flex-1 items-center justify-center bg-paper px-6 py-14 text-ink">
      <div className="flex w-full max-w-[460px] flex-col gap-[26px]">
        <div className="flex flex-col gap-[18px]">
          <BrandTile />
          <div className="flex flex-col gap-2.5">
            <h1 className="text-xl font-bold tracking-[-0.035em] sm:text-2xl">
              Who&rsquo;s waiting on you?
            </h1>
            <p className="text-base text-ink-soft">
              {APP_NAME} finds the people you actually talk to in Gmail, and
              tells you whose turn it is to write.
            </p>
          </div>
        </div>

        {errorMessage && (
          <Callout role="alert" icon="alert">
            {errorMessage}
          </Callout>
        )}

        <div className="flex flex-col gap-[22px] rounded-xl bg-white px-6 py-[26px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] sm:px-[30px]">
          <SignInButton />

          <Divider />

          <Section title="What signing in does">
            <Item icon="check" tone="info">
              Tells the app who you are — your name and email address
            </Item>
            <Item icon="cross" tone="muted">
              It does <span className="font-semibold">not</span> open Gmail.
              That&rsquo;s the next screen, and you read what it means before
              you agree.
            </Item>
          </Section>
        </div>

        <p className="px-1 text-sm text-ink-soft">
          Invite only for now. Google keeps the app in testing mode, so your
          Google account has to be added as a tester first.
        </p>
      </div>
    </main>
  );
}
