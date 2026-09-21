import { describe, expect, it } from "vitest";
import {
  filterReason,
  isAutoReplyHeaders,
  isAutoReplySubject,
  isAutomatedAddress,
} from "@/lib/google/filter";

function incoming(from_email: string, has_list_unsubscribe = false, subject: string | null = "Hej") {
  return { direction: "inbound" as const, from_email, has_list_unsubscribe, subject };
}

describe("isAutomatedAddress", () => {
  it("catches the addresses only machines use", () => {
    for (const address of [
      "noreply@github.com",
      "no-reply@accounts.google.com",
      "no_reply@example.se",
      "NoReply@Example.se",
      "no-reply-aws@amazon.com",
      "donotreply@bank.se",
      "do-not-reply@example.se",
      "mailer-daemon@googlemail.com",
      "postmaster@example.se",
      "bounce@mail.example.se",
      "bounces+12345@example.se",
      "notifications@github.com",
      "notification.center@example.se",
    ]) {
      expect(isAutomatedAddress(address), address).toBe(true);
    }
  });

  it("leaves addresses a real person might answer alone", () => {
    for (const address of [
      "karin.lindqvist@fortnox.se",
      "info@smallfirm.se",
      "hello@startup.se",
      "support@example.se",
      "contact@example.se",
      "notificationsteam@example.se",
      "replyall@example.se",
      "anna.noreply@example.se",
    ]) {
      expect(isAutomatedAddress(address), address).toBe(false);
    }
  });
});

describe("filterReason", () => {
  it("keeps mail from a real person", () => {
    expect(filterReason(incoming("karin@fortnox.se"))).toBeNull();
  });

  it("skips automated addresses", () => {
    expect(filterReason(incoming("noreply@github.com"))).toBe("automated-address");
  });

  it("skips newsletters and bulk mail by their List-Unsubscribe header", () => {
    expect(filterReason(incoming("news@example.se", true))).toBe("list-unsubscribe");
  });

  it("skips calendar invites by their sender", () => {
    expect(filterReason(incoming("calendar-notification@google.com"))).toBe("calendar");
  });

  it("skips someone the user dismissed, whatever case their address is in", () => {
    const dismissed = new Set(["mikael@knightec.se"]);
    expect(filterReason(incoming("Mikael@Knightec.se"), dismissed)).toBe("dismissed");
  });

  it("never skips mail the user sent — not even to a newsletter or a dismissed address", () => {
    const dismissed = new Set(["neo@gmail.com"]);
    expect(
      filterReason(
        {
          direction: "outbound",
          from_email: "neo@gmail.com",
          has_list_unsubscribe: true,
          subject: "Newsletter",
        },
        dismissed,
      ),
    ).toBeNull();
  });
});

/**
 * Slice 9a: an out-of-office is not a person writing to you.
 *
 * Two "Autosvar:" replies from real municipal addresses had become contacts,
 * taken Your turn, and scored warmth above real people. The address rules
 * cannot catch these: the sender is a person's address and their mailbox really
 * did send it.
 */
describe("auto-replies", () => {
  it("catches the subject a machine writes, in both languages", () => {
    for (const subject of [
      "Autosvar: Förfrågan om kort intervju",
      "autosvar: semester",
      "Automatiskt svar: Tack för ditt mail",
      "Automatiskt genererat svar",
      "Frånvaro",
      "Frånvarosmeddelande: tillbaka den 29:e",
      "Ej på kontoret",
      "Out of office",
      "Out of Office: back Monday",
      "Automatic reply: I am away",
      "Auto: your message has been received",
      "Autoreply",
      "  Autosvar: leading spaces",
      "Re: Autosvar: threaded onto one",
    ]) {
      expect(isAutoReplySubject(subject), subject).toBe(true);
    }
  });

  it("leaves a real person writing about auto-replies alone", () => {
    for (const subject of [
      // The trap the Swedish negation list fell into: a prefix is not a word.
      "Automatiseringsprojektet",
      "Automatisering av svar i vår portal",
      "Re: Autosvar hantering i Outlook",
      "Frånvarorapport för augusti",
      "Frågor om examensarbete",
      "Kan du skicka autosvar-inställningarna?",
      null,
      "",
    ]) {
      expect(isAutoReplySubject(subject), String(subject)).toBe(false);
    }
  });

  it("reads the headers a mail server sets", () => {
    const header = (name: string, value: string) => [{ name, value }];

    expect(isAutoReplyHeaders(header("Auto-Submitted", "auto-replied"))).toBe(true);
    expect(isAutoReplyHeaders(header("auto-submitted", "AUTO-GENERATED"))).toBe(true);
    expect(isAutoReplyHeaders(header("Precedence", "auto_reply"))).toBe(true);
    expect(isAutoReplyHeaders(header("Precedence", "bulk"))).toBe(true);
    expect(isAutoReplyHeaders(header("X-Autoreply", "yes"))).toBe(true);
    expect(isAutoReplyHeaders(header("X-Autorespond", "anything"))).toBe(true);

    // "no" is what a normal message says, and a missing header says nothing.
    expect(isAutoReplyHeaders(header("Auto-Submitted", "no"))).toBe(false);
    expect(isAutoReplyHeaders(header("Precedence", "list"))).toBe(false);
    expect(isAutoReplyHeaders([])).toBe(false);
    expect(isAutoReplyHeaders(undefined)).toBe(false);
  });

  it("is not stored, so it cannot flip the turn or make a contact", () => {
    const autosvar = incoming("omsorgsnamnden@vaxjo.se", false, "Autosvar: Förfrågan");
    expect(filterReason(autosvar)).toBe("auto-reply");

    const byHeader = incoming("someone@vaxjo.se", false, "Re: Examensarbete");
    expect(filterReason(byHeader, new Set(), [{ name: "Auto-Submitted", value: "auto-replied" }])).toBe(
      "auto-reply",
    );

    // The same person writing for themselves is kept.
    expect(filterReason(incoming("omsorgsnamnden@vaxjo.se", false, "Re: Examensarbete"))).toBeNull();
  });

  it("never filters your own mail, whatever its subject says", () => {
    const yours = { direction: "outbound" as const, from_email: "me@example.se", has_list_unsubscribe: false, subject: "Autosvar: test" };
    expect(filterReason(yours)).toBeNull();
  });
});
