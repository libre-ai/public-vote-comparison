import { useEffect, useState } from "react";
import { deriveKeyFromPassphrase } from "../crypto/symmetric-encryption";
import {
  deleteResponses,
  type ExportedResponseSet,
  exportResponseSet,
  type ResponseSet,
  recordResponse,
  skipStatement,
  startQuestionnaire,
} from "../domain/response-set";
import type { EncryptionContext, LocalResponseStore } from "../persistence/local-response-store";
import { QUESTIONNAIRE_BINDING, QUESTIONNAIRE_STATEMENTS } from "../ui/fixture";

function emptySet(): ResponseSet {
  const started = startQuestionnaire(QUESTIONNAIRE_BINDING, QUESTIONNAIRE_STATEMENTS);
  if (!started.ok) throw new Error("boussole.fixture_invalid");
  return started.value;
}

export type QuestionnaireStatus = "loading" | "ready" | "locked" | "needs-passphrase" | "corrupt";
export type PassphraseErrorKind = "wrong-passphrase" | "too-short";

export interface QuestionnaireController {
  readonly set: ResponseSet;
  readonly status: QuestionnaireStatus;
  readonly answer: (statementId: string, value: number) => void;
  readonly skip: (statementId: string) => void;
  // Data-ownership: `exportData` returns the current responses as a non-identifying
  // export document (null when empty, mirroring the domain's empty-refusal); the
  // caller turns it into a LOCAL file download — never a network upload. `deleteAll`
  // erases every response through the domain and persists the emptied set (binding
  // kept); it resolves only once the store has durably saved, so the caller can
  // truthfully announce deletion (unlike the optimistic answer/skip saves, a
  // deletion claim must be durable).
  readonly exportData: () => ExportedResponseSet | null;
  readonly deleteAll: () => Promise<void>;
  // Passphrase management for at-rest encryption.
  // When status is "needs-passphrase" (first save): call setPassphrase to enable encryption.
  // When status is "locked" (encrypted store): call unlockWithPassphrase to decrypt.
  readonly passphraseError?: PassphraseErrorKind;
  readonly setPassphrase: (passphrase: string) => Promise<void>;
  readonly unlockWithPassphrase: (passphrase: string) => Promise<void>;
}

// The interactive controller. Without a store (SSR) it stays at the empty set with
// status "ready" (the SSR baseline). With a store, the initial status is "loading"
// until the mount effect loads the persisted set; it then persists every mutation.
// A corrupt local store is surfaced fail-closed (never rehydrated).
// Encryption is mandatory: on first save, if no passphrase has been set, status moves
// to "needs-passphrase" and the save is deferred until the user provides one via setPassphrase().
// For reloads from an encrypted store, status moves to "locked" and the user must call
// unlockWithPassphrase() to decrypt.
export function useQuestionnaire(store?: LocalResponseStore): QuestionnaireController {
  const [set, setSet] = useState<ResponseSet>(emptySet);
  const [status, setStatus] = useState<QuestionnaireStatus>(store ? "loading" : "ready");
  const [encryption, setEncryption] = useState<EncryptionContext | undefined>(undefined);
  const [passphraseError, setPassphraseError] = useState<PassphraseErrorKind | undefined>(
    undefined,
  );
  const [deferredSet, setDeferredSet] = useState<ResponseSet | undefined>(undefined);
  const [encryptedEnvelope, setEncryptedEnvelope] = useState<
    { version: 1; salt: string; nonce: string; ciphertext: string; tag: string } | undefined
  >(undefined);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.load().then((result) => {
      if (cancelled) return;
      if (result.status === "loaded") {
        setSet(result.set);
        if (result.envelope) {
          setEncryptedEnvelope(result.envelope);
        }
        setStatus("ready");
      } else if (result.status === "encrypted") {
        setEncryptedEnvelope(result.envelope);
        setStatus("locked");
      } else if (result.status === "corrupt") {
        setStatus("corrupt");
      } else {
        // empty
        setStatus("ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  function commit(next: ResponseSet): void {
    setSet(next);
    if (encryption) {
      void store?.save(next, encryption).catch(() => {
        // If save fails, the UI state should still match the in-memory set.
        // Log error if needed, but don't revert the UI state.
      });
    } else if (status === "ready") {
      // First save without encryption context: defer and signal need for passphrase
      setDeferredSet(next);
      setStatus("needs-passphrase");
    }
  }

  // Art. 9 special-category data: an 8-char passphrase (~52 bits) is the weak link
  // even under PBKDF2-600k; 12 chars (~78 bits) gives the entropy margin a crypto
  // review flagged for political-opinion data (K4 crypto-at-rest, 2026-07-22).
  const PASSPHRASE_MIN_LENGTH = 12;

  async function setPassphrase(passphrase: string): Promise<void> {
    setPassphraseError(undefined);

    if (passphrase.length < PASSPHRASE_MIN_LENGTH) {
      setPassphraseError("too-short");
      return;
    }

    try {
      // Generate salt for the first time
      const salt = new Uint8Array(16);
      globalThis.crypto.getRandomValues(salt);

      // Derive key from passphrase
      const key = await deriveKeyFromPassphrase(passphrase, salt, globalThis.crypto.subtle);

      const context: EncryptionContext = { key, salt };
      setEncryption(context);

      // Perform deferred save if there is one
      if (deferredSet) {
        await store?.save(deferredSet, context);
        setDeferredSet(undefined);
      }

      setStatus("ready");
    } catch (_error) {
      // Passphrase derivation error
      setPassphraseError("too-short");
    }
  }

  async function unlockWithPassphrase(passphrase: string): Promise<void> {
    setPassphraseError(undefined);

    if (passphrase.length < PASSPHRASE_MIN_LENGTH) {
      setPassphraseError("too-short");
      return;
    }

    if (!encryptedEnvelope) {
      // No envelope to unlock
      setPassphraseError("wrong-passphrase");
      return;
    }

    try {
      // Extract the salt from the envelope (the only field needed to derive the key).
      let salt: Uint8Array;
      try {
        salt = new Uint8Array(
          atob(encryptedEnvelope.salt)
            .split("")
            .map((c) => c.charCodeAt(0)),
        );
      } catch {
        setPassphraseError("wrong-passphrase");
        return;
      }

      // Derive the key ONCE and reuse it for both decryption and the session
      // context. Deriving here AND inside a passphrase-based decrypt doubled the
      // PBKDF2-600k cost on every unlock — enough to stall the gate under load.
      const key = await deriveKeyFromPassphrase(passphrase, salt, globalThis.crypto.subtle);

      const result = await store?.decryptEnvelopeWithKey(encryptedEnvelope, key);
      if (result?.status !== "loaded") {
        setPassphraseError("wrong-passphrase");
        return;
      }

      const context: EncryptionContext = { key, salt };
      setEncryption(context);
      setSet(result.set);
      setStatus("ready");
    } catch (_error) {
      setPassphraseError("wrong-passphrase");
    }
  }

  return {
    set,
    status,
    answer(statementId, value) {
      const next = recordResponse(set, statementId, value);
      if (next.ok) commit(next.value);
    },
    skip(statementId) {
      const next = skipStatement(set, statementId);
      if (next.ok) commit(next.value);
    },
    exportData() {
      const result = exportResponseSet(set);
      return result.ok ? result.value : null;
    },
    async deleteAll() {
      const next = deleteResponses(set);
      if (encryption) {
        await store?.save(next, encryption);
      } else {
        // Should not happen (deleteAll called when status is "ready" implies encryption is set)
        throw new Error("Cannot delete without encryption context");
      }
      setSet(next);
    },
    passphraseError,
    setPassphrase,
    unlockWithPassphrase,
  };
}
