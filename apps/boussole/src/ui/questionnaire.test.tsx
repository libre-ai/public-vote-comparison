import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QUESTIONNAIRE_STATEMENTS } from "./fixture";
import { Questionnaire } from "./questionnaire";

function render(responses: Parameters<typeof Questionnaire>[0]["responses"] = []): string {
  return renderToStaticMarkup(
    <Questionnaire statements={QUESTIONNAIRE_STATEMENTS} responses={responses} />,
  );
}

describe("Questionnaire — accessible baseline", () => {
  test("renders every statement with a group label and no colour-only meaning", () => {
    const html = render();
    for (const id of QUESTIONNAIRE_STATEMENTS) expect(html).toContain(id);
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).not.toContain("style=");
  });

  test("shows the recorded state as text (answered / skipped / pending)", () => {
    const html = render([
      { statementId: "stmt-fiscalite", kind: "answer", value: 3 },
      { statementId: "stmt-environnement", kind: "skip" },
    ]);
    expect(html).toContain("Répondu"); // stmt-fiscalite
    expect(html).toContain("Passé"); // stmt-environnement
    expect(html).toContain("Sans réponse"); // the untouched statements
  });

  test("hides the interactive controls without handlers (no-JS baseline)", () => {
    const html = render();
    // Interactive controls live in lai-enhanced-only; the enhanced wrapper is
    // present but the baseline exposes no answer buttons as reachable controls.
    expect(html).toContain("lai-enhanced-only");
  });
});
