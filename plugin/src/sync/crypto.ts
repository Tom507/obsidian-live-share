import { arrayBufferToBase64, base64ToArrayBuffer } from "../utils";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 100_000;

function passphraseSaltInput(passphrase: string): string {
  return `obsidian-live-share-salt:${passphrase}`;
}

/**
 * Generate a random per-session salt for the KDF, base64-encoded for transport
 * in the invite. Preferred over the legacy deterministic salt, which is a pure
 * function of the passphrase and therefore enables precomputation against
 * low-entropy manually chosen passphrases.
 */
export function generateSaltB64(): string {
  return uint8ToBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(passphrase);
  const base = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  return arrayBufferToBase64(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

function base64ToUint8(base64: string): Uint8Array {
  return new Uint8Array(base64ToArrayBuffer(base64));
}

export class E2ECrypto {
  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  private passphrase: string;
  private saltB64Override: string | null;

  /**
   * @param passphrase shared secret used to derive the AES key.
   * @param saltB64 optional base64 salt from the invite. When provided a random
   *   per-session salt is used; when omitted (legacy invites) the derivation
   *   falls back to the deterministic passphrase-derived salt for compatibility.
   */
  constructor(passphrase: string, saltB64?: string) {
    this.passphrase = passphrase;
    this.saltB64Override = saltB64 && saltB64.length > 0 ? saltB64 : null;
  }

  async init(): Promise<void> {
    if (this.saltB64Override) {
      this.salt = base64ToUint8(this.saltB64Override).slice(0, SALT_BYTES);
    } else {
      // Legacy deterministic salt: kept only so invites created before random
      // salts still decrypt. New sessions always pass an explicit random salt.
      const raw = new TextEncoder().encode(passphraseSaltInput(this.passphrase));
      const hashBuf = await crypto.subtle.digest("SHA-256", raw);
      this.salt = new Uint8Array(hashBuf).slice(0, SALT_BYTES);
    }
    this.key = await deriveKey(this.passphrase, this.salt);
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error("E2E not initialised");
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.key,
      plaintext as BufferSource,
    );
    const encrypted = new Uint8Array(IV_BYTES + ciphertext.byteLength);
    encrypted.set(iv, 0);
    encrypted.set(new Uint8Array(ciphertext), IV_BYTES);
    return encrypted;
  }

  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.key) throw new Error("E2E not initialised");
    const iv = data.slice(0, IV_BYTES);
    const ciphertext = data.slice(IV_BYTES);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, ciphertext);
    return new Uint8Array(plaintext);
  }

  async encryptString(plain: string): Promise<string> {
    const bytes = new TextEncoder().encode(plain);
    const encrypted = await this.encrypt(bytes);
    return uint8ToBase64(encrypted);
  }

  async decryptString(encoded: string): Promise<string> {
    const encrypted = base64ToUint8(encoded);
    const decrypted = await this.decrypt(encrypted);
    return new TextDecoder().decode(decrypted);
  }
}
