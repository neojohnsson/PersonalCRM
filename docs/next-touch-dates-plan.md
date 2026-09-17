# Next-touch dates when the emails give none

_Plan, 2026-09-17. Rules agreed with the user before any code. `plan.md` §3.4._

**Goal:** the summary's next-touch suggestion comes with a date even when the emails
don't state one. The AI names the **kind of timing** and why; **code** turns that into
a date, so the same situation always gets the same date. The date lands in the Next
touch form as before — you change it, or don't save it.

**Done when** a test proves it:

- [ ] Each rule gives its date, including weekends moved to Monday and nothing before today
- [ ] A stated date that isn't real, a month in the past, or a timing kind the app
      doesn't know gives no date — never a made-up one
- [ ] The suggestion's "why" and "rough guess" are saved and shown next to the date
- [ ] On the preview: a summary like Martin's suggests "Contact Niklas Hedlund" with a date

## The rules

| Kind of timing (AI picks) | Example | Date (code) |
|---|---|---|
| `stated_date` | "Get back to me after the 20th" | The date the AI read from the email |
| `reply_owed` | They asked you something | Next working day |
| `referral` | "Talk to Niklas Hedlund" | 3 working days from today |
| `waiting_on_them` | You asked, no answer yet | 7 days after your last email; next working day if that's past |
| `they_will_get_back` | "I'll come back to you" | 14 days after their last email; next working day if that's past |
| `later_event` | "When your internship approaches" | First working day of the month the email names; otherwise 1 month from today, marked **rough guess** |
| `nothing_open` | Conversation finished | No next touch |

For every date: Saturday and Sunday move to Monday; never before today; at most five
years ahead. The AI's one-sentence **why** is shown next to it.

## Commit order

1. This plan
2. Migration `0012`: `suggested_touch_why` and `suggested_touch_rough` on `contact_summaries`
3. `lib/relationship/touch-date.ts`: the rules, with tests
4. The model picks the kind and why; the summary saves the date, why and rough flag
5. The suggestion shows the date and why; preview check, PR

## Later

Checking a referral against your own mail ("have you written to Niklas?") — slice 6.
Avoiding busy days using Google Calendar — no slice yet.
