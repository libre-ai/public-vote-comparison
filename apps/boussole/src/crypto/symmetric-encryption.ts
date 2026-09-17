/**
 * AES-256-GCM symmetric encryption for boussole at-rest data protection.
 * All operations are deterministic and local (no randomness beyond the per-operation nonce).
 * Fail-closed: decryption failures return error, never plaintext fallback.
 */

export interface EncryptedEnvelope {
  readonly version: 1;
  readonly salt: string; // base64-encoded 16-byte random salt
  readonly nonce: string; // base64-encoded 12-byte random nonce
  readonly ciphertext: string; // base64-encoded encrypted data
  readonly tag: string; // base64-encoded 16-byte GCM auth tag
}

/**
 * Key derivation source abstraction. Allows decoupling the envelope format
 * (version 1, immutable) from the derivation mechanism. Future sources may
 * include WebAuthn-PRF; passphrases are the current and only implementation.
 * The envelope stays version 1 across all sources.
 */
export interface KeySource {
  readonly kind: "passphrase";
}

/**
 * Derive an AES-256 key from a passphrase using PBKDF2-SHA256.
 * Uses 600,000 iterations per OWASP 2026 guidance for special-category data.
 * The salt is returned separately; the caller stores it with the ciphertext.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  crypto: SubtleCrypto,
): Promise<CryptoKey> {
  const passphraseKey = await crypto.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false, // not extractable (key never leaves crypto context)
    ["deriveKey"],
  );

  return crypto.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 600_000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false, // not extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a pre-derived CryptoKey.
 * Generates a random 12-byte nonce for GCM; the salt must be stored separately
 * and passed to deriveKeyFromPassphrase on decryption.
 * Returns an envelope with nonce, ciphertext, and tag (all base64-encoded).
 * Optionally accepts a SubtleCrypto implementation; uses globalThis.crypto if not provided.
 */
export async function encryptWithKey(
  plaintext: string,
  key: CryptoKey,
  salt: Uint8Array,
  crypto?: SubtleCrypto,
): Promise<EncryptedEnvelope> {
  if (!crypto) {
    crypto = globalThis.crypto.subtle;
  }

  // Generate random nonce for GCM
  const nonce = new Uint8Array(12);
  globalThis.crypto.getRandomValues(nonce);

  // Encrypt plaintext
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextWithTag = await crypto.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintextBytes,
  );

  // GCM returns [ciphertext || tag]; split them
  // GCM auth tag is 16 bytes at the end
  const ciphertextArray = new Uint8Array(ciphertextWithTag.slice(0, -16));
  const tag = new Uint8Array(ciphertextWithTag.slice(-16));

  return {
    version: 1,
    salt: btoa(String.fromCharCode(...salt)),
    nonce: btoa(String.fromCharCode(...nonce)),
    ciphertext: btoa(String.fromCharCode(...ciphertextArray)),
    tag: btoa(String.fromCharCode(...tag)),
  };
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a passphrase-derived key.
 * Generates a random 16-byte salt (for PBKDF2) and a random 12-byte nonce (for GCM).
 * Returns an envelope with salt, nonce, ciphertext, and tag (all base64-encoded).
 * Optionally accepts a SubtleCrypto implementation; uses globalThis.crypto if not provided.
 */
export async function encryptString(
  plaintext: string,
  passphrase: string,
  crypto?: SubtleCrypto,
): Promise<EncryptedEnvelope> {
  if (!crypto) {
    crypto = globalThis.crypto.subtle;
  }
  // Generate random salt and nonce (use globalThis.crypto.getRandomValues)
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  // Derive encryption key from passphrase
  const key = await deriveKeyFromPassphrase(passphrase, salt, crypto);

  return encryptWithKey(plaintext, key, salt, crypto);
}

/**
 * Decrypt an encrypted envelope using a passphrase.
 * Returns the plaintext on success; throws on decryption failure or corruption.
 * Fail-closed: any decryption error (wrong passphrase, corrupted envelope) throws.
 * Optionally accepts a SubtleCrypto implementation; uses globalThis.crypto if not provided.
 */
/**
 * Decrypt an envelope with an ALREADY-DERIVED key. This skips the expensive
 * PBKDF2 derivation, so a caller that already holds the key (e.g. after deriving
 * it once to build an EncryptionContext) does not pay the KDF cost twice.
 * Only the nonce/ciphertext/tag are needed here — the salt is a derivation input
 * and is irrelevant once the key exists.
 */
export async function decryptWithKey(
  envelope: EncryptedEnvelope,
  key: CryptoKey,
  crypto?: SubtleCrypto,
): Promise<string> {
  if (!crypto) {
    crypto = globalThis.crypto.subtle;
  }
  if (envelope.version !== 1) {
    throw new Error("Unsupported encryption envelope version");
  }

  // Decode base64 fields (nonce/ciphertext/tag; salt not needed with a derived key)
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  let tag: Uint8Array;
  try {
    nonce = new Uint8Array(
      atob(envelope.nonce)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
    ciphertext = new Uint8Array(
      atob(envelope.ciphertext)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
    tag = new Uint8Array(
      atob(envelope.tag)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
  } catch {
    throw new Error("Failed to decode encryption envelope (base64 corruption)");
  }

  if (nonce.length !== 12) {
    throw new Error("Invalid nonce length (expected 12 bytes)");
  }
  if (tag.length !== 16) {
    throw new Error("Invalid tag length (expected 16 bytes)");
  }

  // Reconstruct ciphertext || tag for GCM decryption
  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(tag, ciphertext.length);

  // Decrypt; WebCrypto will verify the auth tag and throw if it's wrong
  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await crypto.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      ciphertextWithTag as BufferSource,
    );
  } catch (error) {
    // Decryption failure: wrong key or corrupted ciphertext
    throw new Error(
      `Decryption failed (wrong passphrase or corrupted ciphertext): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return new TextDecoder().decode(plaintextBytes);
}

export async function decryptString(
  envelope: EncryptedEnvelope,
  passphrase: string,
  crypto?: SubtleCrypto,
): Promise<string> {
  if (!crypto) {
    crypto = globalThis.crypto.subtle;
  }
  if (envelope.version !== 1) {
    throw new Error("Unsupported encryption envelope version");
  }

  // Decode the salt (the only field needed to derive the key)
  let salt: Uint8Array;
  try {
    salt = new Uint8Array(
      atob(envelope.salt)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
  } catch {
    throw new Error("Failed to decode encryption envelope (base64 corruption)");
  }
  if (salt.length !== 16) {
    throw new Error("Invalid salt length (expected 16 bytes)");
  }

  // Derive decryption key from passphrase and stored salt, then decrypt.
  const key = await deriveKeyFromPassphrase(passphrase, salt, crypto);
  return decryptWithKey(envelope, key, crypto);
}
