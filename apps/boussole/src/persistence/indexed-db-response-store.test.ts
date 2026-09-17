import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deriveKeyFromPassphrase, encryptString } from "../crypto/symmetric-encryption";
import { type ResponseSet, recordResponse, startQuestionnaire } from "../domain/response-set";
import { createIndexedDbResponseStore } from "./indexed-db-response-store";
import type { EncryptionContext } from "./local-response-store";

const DB = "boussole-test";
const STORE = "response-set";

function responseSet(answer = 3): ResponseSet {
  const started = startQuestionnaire(
    {
      datasetId: "urn:libre-ai:dataset:d1",
      datasetDigest: "a".repeat(64),
      methodId: "urn:libre-ai:method:m1",
      methodDigest: "b".repeat(64),
    },
    ["stmt-one", "stmt-two"],
  );
  if (!started.ok) throw new Error("fixture start refused");
  const answered = recordResponse(started.value, "stmt-one", answer);
  if (!answered.ok) throw new Error("fixture record refused");
  return answered.value;
}

// Create a test encryption context using a fixed salt (tests are deterministic)
async function testEncryptionContext(): Promise<EncryptionContext> {
  const testSalt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const key = await deriveKeyFromPassphrase("test-passphrase", testSalt, globalThis.crypto.subtle);
  return { key, salt: testSalt };
}

// Seed a raw record directly, bypassing the domain, to simulate on-disk corruption.
function seedRaw(factory: IDBFactory, raw: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ key: "current", raw });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("seed failed"));
      };
    };
    request.onerror = () => reject(request.error ?? new Error("seed open failed"));
  });
}

describe("IndexedDB response store — round-trip on fake-indexeddb", () => {
  test("saves and loads the response set", async () => {
    const store = createIndexedDbResponseStore(new IDBFactory(), DB);
    const original = responseSet();
    const encryption = await testEncryptionContext();
    await store.save(original, encryption);
    const result = await store.load();
    expect(result.status).toBe("encrypted");
    if (result.status !== "encrypted") return;
    const decrypted = await store.decryptEnvelope(result.envelope, "test-passphrase");
    expect(decrypted.status).toBe("loaded");
    if (decrypted.status !== "loaded") return;
    expect(decrypted.set).toEqual(original);
  });

  test("a fresh store is empty", async () => {
    const store = createIndexedDbResponseStore(new IDBFactory(), DB);
    expect(await store.load()).toEqual({ status: "empty" });
  });

  test("re-save overwrites the single set", async () => {
    const store = createIndexedDbResponseStore(new IDBFactory(), DB);
    const encryption = await testEncryptionContext();
    await store.save(responseSet(3), encryption);
    await store.save(responseSet(-2), encryption);
    const result = await store.load();
    expect(result.status).toBe("encrypted");
    if (result.status !== "encrypted") return;
    const decrypted = await store.decryptEnvelope(result.envelope, "test-passphrase");
    expect(decrypted.status).toBe("loaded");
    if (decrypted.status !== "loaded") return;
    const answer = decrypted.set.responses.find((r) => r.statementId === "stmt-one");
    expect(answer).toEqual({ statementId: "stmt-one", kind: "answer", value: -2 });
  });

  test("clear empties the store", async () => {
    const store = createIndexedDbResponseStore(new IDBFactory(), DB);
    const encryption = await testEncryptionContext();
    await store.save(responseSet(), encryption);
    await store.clear();
    expect(await store.load()).toEqual({ status: "empty" });
  });

  test("a corrupt stored record surfaces as corrupt, not a rehydrated set", async () => {
    const factory = new IDBFactory();
    await seedRaw(factory, "{ not valid json");
    const store = createIndexedDbResponseStore(factory, DB);
    expect(await store.load()).toEqual({
      status: "corrupt",
      refusal: "boussole.local_state_corrupt",
    });
  });

  test("save rejects when the factory cannot open", async () => {
    const broken = {
      open: () => {
        throw new Error("no indexeddb");
      },
    } as unknown as IDBFactory;
    const store = createIndexedDbResponseStore(broken, DB);
    await expect(store.save(responseSet())).rejects.toThrow();
  });

  test("encrypted record round-trip: save encrypted, load returns encrypted, decrypt restores plaintext", async () => {
    const factory = new IDBFactory();
    const store = createIndexedDbResponseStore(factory, DB);
    const original = responseSet();
    const testPassphrase = "test-passphrase-123";

    // 1. Encrypt the response set
    const envelope = await encryptString(JSON.stringify(original), testPassphrase);

    // 2. Derive the encryption context from the same passphrase
    const salt = new Uint8Array(
      atob(envelope.salt)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
    const key = await deriveKeyFromPassphrase(testPassphrase, salt, globalThis.crypto.subtle);

    // 3. Save with encryption context
    await store.save(original, { key, salt });

    // 4. Load should return encrypted status with the envelope
    const loadResult = await store.load();
    expect(loadResult.status).toBe("encrypted");
    if (loadResult.status !== "encrypted") return;

    // 5. Verify envelope is well-formed
    expect(loadResult.envelope.version).toBe(1);
    expect(typeof loadResult.envelope.salt).toBe("string");
    expect(typeof loadResult.envelope.nonce).toBe("string");
    expect(typeof loadResult.envelope.ciphertext).toBe("string");
    expect(typeof loadResult.envelope.tag).toBe("string");

    // 6. Decrypt with correct passphrase
    const decrypted = await store.decryptEnvelope(loadResult.envelope, testPassphrase);
    expect(decrypted.status).toBe("loaded");
    if (decrypted.status !== "loaded") return;

    // 7. Verify decrypted set matches the original
    expect(decrypted.set).toEqual(original);
  });
});
