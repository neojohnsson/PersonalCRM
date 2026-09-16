import { describe, expect, it } from "vitest";
import { filterReason, isAutomatedAddress } from "@/lib/google/filter";

function incoming(from_email: string, has_list_unsubscribe = false) {
  return { direction: "inbound" as const, from_email, has_list_unsubscribe };
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
        { direction: "outbound", from_email: "neo@gmail.com", has_list_unsubscribe: true },
        dismissed,
      ),
    ).toBeNull();
  });
});
