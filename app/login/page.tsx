import { APP_NAME } from "@/lib/app-config";
import { SignInButton } from "./sign-in-button";

export const metadata = { title: `Sign in · ${APP_NAME}` };

export default function LoginPage() {
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
