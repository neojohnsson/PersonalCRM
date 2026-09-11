import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for Gmail refresh tokens.
 *
 * A refresh token is a long-lived key to someone's mailbox. If the database
 * leaks, plaintext tokens mean the mailboxes leak with it — so the token is
 * encrypted with a key that lives only in the environment, never in Postgres.
 *
 * AES-256-GCM is authenticated: decryption fails loudly if the ciphertext was
 * tampered with, rather than quietly returning garbage.
 *
 * Server-only. Importing this into a Client Component would ship the key
 * material path into the browser bundle.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32; // 256 bits

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. It should be 32 random bytes, base64-encoded.`,
    );
  }

  return key;
}

/**
 * Returns `v1.<iv>.<authTag>.<ciphertext>`, all base64.
 *
 * The version prefix is there so a future key rotation can tell old records
 * from new ones instead of guessing.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, authTag, ciphertext] = payload.split(".");

  if (version !== "v1" || !iv || !authTag || !ciphertext) {
    throw new Error("Malformed encrypted payload.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
