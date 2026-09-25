import Link from "next/link";
import { LegalPage, Operator, Part, Points } from "@/app/legal-page";
import { APP_NAME } from "@/lib/app-config";
import { PLANS, PRICE_SEK } from "@/lib/plans/plans";

export const metadata = { title: `Terms · ${APP_NAME}` };

/**
 * The terms of use (slice 13, commit 6; docs/slice-13-plan.md §5). A draft,
 * shown as one (app/legal-page.tsx). Plans and prices are read from
 * lib/plans/plans.ts, so the terms cannot name a price the app does not charge.
 *
 * The purchase itself is Link's (Stripe Managed Payments, lib/stripe/checkout.ts):
 * Link is the seller, and its terms govern the payment and the right of
 * withdrawal. These terms govern using the app.
 */
export default function TermsPage() {
  const free = PLANS.free.allowance!;
  return (
    <LegalPage
      title="Terms"
      lead={`The rules for using ${APP_NAME}: what it does, what it never does, the plans, and how to leave.`}
    >
      <Part title="Who runs it">
        <p>
          <Operator /> These terms are under Swedish law.
        </p>
      </Part>

      <Part title="What the service does">
        <p>
          {APP_NAME} reads the details of your Gmail (who wrote to whom, and when) to work out who you talk to, whose
          turn it is to write, and when to get in touch next. It can write a draft reply into your Gmail, create an
          event in your Google Calendar when you press Create, and, on the plans that include it, use AI to summarise
          a conversation or answer a question.
        </p>
        <p>What it never does, on any plan:</p>
        <Points>
          <li>It never sends an email. Drafts wait in your Gmail until you press send there.</li>
          <li>It never invites anybody to an event, because an invitation is an email.</li>
          <li>It never merges two contacts on its own, and never tracks whether your mail was opened.</li>
          <li>It never looks people up on LinkedIn, people-search sites or social media.</li>
          <li>
            A summary, a draft or a fact found on the web waits for your approval before it is kept. The Assistant may
            make a few small changes on its own (a note, tags, a date to get in touch, reminders, marking a
            conversation done), and each one is listed with an Undo.
          </li>
        </Points>
      </Part>

      <Part title="Your account">
        <p>
          You sign in with Google and connect Gmail yourself, and you can disconnect it whenever you like. While the
          app is in Google&rsquo;s testing mode, only invited people can use it, and Google asks you to connect again
          about once a week.
        </p>
        <p>
          The people in your contacts never signed up for anything. You decide who is stored and what is written about
          them, so you are responsible for that information, and we process it for you (see the{" "}
          <Link href="/privacy-policy" className="font-semibold underline underline-offset-2">
            privacy policy
          </Link>
          ). Keep what you write fair: assume the person could one day read it.
        </p>
      </Part>

      <Part title="Plans and paying">
        <Points>
          <li>
            <strong>Free</strong> costs nothing and includes everything but the AI, plus a small monthly allowance:{" "}
            {free.summary} summaries, {free.draft} drafts, {free.promises} promise scans and {free.assistant} questions
            to the Assistant. It comes back on the 1st of each month.
          </li>
          <li>
            <strong>Pro</strong> ({PRICE_SEK.pro} kr a month) and <strong>Premium</strong> ({PRICE_SEK.premium} kr a
            month, with web research) have no monthly count. Prices include VAT.
          </li>
          <li>
            The paid plans are sold by <strong>Link</strong>, Stripe&rsquo;s reseller. Link takes the payment, handles
            VAT and receipts, and its terms govern the purchase, including your right to withdraw from it under EU
            consumer law.
          </li>
          <li>
            A plan renews every month until you cancel. Cancel whenever you like with Manage or cancel on your profile:
            the plan runs to the end of the month you paid for, then becomes Free.
          </li>
          <li>Going back to Free deletes nothing. You keep every summary, note and contact.</li>
          <li>We will tell you at least 30 days before a price goes up, and you can cancel before it does.</li>
        </Points>
      </Part>

      <Part title="The AI can be wrong">
        <p>
          A summary, a draft or a found fact is a suggestion. It can misread a conversation or confuse two people with
          the same name. Read it before you approve it or send anything based on it. Each plan has a monthly limit on
          AI use, and the app stops before it, never after.
        </p>
      </Part>

      <Part title="Using it fairly">
        <Points>
          <li>Use it for your own contacts and your own mail, not to collect information about people for others.</li>
          <li>Don&rsquo;t try to get around the limits, the sign-in or other people&rsquo;s data.</li>
          <li>We may close an account that breaks these rules, and will say why.</li>
        </Points>
      </Part>

      <Part title="Leaving">
        <p>
          You can export everything and delete your account at any time, from{" "}
          <Link href="/privacy" className="font-semibold underline underline-offset-2">
            Your data
          </Link>
          . Deleting is real: the rows are removed, and the Gmail connection is withdrawn at Google. Cancel a paid plan
          first, so Link stops charging.
        </p>
      </Part>

      <Part title="If something goes wrong">
        <p>
          The service is built with care but offered as it is: it can be down, and a sync can miss something. We are
          not liable for losses from relying on it beyond what Swedish law requires, and nothing here limits your
          rights as a consumer.
        </p>
      </Part>
    </LegalPage>
  );
}
