// Boussole IndexedDB adapter — the on-device implementation of LocalResponseStore.
// It persists the single encoded response-set string; nothing ever leaves the
// device (local-only). The fail-closed decode lives in the port
// (local-response-store): this adapter only reads the stored string and hands it to
// `deserializeResponseSet`, so a corrupt or tampered record surfaces as a `corrupt`
// LoadResult, never a rehydrated invalid set. The IDBFactory is injected so the
// adapter is testable off-browser (fake-indexeddb) and never reaches for an ambient
// global. Mirrors the practices IndexedDB adapter's transaction discipline: handlers
// are attached synchronously with the request so a transaction can never auto-commit
// before completion is observed. At-rest encryption (AES-256-GCM) protects the
// stored response set from device backups; decryption requires the user's PIN.

import type { EncryptedEnvelope } from "../crypto/symmetric-encryption";
import { decryptString, decryptWithKey, encryptWithKey } from "../crypto/symmetric-encryption";
import type { ResponseSet } from "../domain/response-set";
import {
  deserializeResponseSet,
  type EncryptionContext,
  type LoadResult,
  type LocalResponseStore,
  serializeResponseSet,
} from "./local-response-store";

const DATABASE_NAME = "libre-ai-boussole";
const DATABASE_VERSION = 1;
const STORE_NAME = "response-set";
// A boussole device holds a single response set, stored under one fixed key.
const RECORD_KEY = "current";
const OPEN_DEADLINE_MS = 10_000;

interface ResponseRecord {
  readonly key: typeof RECORD_KEY;
  readonly raw: string;
}

/**
 * Create an IndexedDB-backed LocalResponseStore over the given factory (inject a
 * real `indexedDB` in the browser, or a fake in tests). `databaseName` is
 * overridable so tests can isolate.
 */
export function createIndexedDbResponseStore(
  factory: IDBFactory,
  databaseName: string = DATABASE_NAME,
): LocalResponseStore {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(databaseName, DATABASE_VERSION);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("indexeddb open threw"));
        return;
      }
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("indexeddb open timed out"));
      }, OPEN_DEADLINE_MS);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(request.error ?? new Error("indexeddb open failed"));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error("indexeddb open blocked"));
      };
    });
  }

  // Run one request inside a transaction, attaching completion handlers
  // synchronously with issuing the request. The request result is captured on
  // success and returned when the transaction commits.
  async function withStore<T>(
    mode: IDBTransactionMode,
    execute: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = execute(transaction.objectStore(STORE_NAME));
        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
        transaction.onerror = () => reject(transaction.error ?? new Error("transaction error"));
      });
    } finally {
      database.close();
    }
  }

  function tryParseEncryptedEnvelope(data: string): EncryptedEnvelope | undefined {
    try {
      const parsed = JSON.parse(data);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        parsed.version === 1 &&
        typeof parsed.salt === "string" &&
        typeof parsed.nonce === "string" &&
        typeof parsed.ciphertext === "string" &&
        typeof parsed.tag === "string"
      ) {
        return parsed as EncryptedEnvelope;
      }
    } catch {
      // Not encrypted, or not JSON
    }
    return undefined;
  }

  return {
    async save(set: ResponseSet, encryption?: EncryptionContext): Promise<void> {
      if (!encryption) {
        throw new Error("save() requires an EncryptionContext (passphrase must be set first)");
      }

      const plaintext = serializeResponseSet(set);
      const envelope = await encryptWithKey(
        plaintext,
        encryption.key,
        encryption.salt,
        globalThis.crypto.subtle,
      );

      const record: ResponseRecord = { key: RECORD_KEY, raw: JSON.stringify(envelope) };
      await withStore("readwrite", (store) => store.put(record));
    },

    async load(): Promise<LoadResult> {
      const record = await withStore<ResponseRecord | undefined>("readonly", (store) =>
        store.get(RECORD_KEY),
      );
      if (record === undefined) return { status: "empty" };

      // Check if the stored data is an encrypted envelope
      const envelope = tryParseEncryptedEnvelope(record.raw);
      if (envelope) {
        return { status: "encrypted", envelope };
      }

      // Try to deserialize as plaintext
      const outcome = deserializeResponseSet(record.raw);
      return outcome.ok
        ? { status: "loaded", set: outcome.value }
        : { status: "corrupt", refusal: outcome.refusal };
    },

    async decryptEnvelope(envelope: EncryptedEnvelope, passphrase: string): Promise<LoadResult> {
      try {
        const decrypted = await decryptString(envelope, passphrase);
        const outcome = deserializeResponseSet(decrypted);
        return outcome.ok
          ? { status: "loaded", set: outcome.value, envelope }
          : { status: "corrupt", refusal: outcome.refusal };
      } catch {
        // Decryption failed (wrong passphrase or corrupted envelope)
        return { status: "corrupt", refusal: "boussole.local_state_corrupt" };
      }
    },
    async decryptEnvelopeWithKey(envelope: EncryptedEnvelope, key: CryptoKey): Promise<LoadResult> {
      try {
        const decrypted = await decryptWithKey(envelope, key);
        const outcome = deserializeResponseSet(decrypted);
        return outcome.ok
          ? { status: "loaded", set: outcome.value, envelope }
          : { status: "corrupt", refusal: outcome.refusal };
      } catch {
        // Decryption failed (wrong key or corrupted envelope)
        return { status: "corrupt", refusal: "boussole.local_state_corrupt" };
      }
    },

    async clear(): Promise<void> {
      await withStore("readwrite", (store) => store.clear());
    },
  };
}
