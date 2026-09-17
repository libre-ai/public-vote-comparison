import { beforeEach, describe, expect, it } from "bun:test";
import {
  decryptString,
  deriveKeyFromPassphrase,
  type EncryptedEnvelope,
  encryptString,
} from "./symmetric-encryption";

describe("symmetric-encryption", () => {
  let cryptoSubtle: SubtleCrypto;

  beforeEach(() => {
    cryptoSubtle = globalThis.crypto.subtle;
  });

  describe("encryptString", () => {
    it("encrypts a plaintext string into an envelope", async () => {
      const plaintext = "Political response data";
      const passphrase = "user-secret-pin";

      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);

      expect(envelope.version).toBe(1);
      expect(envelope.salt).toBeDefined();
      expect(envelope.nonce).toBeDefined();
      expect(envelope.ciphertext).toBeDefined();
      expect(envelope.tag).toBeDefined();

      // Verify base64 encoding
      expect(() => atob(envelope.salt)).not.toThrow();
      expect(() => atob(envelope.nonce)).not.toThrow();
      expect(() => atob(envelope.ciphertext)).not.toThrow();
      expect(() => atob(envelope.tag)).not.toThrow();

      // Ciphertext should not contain the plaintext (it's encrypted)
      expect(envelope.ciphertext).not.toContain(plaintext);
    });

    it("produces different ciphertexts for the same plaintext (random nonce/salt)", async () => {
      const plaintext = "Same data";
      const passphrase = "same-pin";

      const envelope1 = await encryptString(plaintext, passphrase, cryptoSubtle);
      const envelope2 = await encryptString(plaintext, passphrase, cryptoSubtle);

      // Due to random salt and nonce, outputs should differ
      expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
      expect(envelope1.salt).not.toBe(envelope2.salt);
      expect(envelope1.nonce).not.toBe(envelope2.nonce);
    });

    it("encrypts empty string", async () => {
      const plaintext = "";
      const passphrase = "pin";

      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);
      expect(envelope.ciphertext).toBeDefined();
    });

    it("encrypts JSON data (response set)", async () => {
      const plaintext = JSON.stringify({
        binding: {
          datasetId: "urn:libre-ai:dataset:test",
          datasetDigest: "a".repeat(64),
          methodId: "urn:libre-ai:method:test",
          methodDigest: "b".repeat(64),
        },
        statementIds: ["statement_1", "statement_2"],
        responses: [{ statementId: "statement_1", kind: "answer" as const, value: 3 }],
      });
      const passphrase = "user-pin";

      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);
      expect(envelope.ciphertext).toBeDefined();
    });
  });

  describe("decryptString", () => {
    it("decrypts an encrypted envelope with correct passphrase", async () => {
      const plaintext = "My secret opinions";
      const passphrase = "correct-pin";

      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);
      const decrypted = await decryptString(envelope, passphrase, cryptoSubtle);

      expect(decrypted).toBe(plaintext);
    });

    it("throws on wrong passphrase", async () => {
      const plaintext = "Secret data";
      const correctPassphrase = "correct-pin";
      const wrongPassphrase = "wrong-pin";

      const envelope = await encryptString(plaintext, correctPassphrase, cryptoSubtle);

      await expect(decryptString(envelope, wrongPassphrase, cryptoSubtle)).rejects.toThrow();
    });

    it("throws on corrupted ciphertext", async () => {
      const plaintext = "Data";
      const passphrase = "pin";

      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);
      const corruptedEnvelope: EncryptedEnvelope = {
        ...envelope,
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(16))), // Wrong length
      };

      await expect(decryptString(corruptedEnvelope, passphrase, cryptoSubtle)).rejects.toThrow();
    });

    it("throws on corrupted salt (base64)", async () => {
      const envelope: EncryptedEnvelope = {
        version: 1,
        salt: "invalid-base64-!!!",
        nonce: btoa(String.fromCharCode(...new Uint8Array(12))),
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(16))),
        tag: btoa(String.fromCharCode(...new Uint8Array(16))),
      };

      await expect(decryptString(envelope, "pin", cryptoSubtle)).rejects.toThrow(
        "decode encryption envelope",
      );
    });

    it("throws on corrupted salt length", async () => {
      const plaintext = "Data";
      const passphrase = "pin";
      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);

      const corruptedEnvelope: EncryptedEnvelope = {
        ...envelope,
        salt: btoa(String.fromCharCode(...new Uint8Array(8))), // Wrong length
      };

      await expect(decryptString(corruptedEnvelope, passphrase, cryptoSubtle)).rejects.toThrow(
        "Invalid salt length",
      );
    });

    it("throws on corrupted nonce length", async () => {
      const plaintext = "Data";
      const passphrase = "pin";
      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);

      const corruptedEnvelope: EncryptedEnvelope = {
        ...envelope,
        nonce: btoa(String.fromCharCode(...new Uint8Array(8))), // Wrong length
      };

      await expect(decryptString(corruptedEnvelope, passphrase, cryptoSubtle)).rejects.toThrow(
        "Invalid nonce length",
      );
    });

    it("round-trips JSON data", async () => {
      const data = {
        binding: {
          datasetId: "urn:libre-ai:dataset:civic-2024",
          datasetDigest: "a".repeat(64),
          methodId: "urn:libre-ai:method:left-right",
          methodDigest: "b".repeat(64),
        },
        statementIds: ["eu_policy_1", "social_policy_2"],
        responses: [
          { statementId: "eu_policy_1", kind: "answer" as const, value: 2 },
          { statementId: "social_policy_2", kind: "skip" as const },
        ],
      };
      const plaintext = JSON.stringify(data);
      const passphrase = "my-secure-pin";

      const envelope = await encryptString(plaintext, passphrase, cryptoSubtle);
      const decrypted = await decryptString(envelope, passphrase, cryptoSubtle);
      const parsed = JSON.parse(decrypted);

      expect(parsed).toEqual(data);
    });

    it("throws on unsupported envelope version", async () => {
      const envelope = {
        version: 99 as unknown as 1,
        salt: btoa(String.fromCharCode(...new Uint8Array(16))),
        nonce: btoa(String.fromCharCode(...new Uint8Array(12))),
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(16))),
        tag: btoa(String.fromCharCode(...new Uint8Array(16))),
      } as EncryptedEnvelope;

      await expect(decryptString(envelope, "pin", cryptoSubtle)).rejects.toThrow(
        "Unsupported encryption envelope version",
      );
    });
  });

  describe("deriveKeyFromPassphrase", () => {
    it("derives a usable encryption key", async () => {
      const salt = new Uint8Array(16);
      globalThis.crypto.getRandomValues(salt);
      const passphrase = "test-passphrase";

      const key = await deriveKeyFromPassphrase(passphrase, salt, cryptoSubtle);

      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.type).toBe("secret");
      expect(key.extractable).toBe(false);
      expect(key.algorithm.name).toBe("AES-GCM");
    });

    it("derives the same key from same passphrase and salt", async () => {
      const salt = new Uint8Array(16);
      globalThis.crypto.getRandomValues(salt);
      const passphrase = "same-passphrase";

      // Derive twice (should use same salt)
      const key1 = await deriveKeyFromPassphrase(passphrase, salt, cryptoSubtle);
      const key2 = await deriveKeyFromPassphrase(passphrase, salt, cryptoSubtle);

      // We can't directly compare CryptoKey objects, but we can verify they work
      // by encrypting with one and decrypting with the other
      const testData = "test";
      const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const encrypted1 = await cryptoSubtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        key1,
        new TextEncoder().encode(testData),
      );
      const decrypted = await cryptoSubtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        key2,
        encrypted1,
      );

      expect(new TextDecoder().decode(decrypted)).toBe(testData);
    });

    it("derives different keys from different passphrases", async () => {
      const salt = new Uint8Array(16);
      globalThis.crypto.getRandomValues(salt);

      const key1 = await deriveKeyFromPassphrase("passphrase-1", salt, cryptoSubtle);
      const key2 = await deriveKeyFromPassphrase("passphrase-2", salt, cryptoSubtle);

      // Encrypt with key1, try to decrypt with key2 — should fail
      const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const testData = "test";
      const encrypted = await cryptoSubtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        key1,
        new TextEncoder().encode(testData),
      );

      await expect(
        cryptoSubtle.decrypt({ name: "AES-GCM", iv: nonce }, key2, encrypted),
      ).rejects.toThrow();
    });
  });
});
