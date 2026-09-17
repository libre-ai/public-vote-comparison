// Boussole dataset-upgrade preview — the pure, offline logic behind the
// "Update/delete" journey (docs/apps/boussole.md §Journeys 4: "user previews
// dataset/method changes before recomputation"). When a newer immutable,
// content-addressed dataset/method version appears, this decides which local
// responses carry over under matching statement ids, which would be lost, and
// which statements are newly unanswered — so the UI can migrate silently when
// nothing is lost or ask for confirmation when it is (§Release: "incompatible
// upgrade requires user-confirmed export/reset"). Nothing here transmits; loss
// is always reported in the return value, never silent.

import {
  type DatasetBinding,
  type Outcome,
  type RefusalCode,
  type ResponseSet,
  recordResponse,
  skipStatement,
  startQuestionnaire,
} from "./response-set";

export interface UpgradePreview {
  /** Responded statement ids that also exist in the new dataset (kept). */
  readonly carried: readonly string[];
  /** Responded statement ids absent from the new dataset (responses lost). */
  readonly dropped: readonly string[];
  /** New statement ids with no prior response (to be answered). */
  readonly addedUnanswered: readonly string[];
  /** The new dataset id/digest differs from the current one. */
  readonly datasetChanged: boolean;
  /** The new method id/digest differs — same positions, new scoring lens. */
  readonly methodChanged: boolean;
  /** True when migrating would lose at least one recorded response. */
  readonly requiresConfirmation: boolean;
}

export type MigrationResult =
  // The set rebound to the new dataset; `dropped` still reports any loss the
  // caller confirmed, so even a confirmed lossy migration is never silent.
  | { readonly status: "migrated"; readonly set: ResponseSet; readonly dropped: readonly string[] }
  // A lossy migration was not performed because it was not confirmed; the
  // caller must surface `dropped` and re-invoke with confirmation to proceed.
  | { readonly status: "needs_confirmation"; readonly dropped: readonly string[] }
  // The new binding or statement set is malformed.
  | { readonly status: "refused"; readonly refusal: RefusalCode };

interface Partition {
  readonly carried: string[];
  readonly dropped: string[];
  readonly addedUnanswered: string[];
}

// Deterministic, clock-free partition: carried/dropped follow the current
// response order; addedUnanswered follows the new statement order.
function partition(current: ResponseSet, nextStatementIds: readonly string[]): Partition {
  const nextIds = new Set(nextStatementIds);
  const responded = current.responses.map((response) => response.statementId);
  const respondedIds = new Set(responded);
  return {
    carried: responded.filter((id) => nextIds.has(id)),
    dropped: responded.filter((id) => !nextIds.has(id)),
    addedUnanswered: nextStatementIds.filter((id) => !respondedIds.has(id)),
  };
}

/**
 * Preview migrating the current responses onto a new dataset/method version.
 * Fail-closed: a malformed new binding or statement set is refused (via the
 * domain). A dropped skip counts as a loss too — abstention is never silently
 * discarded (§Non-goals: no hiding abstention).
 */
export function previewUpgrade(
  current: ResponseSet,
  next: DatasetBinding,
  nextStatementIds: readonly string[],
): Outcome<UpgradePreview> {
  const validated = startQuestionnaire(next, nextStatementIds);
  if (!validated.ok) return validated;

  const { carried, dropped, addedUnanswered } = partition(current, nextStatementIds);
  return {
    ok: true,
    value: Object.freeze({
      carried: Object.freeze(carried),
      dropped: Object.freeze(dropped),
      addedUnanswered: Object.freeze(addedUnanswered),
      datasetChanged:
        current.binding.datasetId !== next.datasetId ||
        current.binding.datasetDigest !== next.datasetDigest,
      methodChanged:
        current.binding.methodId !== next.methodId ||
        current.binding.methodDigest !== next.methodDigest,
      requiresConfirmation: dropped.length > 0,
    }),
  };
}

/**
 * Migrate the current responses onto the new dataset/method. The three-state
 * result makes the confirmation flow type-enforced: a lossy migration is NOT
 * performed unless `confirmed` is true — instead `needs_confirmation` is
 * returned with the ids that would be dropped, so a caller cannot silently lose
 * a recorded position (§Release: "incompatible upgrade requires user-confirmed
 * export/reset"). A lossless migration proceeds regardless of `confirmed`.
 * Carried responses (answers and skips) are replayed through the domain onto a
 * fresh questionnaire bound to `next`. Fail-closed on a malformed new binding or
 * statement set.
 */
export function migrateResponses(
  current: ResponseSet,
  next: DatasetBinding,
  nextStatementIds: readonly string[],
  confirmed: boolean,
): MigrationResult {
  const started = startQuestionnaire(next, nextStatementIds);
  if (!started.ok) return { status: "refused", refusal: started.refusal };

  const { dropped } = partition(current, nextStatementIds);
  if (dropped.length > 0 && !confirmed) {
    return { status: "needs_confirmation", dropped: Object.freeze(dropped) };
  }

  const nextIds = new Set(nextStatementIds);
  let set = started.value;
  for (const response of current.responses) {
    if (!nextIds.has(response.statementId)) continue;
    const step =
      response.kind === "answer"
        ? recordResponse(set, response.statementId, response.value)
        : skipStatement(set, response.statementId);
    // Carried ids are known-valid; kept as a fail-closed backstop.
    if (!step.ok) return { status: "refused", refusal: step.refusal };
    set = step.value;
  }
  return { status: "migrated", set, dropped: Object.freeze(dropped) };
}
