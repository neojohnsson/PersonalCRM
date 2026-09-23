# Slice 11b — the Assistant everywhere

_Asked for 2026-09-23: "I want it to be able to do anything I want on the website."_

Slice 11 gave the Assistant five things it does on its own and cards for a draft, an event, a
summary, a promise scan and better names. This slice goes through **every other thing the site
can do**, one at a time, and decides for each: a card you press, a decision first, or never.

The rule for all of it is slice 11's: **the model never holds the power, the press does.** A new
card goes through the page's own Server Action — the one already tested — so every rule that
action keeps holds in the chat too. Nothing here changes the five things it may do on its own,
so AGENTS.md is not amended.

## 1. What it can do after this slice

| On the site | In the Assistant | Goes through | Undo |
|---|---|---|---|
| Edit a contact's company, role, phone, name | **Card**: each field before → after, Save | `save_contact`, as the edit form | Undo on the card puts the old values back |
| Add a contact | **Card**: name, address, company, Add | `saveContact(null, …)` | Opens the new contact; delete stays yours |
| Approve a waiting summary | **Card**: the summary as written, dated, each line linked to its message; Approve, Discard, Edit on their page | `approveSummaryAction`, `discardSummaryAction` | Approve: as on the page. Edit only on the page |
| Accept or dismiss a promise | **Card**: the queue's own rows, with the date you can change | `acceptPromise`, `dismissPromise` | Accepting makes a next touch, which it can move or clear |
| Seen once: add as contact, dismiss | **Card**: each person with Add and Dismiss, and for everyone | `addAsContacts`, `dismissPeople` | Dismissed ones come back from the Dismissed page |
| Sync Gmail now | **Card**: Sync now, with how long ago the last one was | the header's own sync button | — nothing to undo |
| Snooze or finish a next touch | **Already**: `set_next_touch`, `clear_next_touch` | — | Logged, Undo |

And the read tools the cards need: **`seen_once`** (who is in the queue, with how much mail),
**`waiting_summaries`** and **`waiting_promises`** (what is waiting, so it can offer the card).

## 2. Needs your decision first: merging duplicates

AGENTS.md: "No auto-merge of duplicate contacts. Suggest only; a human approves." A card with a
**Merge** button you press is a human approving — it would not break the rule. But:

- slice 11 told you, on the page, "The Assistant never merges or deletes", and
- a wrong merge is nearly impossible to undo (plan.md §3.7): two people's mail and notes become
  one, and pulling them apart is by hand.

So either a **merge card** (both contacts side by side, as on the Compare page, and Merge), and
the page's sentence changes to "never merges without you"; or it stays a link to Compare.

**Decided 2026-09-23: it stays a link.** The Assistant tells you about a pair and where to
compare it; merging happens on the Compare page, by hand. "The Assistant never merges or
deletes" stays true.

## 3. Never, whatever is asked

Sending mail · inviting guests · deleting a contact (Dismiss on a contact page deletes its mail
and notes for good) · deleting everything or the account · the export · profile settings ·
connecting or disconnecting Gmail or Calendar.

Not because a card could not do them: because each is either a hard rule, or a setting the
person should only ever change with their own hands, on the page that explains it. The tool
list test grows to name every one of these, so a tool that reaches them fails.

## 4. What could go wrong

- **A card that shows one thing and saves another.** Every card sends only ids and the values
  it shows; the action re-reads and re-checks, as each one already does.
- **A model that makes up a value** — a phone number, a company. The edit card shows before and
  after for exactly that reason, and nothing is saved until you press. The model is told to
  take values only from what the person said, never from mail.
- **Mail that orders an edit.** At worst a card appears; it does nothing until pressed. The
  instructions and the injection test from slice 11 cover the new tools too.

## Done when — a test proves it

- [ ] Each new card's tool writes nothing when proposed, against a real database
- [ ] Each card presses through the page's own action (a test names the import)
- [ ] The edit card cannot change a field it did not show, and Undo puts back exactly the old
      values
- [ ] Two users: no read tool shows the other's Seen once, summaries or promises, and no card
      offers them
- [ ] The tool list test fails for any tool that sends, deletes, merges, exports, or touches
      settings or connections
- [ ] Checked in the browser against the real model, at 1440px and 390px

## Commit order

1. This plan
2. Read tools: `seen_once`, `waiting_summaries`, `waiting_promises`
3. Contact edit and new contact cards
4. Summary approval card
5. Promise cards, in the chat
6. Seen once card
7. Sync card
8. Browser check at both widths, PR
