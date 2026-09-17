import { describe, expect, test } from "bun:test";

import {
  type DatasetBinding,
  type ResponseSet,
  recordResponse,
  skipStatement,
  startQuestionnaire,
} from "./response-set";
import { migrateResponses, previewUpgrade } from "./upgrade-preview";

const BINDING: DatasetBinding = {
  datasetId: "urn:libre-ai:dataset:civic-2026",
  datasetDigest: "a".repeat(64),
  methodId: "urn:libre-ai:method:axes-8",
  methodDigest: "b".repeat(64),
};

// A newer dataset version: same method, drops s-climate, adds s-housing.
const NEXT_DATASET: DatasetBinding = { ...BINDING, datasetDigest: "c".repeat(64) };
const STATEMENTS = ["s-redistribution", "s-borders", "s-climate"] as const;
const NEXT_STATEMENTS = ["s-redistribution", "s-borders", "s-housing"] as const;

function current(): ResponseSet {
  const start = startQuestionnaire(BINDING, STATEMENTS);
  if (!start.ok) throw new Error("fixture start refused");
  const a = recordResponse(start.value, "s-redistribution", -4);
  if (!a.ok) throw new Error("fixture record refused");
  const b = recordResponse(a.value, "s-climate", 5);
  if (!b.ok) throw new Error("fixture record refused");
  return b.value;
}

describe("previewUpgrade", () => {
  test("reports carried, dropped and added statements", () => {
    const preview = previewUpgrade(current(), NEXT_DATASET, NEXT_STATEMENTS);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.carried).toEqual(["s-redistribution"]);
    expect(preview.value.dropped).toEqual(["s-climate"]);
    expect(preview.value.addedUnanswered).toEqual(["s-borders", "s-housing"]);
    expect(preview.value.datasetChanged).toBe(true);
    expect(preview.value.methodChanged).toBe(false);
    expect(preview.value.requiresConfirmation).toBe(true);
  });

  test("an identical binding and statement set is a lossless no-op", () => {
    const preview = previewUpgrade(current(), BINDING, STATEMENTS);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.dropped).toEqual([]);
    expect(preview.value.carried).toEqual(["s-redistribution", "s-climate"]);
    expect(preview.value.datasetChanged).toBe(false);
    expect(preview.value.requiresConfirmation).toBe(false);
  });

  test("a method-only change keeps every response and needs no confirmation", () => {
    const newMethod: DatasetBinding = { ...BINDING, methodId: "urn:libre-ai:method:axes-12" };
    const preview = previewUpgrade(current(), newMethod, STATEMENTS);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.methodChanged).toBe(true);
    expect(preview.value.dropped).toEqual([]);
    expect(preview.value.requiresConfirmation).toBe(false);
  });

  test("a dropped skip is a loss too (abstention is never silently discarded)", () => {
    const start = startQuestionnaire(BINDING, STATEMENTS);
    if (!start.ok) throw new Error("start refused");
    const skipped = skipStatement(start.value, "s-climate");
    if (!skipped.ok) throw new Error("skip refused");
    const preview = previewUpgrade(skipped.value, NEXT_DATASET, NEXT_STATEMENTS);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.dropped).toEqual(["s-climate"]);
    expect(preview.value.requiresConfirmation).toBe(true);
  });

  test.each<[string, DatasetBinding, readonly string[]]>([
    ["malformed next binding", { ...NEXT_DATASET, datasetDigest: "z".repeat(64) }, NEXT_STATEMENTS],
    ["empty next statement set", NEXT_DATASET, []],
    ["malformed next statement id", NEXT_DATASET, ["S-Upper"]],
  ])("refuses %s", (_label, next, ids) => {
    const preview = previewUpgrade(current(), next, ids);
    expect(preview).toEqual({ ok: false, refusal: "boussole.local_state_corrupt" });
  });
});

describe("migrateResponses", () => {
  test("a lossy migration is blocked until confirmed (type-enforced flow)", () => {
    const migration = migrateResponses(current(), NEXT_DATASET, NEXT_STATEMENTS, false);
    expect(migration).toEqual({ status: "needs_confirmation", dropped: ["s-climate"] });
  });

  test("a confirmed lossy migration carries survivors, drops the rest, rebinds", () => {
    const migration = migrateResponses(current(), NEXT_DATASET, NEXT_STATEMENTS, true);
    expect(migration.status).toBe("migrated");
    if (migration.status !== "migrated") return;
    expect(migration.dropped).toEqual(["s-climate"]);
    expect(migration.set.binding).toEqual(NEXT_DATASET);
    expect(migration.set.statementIds).toEqual([...NEXT_STATEMENTS]);
    expect(migration.set.responses).toEqual([
      { statementId: "s-redistribution", kind: "answer", value: -4 },
    ]);
    expect(Object.isFrozen(migration.set)).toBe(true);
  });

  test("a lossless superset upgrade proceeds without confirmation", () => {
    const superset: DatasetBinding = { ...BINDING, datasetDigest: "d".repeat(64) };
    const supersetIds = [...STATEMENTS, "s-housing"];
    const migration = migrateResponses(current(), superset, supersetIds, false);
    expect(migration.status).toBe("migrated");
    if (migration.status !== "migrated") return;
    expect(migration.dropped).toEqual([]);
    expect(migration.set.responses).toEqual([
      { statementId: "s-redistribution", kind: "answer", value: -4 },
      { statementId: "s-climate", kind: "answer", value: 5 },
    ]);
  });

  test("preserves a skip across a lossless migration", () => {
    const start = startQuestionnaire(BINDING, STATEMENTS);
    if (!start.ok) throw new Error("start refused");
    const skipped = skipStatement(start.value, "s-borders");
    if (!skipped.ok) throw new Error("skip refused");
    const migration = migrateResponses(skipped.value, NEXT_DATASET, NEXT_STATEMENTS, false);
    expect(migration.status).toBe("migrated");
    if (migration.status !== "migrated") return;
    expect(migration.set.responses).toEqual([{ statementId: "s-borders", kind: "skip" }]);
    expect(migration.dropped).toEqual([]);
  });

  test("refuses a malformed new statement set even when confirmed", () => {
    const migration = migrateResponses(current(), NEXT_DATASET, ["s-a", "s-a"], true);
    expect(migration).toEqual({ status: "refused", refusal: "boussole.local_state_corrupt" });
  });
});
