import { StatusMessage } from "@libre-ai/ui";
import { useQuestionnaire } from "../client/use-questionnaire";
import type { LocalResponseStore } from "../persistence/local-response-store";
import { DataOwnership } from "./data-ownership";
import { QUESTIONNAIRE_STATEMENTS } from "./fixture";
import { PassphraseGate } from "./passphrase-gate";
import { Questionnaire } from "./questionnaire";

// The controller's handlers are passed unconditionally (they fold through the
// domain and persist via the optional store), so the server render (no store) and
// the client's first render (store present) produce IDENTICAL markup — event
// handlers are not serialized into HTML, and no other output depends on the store.
// This keeps hydration a byte-for-byte match; interactivity is inert without
// JavaScript because the controls live in `lai-enhanced-only`.
export function QuestionnaireApp({ store }: { readonly store?: LocalResponseStore }) {
  const controller = useQuestionnaire(store);
  return (
    <>
      {controller.status === "corrupt" ? (
        <StatusMessage className="lai-status" data-testid="corrupt-notice">
          Vos réponses locales sont illisibles. Recommencez le questionnaire.
        </StatusMessage>
      ) : null}
      {controller.status === "locked" ? (
        <PassphraseGate
          mode="enter"
          error={controller.passphraseError}
          onSubmit={controller.unlockWithPassphrase}
        />
      ) : null}
      {controller.status === "needs-passphrase" ? (
        <PassphraseGate
          mode="set"
          error={controller.passphraseError}
          onSubmit={controller.setPassphrase}
        />
      ) : null}
      {controller.status !== "locked" && controller.status !== "needs-passphrase" ? (
        <>
          <Questionnaire
            statements={QUESTIONNAIRE_STATEMENTS}
            responses={controller.set.responses}
            onAnswer={controller.answer}
            onSkip={controller.skip}
          />
          {controller.status === "corrupt" ? null : (
            <DataOwnership
              exportData={controller.exportData}
              onDeleteAll={controller.deleteAll}
              hasResponses={controller.set.responses.length > 0}
            />
          )}
        </>
      ) : null}
    </>
  );
}
