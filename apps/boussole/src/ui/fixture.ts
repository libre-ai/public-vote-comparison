import type { DatasetBinding } from "../domain/response-set";

// A deterministic questionnaire binding + statements for the read/authoring view.
// Per the runtime boundary these are contract fixtures; no real dataset is fetched
// (the public-dataset loader is a deliberate later decision behind the
// no-transmission gate), and no scoring is computed (ADR-0002 gate).
export const QUESTIONNAIRE_BINDING: DatasetBinding = {
  datasetId: "urn:libre-ai:dataset:reference-2030",
  datasetDigest: "a".repeat(64),
  methodId: "urn:libre-ai:method:reference-2030",
  methodDigest: "b".repeat(64),
};

export const QUESTIONNAIRE_STATEMENTS: readonly string[] = [
  "stmt-services-publics",
  "stmt-fiscalite",
  "stmt-environnement",
  "stmt-libertes-numeriques",
];
