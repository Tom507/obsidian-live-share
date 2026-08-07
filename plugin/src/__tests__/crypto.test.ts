import { describe, expect, it } from "vitest";
import { E2ECrypto, generateSaltB64 } from "../sync/crypto";

describe("E2ECrypto", () => {
  it("is not enabled before init()", () => {
    const e2e = new E2ECrypto("test-passphrase");
    expect(e2e.enabled).toBe(false);
  });

  it("is enabled after init()", async () => {
    const e2e = new E2ECrypto("test-passphrase");
    await e2e.init();
    expect(e2e.enabled).toBe(true);
  });

  it("encrypts and decrypts a Uint8Array round-trip", async () => {
    const e2e = new E2ECrypto("round-trip-test");
    await e2e.init();

    const plaintext = new TextEncoder().encode("Hello, Live Share!");
    const encrypted = await e2e.encrypt(plaintext);

    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.byteLength).toBeGreaterThan(plaintext.byteLength);

    const decrypted = await e2e.decrypt(encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it("encrypts and decrypts a string round-trip", async () => {
    const e2e = new E2ECrypto("string-round-trip");
    await e2e.init();

    const original = "# My Secret Note\n\nThis is private content.";
    const encrypted = await e2e.encryptString(original);

    expect(encrypted).not.toBe(original);
    expect(typeof encrypted).toBe("string");

    const decrypted = await e2e.decryptString(encrypted);
    expect(decrypted).toBe(original);
  });

  it("two instances with the same passphrase can decrypt each other's data", async () => {
    const alice = new E2ECrypto("shared-secret");
    const bob = new E2ECrypto("shared-secret");
    await alice.init();
    await bob.init();

    const message = "Message from Alice to Bob";
    const encrypted = await alice.encryptString(message);
    const decrypted = await bob.decryptString(encrypted);
    expect(decrypted).toBe(message);
  });

  it("different passphrases cannot decrypt each other's data", async () => {
    const alice = new E2ECrypto("passphrase-a");
    const eve = new E2ECrypto("passphrase-b");
    await alice.init();
    await eve.init();

    const encrypted = await alice.encryptString("secret");
    await expect(eve.decryptString(encrypted)).rejects.toThrow();
  });

  it("throws if encrypt is called before init", async () => {
    const e2e = new E2ECrypto("not-initialized");
    const data = new TextEncoder().encode("test");
    await expect(e2e.encrypt(data)).rejects.toThrow("E2E not initialised");
  });

  it("throws if decrypt is called before init", async () => {
    const e2e = new E2ECrypto("not-initialized");
    const data = new Uint8Array(32);
    await expect(e2e.decrypt(data)).rejects.toThrow("E2E not initialised");
  });

  it("handles empty string encryption", async () => {
    const e2e = new E2ECrypto("empty-test");
    await e2e.init();

    const encrypted = await e2e.encryptString("");
    const decrypted = await e2e.decryptString(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode content", async () => {
    const e2e = new E2ECrypto("unicode-test");
    await e2e.init();

    const unicode = "Hello \u{1F30D} \u00E9\u00E8\u00EA \u4F60\u597D \u{1F600}";
    const encrypted = await e2e.encryptString(unicode);
    const decrypted = await e2e.decryptString(encrypted);
    expect(decrypted).toBe(unicode);
  });

  it("generateSaltB64 returns a fresh random salt each call", () => {
    const a = generateSaltB64();
    const b = generateSaltB64();
    expect(a).not.toBe(b);
    // 16 random bytes base64-encode to a non-trivial string
    expect(a.length).toBeGreaterThan(16);
  });

  it("peers sharing passphrase + salt (from the invite) can decrypt each other", async () => {
    const salt = generateSaltB64();
    const host = new E2ECrypto("shared-secret", salt);
    const guest = new E2ECrypto("shared-secret", salt);
    await host.init();
    await guest.init();

    const encrypted = await host.encryptString("via random salt");
    expect(await guest.decryptString(encrypted)).toBe("via random salt");
  });

  it("same passphrase but different random salts derive different keys", async () => {
    const host = new E2ECrypto("shared-secret", generateSaltB64());
    const other = new E2ECrypto("shared-secret", generateSaltB64());
    await host.init();
    await other.init();

    const encrypted = await host.encryptString("secret");
    // Different salt => different AES key => cannot decrypt.
    await expect(other.decryptString(encrypted)).rejects.toThrow();
  });

  it("legacy invites without a salt still round-trip (deterministic fallback)", async () => {
    const alice = new E2ECrypto("legacy-secret");
    const bob = new E2ECrypto("legacy-secret");
    await alice.init();
    await bob.init();

    const encrypted = await alice.encryptString("legacy path");
    expect(await bob.decryptString(encrypted)).toBe("legacy path");
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const e2e = new E2ECrypto("iv-test");
    await e2e.init();

    const plaintext = "same message";
    const enc1 = await e2e.encryptString(plaintext);
    const enc2 = await e2e.encryptString(plaintext);

    expect(enc1).not.toBe(enc2);

    expect(await e2e.decryptString(enc1)).toBe(plaintext);
    expect(await e2e.decryptString(enc2)).toBe(plaintext);
  });
});
