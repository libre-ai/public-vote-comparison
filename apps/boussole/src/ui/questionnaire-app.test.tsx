import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionnaireApp } from "./questionnaire-app";

describe("QuestionnaireApp — SSR baseline", () => {
  test("renders the empty questionnaire with no store (server render)", () => {
    const html = renderToStaticMarkup(<QuestionnaireApp />);
    expect(html).toContain("0 / 4 répondu(s).");
    expect(html).not.toContain("corrupt-notice");
    expect(html).not.toContain("style=");
  });

  test("includes the enhanced-only data-ownership region, export disabled at the empty baseline", () => {
    const html = renderToStaticMarkup(<QuestionnaireApp />);
    expect(html).toContain("Mes données");
    expect(html).toContain("Télécharger mes réponses");
    expect(html).toContain("Supprimer mes réponses");
    // Empty baseline: nothing to export yet.
    expect(html).toContain("disabled");
    expect(html).toContain("Rien à exporter");
  });
});
