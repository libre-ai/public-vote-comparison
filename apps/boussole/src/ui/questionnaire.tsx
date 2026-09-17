import { SkipLink, Surface } from "@libre-ai/ui";
import type { LocalResponse } from "../domain/response-set";

const SCALE = [-5, -3, 0, 3, 5] as const;

function stateLabel(response: LocalResponse | undefined): string {
  if (response === undefined) return "Sans réponse";
  return response.kind === "answer" ? `Répondu (${response.value})` : "Passé";
}

export function Questionnaire({
  statements,
  responses,
  onAnswer,
  onSkip,
}: {
  readonly statements: readonly string[];
  readonly responses: readonly LocalResponse[];
  readonly onAnswer?: (statementId: string, value: number) => void;
  readonly onSkip?: (statementId: string) => void;
}) {
  const byId = new Map(responses.map((r) => [r.statementId, r]));
  const answered = responses.filter((r) => r.kind === "answer").length;
  return (
    <>
      <SkipLink targetId="questionnaire" />
      <header className="lai-header lai-page">
        <h1>Boussole — questionnaire</h1>
        <p>
          Répondez sur votre appareil. Rien n'est transmis : vos réponses restent en stockage local.
          Le positionnement n'est pas encore disponible.
        </p>
      </header>
      <main id="questionnaire" className="lai-main lai-page lai-stack" tabIndex={-1}>
        <p data-testid="progress">{`${answered} / ${statements.length} répondu(s).`}</p>
        {statements.map((statementId) => {
          const response = byId.get(statementId);
          return (
            <Surface key={statementId} aria-labelledby={`${statementId}-legend`}>
              <fieldset className="lai-stack">
                <legend id={`${statementId}-legend`}>{statementId}</legend>
                <p data-testid={`state-${statementId}`}>{stateLabel(response)}</p>
                <div className="lai-enhanced-only lai-cluster">
                  {SCALE.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={response?.kind === "answer" && response.value === value}
                      onClick={onAnswer ? () => onAnswer(statementId, value) : undefined}
                    >
                      {value > 0 ? `+${value}` : `${value}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={response?.kind === "skip"}
                    onClick={onSkip ? () => onSkip(statementId) : undefined}
                  >
                    Passer
                  </button>
                </div>
              </fieldset>
            </Surface>
          );
        })}
      </main>
    </>
  );
}
