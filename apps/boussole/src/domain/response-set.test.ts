import { describe, expect, test } from "bun:test";

import {
  type DatasetBinding,
  deleteResponses,
  exportResponseSet,
  type ResponseSet,
  recordResponse,
  skipStatement,
  startQuestionnaire,
} from "./response-set";

const BINDING: DatasetBinding = {
  datasetId: "urn:libre-ai:dataset:civic-2026",
  datasetDigest: "a".repeat(64),
  methodId: "urn:libre-ai:method:axes-8",
  methodDigest: "b".repeat(64),
};

const STATEMENTS = ["s-redistribution", "s-borders", "s-climate"] as const;

function started(): ResponseSet {
  const outcome = startQuestionnaire(BINDING, STATEMENTS);
  if (!outcome.ok) throw new Error(`fixture start refused: ${outcome.refusal}`);
  return outcome.value;
}

describe("startQuestionnaire", () => {
  test("binds hashes and opens with no responses", () => {
    const set = started();
    expect(set.binding).toEqual(BINDING);
    expect(set.statementIds).toEqual([...STATEMENTS]);
    expect(set.responses).toEqual([]);
  });

  test.each<[string, DatasetBinding]>([
    ["dataset id not a dataset urn", { ...BINDING, datasetId: "urn:libre-ai:method:x" }],
    ["dataset digest not sha256", { ...BINDING, datasetDigest: "a".repeat(63) }],
    ["method id not a method urn", { ...BINDING, methodId: "urn:libre-ai:dataset:x" }],
    ["method digest uppercase", { ...BINDING, methodDigest: "B".repeat(64) }],
  ])("refuses a malformed binding: %s", (_label, binding) => {
    const outcome = startQuestionnaire(binding, STATEMENTS);
    expect(outcome).toEqual({ ok: false, refusal: "boussole.local_state_corrupt" });
  });

  test("refuses an empty statement set", () => {
    expect(startQuestionnaire(BINDING, []).ok).toBe(false);
  });

  test("refuses more than 1000 statements", () => {
    const many = Array.from({ length: 1001 }, (_v, i) => `s-${i}`);
    expect(startQuestionnaire(BINDING, many).ok).toBe(false);
  });

  test("refuses duplicate statement ids", () => {
    expect(startQuestionnaire(BINDING, ["s-a", "s-a"]).ok).toBe(false);
  });

  test.each([
    "S-upper", // uppercase leading letter
    "0-leading-digit", // digit leading char
    "s-é", // non-ascii
    "ab", // 2 chars, below the identifier minimum of 3
    "s-", // 2 chars
    `s-${"x".repeat(127)}`, // 129 chars, above the identifier maximum of 128
  ])("refuses a malformed statement id: %s", (id) => {
    expect(startQuestionnaire(BINDING, [id]).ok).toBe(false);
  });

  test.each([
    "s_underscore", // underscores are valid per common.v1 identifier
    "abc", // minimum length (3)
    `s-${"x".repeat(126)}`, // maximum length (128)
  ])("accepts a schema-valid statement id: %s", (id) => {
    expect(startQuestionnaire(BINDING, [id]).ok).toBe(true);
  });
});

describe("recordResponse", () => {
  test("records a symmetric answer", () => {
    const outcome = recordResponse(started(), "s-borders", 3);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.responses).toEqual([
      { statementId: "s-borders", kind: "answer", value: 3 },
    ]);
  });

  test.each([-5, 0, 5])("accepts the boundary value %d", (value) => {
    const outcome = recordResponse(started(), "s-borders", value);
    expect(outcome.ok).toBe(true);
  });

  test.each([
    -6,
    6,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("refuses an out-of-scale value: %p", (value) => {
    const outcome = recordResponse(started(), "s-borders", value);
    expect(outcome).toEqual({ ok: false, refusal: "boussole.local_state_corrupt" });
  });

  test("refuses an unknown statement", () => {
    expect(recordResponse(started(), "s-unknown", 1).ok).toBe(false);
  });

  test("re-answering a statement replaces the prior value in place", () => {
    const first = recordResponse(started(), "s-borders", -2);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = recordResponse(first.value, "s-borders", 4);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.responses).toEqual([
      { statementId: "s-borders", kind: "answer", value: 4 },
    ]);
  });
});

describe("skipStatement", () => {
  test("records a skip and preserves the abstention", () => {
    const outcome = skipStatement(started(), "s-climate");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.responses).toEqual([{ statementId: "s-climate", kind: "skip" }]);
  });

  test("refuses an unknown statement", () => {
    expect(skipStatement(started(), "s-unknown").ok).toBe(false);
  });

  test("skipping a previously answered statement replaces the answer", () => {
    const answered = recordResponse(started(), "s-climate", 5);
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const skipped = skipStatement(answered.value, "s-climate");
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.value.responses).toEqual([{ statementId: "s-climate", kind: "skip" }]);
  });
});

describe("deleteResponses", () => {
  test("clears every response but keeps the binding to restart", () => {
    const answered = recordResponse(started(), "s-borders", 2);
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const cleared = deleteResponses(answered.value);
    expect(cleared.responses).toEqual([]);
    expect(cleared.binding).toEqual(BINDING);
    expect(cleared.statementIds).toEqual([...STATEMENTS]);
  });
});

describe("exportResponseSet", () => {
  test("refuses an empty response set (schema requires at least one)", () => {
    expect(exportResponseSet(started()).ok).toBe(false);
  });

  test("serializes answers and skips to a boussole-response-set.v2 document", () => {
    let set = started();
    const a = recordResponse(set, "s-redistribution", -4);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = skipStatement(a.value, "s-borders");
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    set = b.value;

    const outcome = exportResponseSet(set);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({
      schemaVersion: "libre-ai.boussole-response-set.v2",
      datasetId: BINDING.datasetId,
      datasetDigest: BINDING.datasetDigest,
      methodId: BINDING.methodId,
      methodDigest: BINDING.methodDigest,
      responses: [
        { statementId: "s-redistribution", kind: "answer", value: -4 },
        { statementId: "s-borders", kind: "skip" },
      ],
    });
  });

  test("a skip carries no value in the export", () => {
    const skipped = skipStatement(started(), "s-borders");
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    const outcome = exportResponseSet(skipped.value);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.responses[0]).not.toHaveProperty("value");
  });
});

describe("immutability", () => {
  test("recording does not mutate the prior response set", () => {
    const set = started();
    const outcome = recordResponse(set, "s-borders", 1);
    expect(outcome.ok).toBe(true);
    expect(set.responses).toEqual([]);
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.responses)).toBe(true);
  });

  test("each response object is deep-frozen against out-of-scale tampering", () => {
    const outcome = recordResponse(started(), "s-borders", 3);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const response = outcome.value.responses[0];
    expect(Object.isFrozen(response)).toBe(true);
    // A shallow freeze would let a caller push the value past the validated
    // [-5, 5] range; a deep freeze keeps the mutation a no-op.
    expect(() => {
      (response as { value: number }).value = 6;
    }).toThrow();
    expect(outcome.value.responses[0]).toEqual({
      statementId: "s-borders",
      kind: "answer",
      value: 3,
    });
  });

  test("the exported document and its responses are frozen", () => {
    const answered = recordResponse(started(), "s-borders", 2);
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const exported = exportResponseSet(answered.value);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(Object.isFrozen(exported.value)).toBe(true);
    expect(Object.isFrozen(exported.value.responses)).toBe(true);
    expect(Object.isFrozen(exported.value.responses[0])).toBe(true);
  });
});
