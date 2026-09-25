import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/app/app-shell";
import { CARD } from "@/app/page-parts";
import { SignOutButton } from "@/app/sign-out-button";
import { APP_NAME } from "@/lib/app-config";
import { ACTIVITY_LIMIT, recentActions } from "@/lib/assistant/activity";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { requireUser } from "@/lib/auth";
import { dayMonth, timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { DoneMark } from "../done-mark";
import { UndoButton } from "../undo-button";

export const metadata = { title: `What the Assistant did · ${APP_NAME}` };

/**
 * Everything the Assistant did on its own, newest first, each with Undo
 * (slice 11; docs/slice-11-plan.md §3). The strip on /assistant links here
 * as "Everything it did".
 *
 * This is the answer to "what did it just do?" that does not depend on the
 * conversation, which is never kept: every note, tag, next touch, finished
 * conversation and reminder switch it made is a row in assistant_actions,
 * written at the moment it happened, with what was there before.
 *
 * No design has this page. It reuses Dismissed's (app/seen-once/dismissed),
 * the nearest list with an Undo on each row: the same back link and title
 * block, and rows in one white card — with the strip's green tick and its
 * ghost Undo from the approved Assistant design.
 */
export default async function AssistantActivityPage() {
  const user = await requireUser();
  const supabase = await createClient();
  // The same gate as /assistant: without it, this address does not exist.
  if (!(await hasAssistant(supabase, user.id))) redirect("/");

  const now = new Date();
  const actions = await recentActions(supabase, user.id);

  return (
    <AppShell userEmail={user.email} active="assistant" headerRight={<SignOutButton />}>
      <main className="flex flex-1 flex-col gap-4 px-4 pt-2.5 pb-7 sm:px-[30px]">
        <div className="flex flex-col gap-2">
          <Link href="/assistant" className="text-sm font-normal text-ink-soft hover:text-ink">
            ← Assistant
          </Link>
          <h1 className="text-xl font-bold tracking-[-0.035em]">Everything it did</h1>
          <p className="max-w-[640px] text-sm text-ink-soft">
            What the Assistant did on its own, newest first. Undo puts back exactly what was there
            before — unless you&rsquo;ve changed the same thing yourself since, and then it says so
            and leaves yours alone. Drafts and events aren&rsquo;t here: those only ever happen when
            you press.
          </p>
        </div>

        {actions.length > 0 ? (
          <div className={`${CARD} overflow-hidden`}>
            <ul>
              {actions.map((action) => (
                <li
                  key={action.id}
                  className="flex flex-wrap items-center gap-x-[14px] gap-y-2 border-t border-line-soft px-[22px] py-[13px] first:border-t-0"
                >
                  <DoneMark undone={action.undoneAt !== null} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={`text-sm tracking-[-0.01em] ${action.undoneAt ? "text-ink-soft line-through" : "font-normal"}`}
                    >
                      {action.summary}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {dayMonth(action.createdAt)}, {timeAgo(action.createdAt, now)}
                      {action.undoneAt && ` · undone ${timeAgo(action.undoneAt, now)}`}
                      {" · "}
                      <Link href={`/contacts/${action.contactId}`} className="font-semibold text-ink-body hover:text-ink">
                        Open the contact
                      </Link>
                    </span>
                  </div>
                  {action.undoneAt ? (
                    <span className="shrink-0 text-xs font-semibold text-ink-soft">Undone</span>
                  ) : (
                    <UndoButton actionId={action.id} label={action.summary} />
                  )}
                </li>
              ))}
            </ul>
            {actions.length === ACTIVITY_LIMIT && (
              <p className="border-t border-line-soft px-[22px] py-3 text-xs text-ink-soft">
                The latest {ACTIVITY_LIMIT}. Older ones are still kept, and in your export on Privacy.
              </p>
            )}
          </div>
        ) : (
          <section className={`${CARD} flex max-w-xl flex-col px-[22px] py-6 sm:px-8`}>
            <h2 className="text-base font-bold tracking-[-0.015em]">Nothing yet</h2>
            <p className="mt-2 text-sm text-ink-soft">
              When you ask the Assistant to add a note, change tags, move a next touch, mark a
              conversation done or turn reminders off, it shows up here with Undo.
            </p>
          </section>
        )}
      </main>
    </AppShell>
  );
}
