import { describe, expect, test } from "bun:test";
import { encryptString } from "../crypto/symmetric-encryption";
import {
  type DatasetBinding,
  type ResponseSet,
  recordResponse,
  skipStatement,
  startQuestionnaire,
} from "../domain/response-set";
import {
  createInMemoryResponseStore,
  deserializeResponseSet,
  serializeResponseSet,
} from "./local-response-store";

const BINDING: DatasetBinding = {
  datasetId: "urn:libre-ai:dataset:civic-2026",
  datasetDigest: "a".repeat(64),
  methodId: "urn:libre-ai:method:axes-8",
  methodDigest: "b".repeat(64),
};

const STATEMENTS = ["s-redistribution", "s-borders", "s-climate"] as const;

function populated(): ResponseSet {
  const start = startQuestionnaire(BINDING, STATEMENTS);
  if (!start.ok) throw new Error("fixture start refused");
  const a = recordResponse(start.value, "s-redistribution", -4);
  if (!a.ok) throw new Error("fixture record refused");
  const b = skipStatement(a.value, "s-borders");
  if (!b.ok) throw new Error("fixture skip refused");
  return b.value;
}

describe("serialize / deserialize round-trip", () => {
  test("a populated set survives an encode/decode cycle unchanged", () => {
    const set = populated();
    const decoded = deserializeResponseSet(serializeResponseSet(set));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.binding).toEqual(set.binding);
    expect(decoded.value.statementIds).toEqual(set.statementIds);
    expect(decoded.value.responses).toEqual(set.responses);
  });

  test("the rehydrated set re-establishes deep-frozen invariants", () => {
    const decoded = deserializeResponseSet(serializeResponseSet(populated()));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(Object.isFrozen(decoded.value)).toBe(true);
    expect(Object.isFrozen(decoded.value.responses)).toBe(true);
    expect(Object.isFrozen(decoded.value.responses[0])).toBe(true);
  });
});

describe("deserializeResponseSet is fail-closed", () => {
  const CORRUPT = { ok: false, refusal: "boussole.local_state_corrupt" } as const;

  test.each<[string, string]>([
    ["malformed json", "{not json"],
    ["a json array", "[]"],
    ["a json primitive", '"just a string"'],
    ["null", "null"],
  ])("refuses non-envelope input: %s", (_label, raw) => {
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses a missing or malformed binding", () => {
    const raw = JSON.stringify({
      binding: { datasetId: "x" },
      statementIds: STATEMENTS,
      responses: [],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses a binding whose digest is not sha256", () => {
    const raw = JSON.stringify({
      binding: { ...BINDING, datasetDigest: "a".repeat(63) },
      statementIds: STATEMENTS,
      responses: [],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses an unknown statement id in a response", () => {
    const raw = JSON.stringify({
      binding: BINDING,
      statementIds: STATEMENTS,
      responses: [{ statementId: "s-not-in-set", kind: "answer", value: 1 }],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses a tampered out-of-scale value (the core security case)", () => {
    const raw = JSON.stringify({
      binding: BINDING,
      statementIds: STATEMENTS,
      responses: [{ statementId: "s-borders", kind: "answer", value: 6 }],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses an answer with a non-integer value", () => {
    const raw = JSON.stringify({
      binding: BINDING,
      statementIds: STATEMENTS,
      responses: [{ statementId: "s-borders", kind: "answer", value: 1.5 }],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses an answer missing its value", () => {
    const raw = JSON.stringify({
      binding: BINDING,
      statementIds: STATEMENTS,
      responses: [{ statementId: "s-borders", kind: "answer" }],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses an unknown response kind", () => {
    const raw = JSON.stringify({
      binding: BINDING,
      statementIds: STATEMENTS,
      responses: [{ statementId: "s-borders", kind: "veto" }],
    });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });

  test("refuses a malformed statement id in the inventory", () => {
    const raw = JSON.stringify({ binding: BINDING, statementIds: ["S-Upper"], responses: [] });
    expect(deserializeResponseSet(raw)).toEqual(CORRUPT);
  });
});

describe("createInMemoryResponseStore", () => {
  test("an unseeded store loads empty", async () => {
    const store = createInMemoryResponseStore();
    expect(await store.load()).toEqual({ status: "empty" });
  });

  test("save then load returns the equal set", async () => {
    const store = createInMemoryResponseStore();
    const set = populated();
    await store.save(set);
    const result = await store.load();
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.set.responses).toEqual(set.responses);
    expect(result.set.binding).toEqual(set.binding);
  });

  test("clear empties the store", async () => {
    const store = createInMemoryResponseStore();
    await store.save(populated());
    await store.clear();
    expect(await store.load()).toEqual({ status: "empty" });
  });

  test("a store seeded with tampered bytes loads as corrupt, not loaded", async () => {
    const tampered = JSON.stringify({
      binding: BINDING,
      statementIds: STATEMENTS,
      responses: [{ statementId: "s-borders", kind: "answer", value: 99 }],
    });
    const store = createInMemoryResponseStore(tampered);
    const result = await store.load();
    expect(result).toEqual({ status: "corrupt", refusal: "boussole.local_state_corrupt" });
  });
});

describe("createInMemoryResponseStore — encryption", () => {
  test("detects and returns encrypted envelope on load", async () => {
    const crypto = globalThis.crypto.subtle;
    const plaintext = serializeResponseSet(populated());
    const passphrase = "test-pin";

    const envelope = await encryptString(plaintext, passphrase, crypto);
    const encryptedString = JSON.stringify(envelope);

    const store = createInMemoryResponseStore(encryptedString);
    const result = await store.load();

    expect(result.status).toBe("encrypted");
    if (result.status === "encrypted") {
      expect(result.envelope.version).toBe(1);
      expect(result.envelope.salt).toBe(envelope.salt);
    }
  });

  test("decrypts with correct passphrase", async () => {
    const crypto = globalThis.crypto.subtle;
    const set = populated();
    const plaintext = serializeResponseSet(set);
    const passphrase = "correct-pin";

    const envelope = await encryptString(plaintext, passphrase, crypto);
    const encryptedString = JSON.stringify(envelope);
    const store = createInMemoryResponseStore(encryptedString);

    const loadResult = await store.load();
    expect(loadResult.status).toBe("encrypted");

    if (loadResult.status === "encrypted") {
      const decrypted = await store.decryptEnvelope(loadResult.envelope, passphrase);
      expect(decrypted.status).toBe("loaded");
      if (decrypted.status === "loaded") {
        expect(decrypted.set.binding).toEqual(set.binding);
        expect(decrypted.set.responses).toEqual(set.responses);
      }
    }
  });

  test("returns corrupt on wrong passphrase", async () => {
    const crypto = globalThis.crypto.subtle;
    const plaintext = serializeResponseSet(populated());
    const passphrase = "correct-pin";

    const envelope = await encryptString(plaintext, passphrase, crypto);
    const encryptedString = JSON.stringify(envelope);
    const store = createInMemoryResponseStore(encryptedString);

    const loadResult = await store.load();
    expect(loadResult.status).toBe("encrypted");

    if (loadResult.status === "encrypted") {
      const decrypted = await store.decryptEnvelope(loadResult.envelope, "wrong-pin");
      expect(decrypted.status).toBe("corrupt");
      if (decrypted.status === "corrupt") {
        expect(decrypted.refusal).toBe("boussole.local_state_corrupt");
      }
    }
  });

  test("loads plaintext data when no encryption is present", async () => {
    const set = populated();
    const plaintext = serializeResponseSet(set);

    const store = createInMemoryResponseStore(plaintext);
    const result = await store.load();

    expect(result.status).toBe("loaded");
    if (result.status === "loaded") {
      expect(result.set.binding).toEqual(set.binding);
      expect(result.set.responses).toEqual(set.responses);
    }
  });
});
