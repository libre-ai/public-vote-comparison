// Boussole local persistence — the storage-agnostic core that lets a response
// set survive a reload without ever leaving the device (docs/apps/boussole.md
// §Data: "User responses and results are IndexedDB/local memory only until
// deletion"). Serialization is a plain local encoding; deserialization is
// fail-closed and reconstructs the set THROUGH the domain, so a corrupt or
// tampered local envelope can never rehydrate into an invalid state
// (boussole.local_state_corrupt). At-rest encryption (AES-256-GCM, PBKDF2-derived
// PIN key) protects IndexedDB from device backups and physical access. The concrete
// IndexedDB adapter is a thin boundary; this module carries the port and an
// in-memory adapter that exercises the exact same encode/decode path.

import type { EncryptedEnvelope } from "../crypto/symmetric-encryption";
import { decryptString, decryptWithKey } from "../crypto/symmetric-encryption";
import {
  type DatasetBinding,
  type LocalResponse,
  type Outcome,
  type RefusalCode,
  type ResponseSet,
  recordResponse,
  skipStatement,
  startQuestionnaire,
} from "../domain/response-set";

const REFUSAL: RefusalCode = "boussole.local_state_corrupt";

/**
 * Encryption context: the derived key and salt needed to encrypt responses.
 * The key is a non-extractable CryptoKey kept only in memory.
 * The salt is derived from the passphrase and stored in the envelope.
 */
export interface EncryptionContext {
  readonly key: CryptoKey;
  readonly salt: Uint8Array;
}

/**
 * Encode a response set to a local string. This is a device-local form only —
 * never a network payload (docs/apps/boussole.md §Non-goals: no server response
 * storage). The three fields carry everything needed to rehydrate the set.
 */
export function serializeResponseSet(set: ResponseSet): string {
  return JSON.stringify({
    binding: set.binding,
    statementIds: set.statementIds,
    responses: set.responses,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBinding(value: unknown): DatasetBinding | undefined {
  if (!isObject(value)) return undefined;
  const { datasetId, datasetDigest, methodId, methodDigest } = value;
  if (
    typeof datasetId !== "string" ||
    typeof datasetDigest !== "string" ||
    typeof methodId !== "string" ||
    typeof methodDigest !== "string"
  ) {
    return undefined;
  }
  return { datasetId, datasetDigest, methodId, methodDigest };
}

function readStatementIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) return undefined;
  return value as string[];
}

function readResponses(value: unknown): readonly LocalResponse[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const responses: LocalResponse[] = [];
  for (const entry of value) {
    if (!isObject(entry) || typeof entry.statementId !== "string") return undefined;
    if (entry.kind === "answer") {
      if (typeof entry.value !== "number") return undefined;
      responses.push({ statementId: entry.statementId, kind: "answer", value: entry.value });
    } else if (entry.kind === "skip") {
      responses.push({ statementId: entry.statementId, kind: "skip" });
    } else {
      return undefined;
    }
  }
  return responses;
}

/**
 * Rebuild a response set from its stored string, fail-closed. Reconstruction
 * replays the stored responses through the domain (`startQuestionnaire` then
 * record/skip), so every invariant the domain enforces — valid binding, known
 * statement ids, in-scale values, deep-frozen immutability — is re-established,
 * and any corruption is refused with `boussole.local_state_corrupt` rather than
 * silently loaded.
 */
export function deserializeResponseSet(raw: string): Outcome<ResponseSet> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, refusal: REFUSAL };
  }
  if (!isObject(parsed)) return { ok: false, refusal: REFUSAL };

  const binding = readBinding(parsed.binding);
  const statementIds = readStatementIds(parsed.statementIds);
  const responses = readResponses(parsed.responses);
  if (binding === undefined || statementIds === undefined || responses === undefined) {
    return { ok: false, refusal: REFUSAL };
  }

  const started = startQuestionnaire(binding, statementIds);
  if (!started.ok) return started;

  let set = started.value;
  for (const response of responses) {
    const step =
      response.kind === "answer"
        ? recordResponse(set, response.statementId, response.value)
        : skipStatement(set, response.statementId);
    if (!step.ok) return step;
    set = step.value;
  }
  return { ok: true, value: set };
}

export type LoadResult =
  | { readonly status: "empty" }
  | { readonly status: "loaded"; readonly set: ResponseSet; readonly envelope?: EncryptedEnvelope }
  | { readonly status: "encrypted"; readonly envelope: EncryptedEnvelope }
  | { readonly status: "corrupt"; readonly refusal: RefusalCode };

/**
 * The device-local persistence port. Async to match the real IndexedDB adapter.
 * `load` never throws on corruption: a malformed or tampered store surfaces as
 * a `corrupt` result, keeping the fail-closed contract at the storage seam.
 * If the stored data is encrypted, `load` returns status "encrypted" with the envelope.
 * The caller must invoke `decryptEnvelope(envelope, passphrase)` to decrypt.
 *
 * `save` accepts an optional EncryptionContext (key + salt) for encryption.
 * If no context is provided, save throws immediately (encryption is mandatory).
 * In practice, the caller (use-questionnaire) manages the key lifecycle:
 * - First save: if no context, prompt user to set passphrase → derive key → retry save
 * - Subsequent saves: context is in memory, always provided
 */
export interface LocalResponseStore {
  save(set: ResponseSet, encryption?: EncryptionContext): Promise<void>;
  load(): Promise<LoadResult>;
  decryptEnvelope(envelope: EncryptedEnvelope, passphrase: string): Promise<LoadResult>;
  /**
   * Decrypt an envelope with an already-derived key. Callers that have derived the
   * key once (to hold it in the session EncryptionContext) use this to avoid paying
   * the PBKDF2 cost a second time — the passphrase-based `decryptEnvelope` re-derives.
   */
  decryptEnvelopeWithKey(envelope: EncryptedEnvelope, key: CryptoKey): Promise<LoadResult>;
  clear(): Promise<void>;
}

/**
 * In-memory adapter for tests and deterministic previews. It stores the encoded
 * string (not the object), so `load` runs the true decode path and rejects
 * injected corruption exactly as a persistent adapter would.
 * If the stored raw is a JSON EncryptedEnvelope, `load` detects it and returns encrypted status.
 * In-memory store stores plaintext (no encryption) for tests/SSR; encryption is only enforced
 * in the real IndexedDB adapter. This allows tests to verify serialization without
 * the encryption overhead.
 */
export function createInMemoryResponseStore(seed?: string): LocalResponseStore {
  let raw: string | undefined = seed;

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
    async save(set: ResponseSet, _encryption?: EncryptionContext): Promise<void> {
      // In-memory store saves plaintext (no encryption).
      // In tests/SSR, this is fine (never persisted).
      // In the browser, the real IndexedDB adapter enforces encryption.
      const plaintext = serializeResponseSet(set);
      raw = plaintext;
    },
    async load(): Promise<LoadResult> {
      if (raw === undefined) return { status: "empty" };

      // Check if the stored data is an encrypted envelope
      const envelope = tryParseEncryptedEnvelope(raw);
      if (envelope) {
        return { status: "encrypted", envelope };
      }

      // Try to deserialize as plaintext
      const outcome = deserializeResponseSet(raw);
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
        return { status: "corrupt", refusal: REFUSAL };
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
        return { status: "corrupt", refusal: REFUSAL };
      }
    },
    async clear(): Promise<void> {
      raw = undefined;
    },
  };
}
