# Data processing agreement — draft

_Slice 13, commit 6 (`docs/slice-13-plan.md` §5). **A draft written by an AI, not legal
advice.** It says what the app really does today; before the first paying user, a person
who knows Swedish and EU law reads it, and the gaps in [brackets] are filled in._

Between **you**, the person using Contact Hub (the *controller*), and **[the business that
runs Contact Hub, organisation number, address]** (the *processor*).

## 1. Why this exists

The contacts you keep in Contact Hub are other people, who never signed up for it. Under
the GDPR (Article 28), you decide why and how their information is used, so you are its
controller. Contact Hub stores and handles it only to give you the service, so it is your
processor, and this agreement is the contract Article 28 requires between the two.

## 2. What is processed

| | |
|---|---|
| **Whose data** | The people in your contacts, and people who wrote to you or whom you wrote to |
| **What** | Names, email addresses, company, role and phone you enter or that come from mail headers; who wrote to whom and when, and subject lines; meetings with them (the date only); what you write about them; summaries, promises and web facts the AI wrote and you kept |
| **Never** | The text of emails, attachments, calendar titles and descriptions — read when needed and not stored (`docs/privacy.md`) |
| **What for** | Only to show you who is waiting on you, when to get in touch, and to write the drafts, summaries and answers you ask for |
| **How long** | Until you delete it: one contact, all contacts, or your account (`/privacy`) |

## 3. What the processor promises

1. **Only on your instructions.** Your instructions are your use of the app: what you add,
   press and delete. Nothing is done with the data for any other purpose — no selling, no
   advertising, no training AI models, no profiling beyond what you see on your screen.
2. **Confidentiality.** Only the people who run the service can reach the data, and only to
   keep it running or when you ask for help.
3. **Security** (Article 32). Each person's data is separated by row-level security in the
   database, tested with two users for every table. Google tokens are encrypted. There is no
   way to send mail. Details: `docs/architecture.md`.
4. **Sub-processors.** Only those listed on `/sub-processors` (`lib/legal/sub-processors.ts`).
   A new one is added to that page, with 30 days' notice, before it receives anything, and
   you can leave before then.
5. **Your obligations to the people in your contacts.** The app helps you meet them:
   a one-click export of everything held about one person, correction by editing, and real
   deletion (`docs/privacy.md`, "What to do when someone asks").
6. **Breaches.** If data is exposed, you are told without undue delay, and at the latest
   within 48 hours of it being discovered, with what is known.
7. **At the end.** Deleting your account deletes the data: every row, tested
   (`tests/privacy-delete.test.ts`). Nothing is kept afterwards, except what Link, as the
   seller of the paid plans, must keep about payments.
8. **Checks.** You can ask how the data is handled, and get a written answer.

## 4. Transfers outside the EU

The database is in Ireland. OpenAI, Vercel and Google may process data in the United
States, under the safeguards they offer (the EU–US Data Privacy Framework or the European
Commission's standard contractual clauses). **[Confirm each one's current basis before
launch, and sign each one's data processing agreement: OpenAI, Supabase, Vercel, Stripe.]**

## 5. Before this is signed with anyone

- [ ] The business exists, and its details replace the brackets above.
- [ ] Each sub-processor's own DPA is signed, and its transfer basis confirmed.
- [ ] Vercel's functions are moved to Dublin (`dub1`), next to the database, so requests stay in the EU.
- [ ] A person who knows Swedish and EU law has read this, the terms and the privacy policy.
