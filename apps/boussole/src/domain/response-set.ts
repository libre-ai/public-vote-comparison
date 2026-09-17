// Boussole local questionnaire domain — the on-device response set
// (docs/apps/boussole.md §Domain protocol, contracts/schemas/
// boussole-response-set.v2.schema.json). Pure and offline: a response set binds
// exact dataset and method hashes and holds one answer or skip per statement.
// Transmission guarantee: this module does not transmit — it exposes no network
// path and imports nothing. `exportResponseSet` returns a plain serializable
// value for a LOCAL file; a caller must not upload it. The
// response_transmission_forbidden invariant lives structurally here (no channel
// to violate it) and, downstream, in the absence of any API that accepts
// responses (docs/apps/boussole.md §Non-goals). The deterministic Rust/WASM
// scoring core (ComputeLocalComparison) is a candidate boundary, deliberately
// unimplemented in this increment.

export interface DatasetBinding {
  readonly datasetId: string;
  readonly datasetDigest: string;
  readonly methodId: string;
  readonly methodDigest: string;
}

export type LocalResponse =
  | { readonly statementId: string; readonly kind: "answer"; readonly value: number }
  | { readonly statementId: string; readonly kind: "skip" };

export interface ResponseSet {
  readonly binding: DatasetBinding;
  readonly statementIds: readonly string[];
  readonly responses: readonly LocalResponse[];
}

export type RefusalCode = "boussole.local_state_corrupt";

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: RefusalCode };

const DATASET_ID = /^urn:libre-ai:dataset:[A-Za-z0-9._~-]+$/;
const METHOD_ID = /^urn:libre-ai:method:[A-Za-z0-9._~-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
// Statement ids conform to the shared `identifier` definition the response-set
// schema references (common.v1.schema.json#/$defs/identifier): a lowercase
// leading letter then 2..127 chars of [a-z0-9_-], i.e. 3..128 total.
const IDENTIFIER = /^[a-z][a-z0-9_-]{2,127}$/;
const MAX_STATEMENTS = 1000;
const MIN_VALUE = -5;
const MAX_VALUE = 5;

function refuse<T>(): Outcome<T> {
  return { ok: false, refusal: "boussole.local_state_corrupt" };
}

function validBinding(binding: DatasetBinding): boolean {
  return (
    DATASET_ID.test(binding.datasetId) &&
    SHA256.test(binding.datasetDigest) &&
    METHOD_ID.test(binding.methodId) &&
    SHA256.test(binding.methodDigest)
  );
}

function upsert(
  responses: readonly LocalResponse[],
  response: LocalResponse,
): readonly LocalResponse[] {
  const next = responses.filter((existing) => existing.statementId !== response.statementId);
  // Deep-freeze the response object, not only the array: a shallow freeze would
  // let a caller mutate `responses[i].value` past the [-5, 5] validation and
  // corrupt a later export.
  next.push(Object.freeze(response));
  return Object.freeze(next);
}

/**
 * Begin a local questionnaire bound to exact dataset and method hashes over a
 * fixed, non-empty statement set. Fail-closed: a malformed binding, an empty or
 * oversized statement set, or a duplicate/malformed statement id is refused.
 */
export function startQuestionnaire(
  binding: DatasetBinding,
  statementIds: readonly string[],
): Outcome<ResponseSet> {
  if (!validBinding(binding)) return refuse();
  if (statementIds.length === 0 || statementIds.length > MAX_STATEMENTS) return refuse();
  if (statementIds.some((id) => !IDENTIFIER.test(id))) return refuse();
  if (new Set(statementIds).size !== statementIds.length) return refuse();
  return {
    ok: true,
    value: Object.freeze({
      binding,
      statementIds: Object.freeze([...statementIds]),
      responses: Object.freeze([] as LocalResponse[]),
    }),
  };
}

/** Record a symmetric answer (integer in [-5, 5]) to a known statement. */
export function recordResponse(
  set: ResponseSet,
  statementId: string,
  value: number,
): Outcome<ResponseSet> {
  if (!set.statementIds.includes(statementId)) return refuse();
  if (!Number.isInteger(value) || value < MIN_VALUE || value > MAX_VALUE) return refuse();
  return {
    ok: true,
    value: Object.freeze({
      ...set,
      responses: upsert(set.responses, { statementId, kind: "answer", value }),
    }),
  };
}

/** Skip a known statement (abstention is preserved, never hidden). */
export function skipStatement(set: ResponseSet, statementId: string): Outcome<ResponseSet> {
  if (!set.statementIds.includes(statementId)) return refuse();
  return {
    ok: true,
    value: Object.freeze({
      ...set,
      responses: upsert(set.responses, { statementId, kind: "skip" }),
    }),
  };
}

/** Delete every local response, keeping the dataset/method binding to restart. */
export function deleteResponses(set: ResponseSet): ResponseSet {
  return Object.freeze({ ...set, responses: Object.freeze([] as LocalResponse[]) });
}

export interface ExportedResponseSet {
  readonly schemaVersion: "libre-ai.boussole-response-set.v2";
  readonly datasetId: string;
  readonly datasetDigest: string;
  readonly methodId: string;
  readonly methodDigest: string;
  readonly responses: readonly (
    | { readonly statementId: string; readonly kind: "answer"; readonly value: number }
    | { readonly statementId: string; readonly kind: "skip" }
  )[];
}

/**
 * Serialize the current responses to a `boussole-response-set.v2` document for a
 * non-identifying local export. Refused when empty (the schema requires at least
 * one response). Export is a local file only — never a network upload.
 */
export function exportResponseSet(set: ResponseSet): Outcome<ExportedResponseSet> {
  if (set.responses.length === 0) return refuse();
  const responses = set.responses.map((response) =>
    Object.freeze(
      response.kind === "answer"
        ? { statementId: response.statementId, kind: "answer" as const, value: response.value }
        : { statementId: response.statementId, kind: "skip" as const },
    ),
  );
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "libre-ai.boussole-response-set.v2",
      datasetId: set.binding.datasetId,
      datasetDigest: set.binding.datasetDigest,
      methodId: set.binding.methodId,
      methodDigest: set.binding.methodDigest,
      responses: Object.freeze(responses),
    }),
  };
}
