import Link from "next/link";
import { LegalPage, Operator, Part, Points } from "@/app/legal-page";
import { APP_NAME } from "@/lib/app-config";
import { SUB_PROCESSORS } from "@/lib/legal/sub-processors";
import { HOLDING_DESCRIPTIONS } from "@/lib/privacy/holdings";

export const metadata = { title: `Privacy policy · ${APP_NAME}` };

/**
 * The public privacy policy (slice 13, commit 6; docs/slice-13-plan.md §5),
 * written from docs/privacy.md. A draft, shown as one (app/legal-page.tsx).
 *
 * What is stored is not written out here a second time: it is the list the
 * Your data page counts (lib/privacy/holdings.ts), so the policy and the app
 * describe each table in the same words. Where it goes is lib/legal/
 * sub-processors.ts, checked against the code by tests/legal.test.ts.
 *
 * Written to be read by the people in someone's contacts as well as by the
 * person using the app (plan.md §5.2): most of the data is about them.
 */
export default function PrivacyPolicyPage() {
  const about = (group: "you" | "people") => HOLDING_DESCRIPTIONS.filter((holding) => holding.group === group);
  return (
    <LegalPage
      title="Privacy policy"
      lead={`What ${APP_NAME} stores, about whom, where it goes and for how long, and how to see it, take it with you or delete it.`}
    >
      <Part title="Who is responsible">
        <p>There are two kinds of information here, with two different people responsible:</p>
        <Points>
          <li>
            <strong>About you</strong>, the person using the app: your account, your settings, your plan. The service
            is responsible for this: <Operator />
          </li>
          <li>
            <strong>About the people in your contacts.</strong> You decide who is stored and what is written about
            them, so you are responsible for that, and the service handles it only on your instructions, as your{" "}
            <em>processor</em>. If you are in someone&rsquo;s contacts and want to know what is held about you, ask
            them: the app gives them a one-click export of exactly that.
          </li>
        </Points>
      </Part>

      <Part title="What is never stored">
        <Points>
          <li>
            The text of your emails. It is read from Gmail when a summary, a draft or a promise scan needs it, and gone
            when that request ends.
          </li>
          <li>Attachments, and anything from newsletters, no-reply senders or calendar invitations.</li>
          <li>The titles and descriptions of your calendar events.</li>
          <li>Your card. You type it on Stripe&rsquo;s page, never on ours.</li>
          <li>Your conversations with the Assistant.</li>
        </Points>
      </Part>

      <Part title="What is stored about the people in your contacts">
        <Stored holdings={about("people")} />
      </Part>

      <Part title="What is stored about you">
        <Stored holdings={about("you")} />
      </Part>

      <Part title="Where it goes">
        <p>
          The database is in the EU (Ireland). Some of the services the app uses are in the United States, which is a
          transfer outside the EU, made under the safeguards those companies offer. The full list, with what each one
          gets:
        </p>
        <Points>
          {SUB_PROCESSORS.map((each) => (
            <li key={each.name}>
              <strong>{each.name}</strong>: {each.role.toLowerCase()}. {each.where}.
            </li>
          ))}
        </Points>
        <p>
          <Link href="/sub-processors" className="font-semibold link-inline">
            Sub-processors, in full
          </Link>
        </p>
      </Part>

      <Part title="The AI">
        <p>
          Nothing is sent to the AI until you press for it, on one contact at a time. It then gets only what that one
          request needs. OpenAI does not train its models on it, and keeps it for at most 30 days to watch for abuse.
          It is told to leave out health, family matters, religion, politics, union membership, sexuality, ethnicity
          and money troubles, and to write as if the person will read it. It will sometimes fail, which is why
          everything it writes is dated, editable, and waits for you.
        </p>
      </Part>

      <Part title="How long">
        <Points>
          <li>Until you delete it. There is no expiry date that nothing enforces.</li>
          <li>
            When you remove someone from your contacts, their details and mail go. Their address is kept on a short
            list, so a later sync does not add them again.
          </li>
          <li>
            Deleting your account removes every row the app holds about you and your contacts. Before it does, it
            withdraws the Gmail and Calendar permissions at Google and ends a paid plan, and if any of those is not
            confirmed, it deletes nothing.
          </li>
          <li>
            Payments: Link, as the seller, keeps its own records of what you paid for as long as the law requires it
            to.
          </li>
        </Points>
      </Part>

      <Part title="Cookies">
        <p>
          One, to keep you signed in. Your choice of colour theme is kept in your browser. There is no analytics, no
          advertising and no tracking of any kind, and the app never checks whether an email was opened. Stripe&rsquo;s
          payment page sets its own cookies, under its own policy.
        </p>
      </Part>

      <Part title="Your rights">
        <p>
          You can see everything held, correct it, take it with you, have it deleted, or object to how it is used. Most
          of that you can do yourself, straight away, on{" "}
          <Link href="/privacy" className="font-semibold link-inline">
            Your data
          </Link>
          : a full export as a file, a contact list for a spreadsheet, and real deletion of one person, all contacts, or
          everything. For anything else, write to the address above. You can also complain to the Swedish Authority for
          Privacy Protection (IMY, imy.se).
        </p>
      </Part>
    </LegalPage>
  );
}

function Stored({ holdings }: { holdings: readonly { table: string; label: string; what: string }[] }) {
  return (
    <dl className="flex flex-col">
      {holdings.map((holding) => (
        <div key={holding.table} className="flex flex-col gap-0.5 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
          <dt className="text-[13.5px] font-semibold">{holding.label}</dt>
          <dd className="text-[13.5px] leading-[1.55] text-ink-body">{holding.what}</dd>
        </div>
      ))}
    </dl>
  );
}
