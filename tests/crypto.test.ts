import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "1//04abcdefghijklmnopqrstuvwxyz";
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it("produces different ciphertext each time", () => {
    // A fresh IV per call, so the same token never looks the same twice.
    expect(encrypt("same-token")).not.toBe(encrypt("same-token"));
  });

  it("refuses tampered ciphertext", () => {
    const payload = encrypt("a-real-token");
    const [v, iv, tag, ct] = payload.split(".");
    const tampered = [v, iv, tag, Buffer.from("evil").toString("base64")].join(".");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("refuses a malformed payload", () => {
    expect(() => decrypt("not-a-payload")).toThrow(/Malformed/);
  });
});
