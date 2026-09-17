import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionnaireApp } from "./questionnaire-app";
import { useQuestionnaire } from "../client/use-questionnaire";
import type { LocalResponseStore } from "../persistence/local-response-store";

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

test("server and first client render share disabled loading controls", () => {
  const store = { load: async () => ({ status: "empty" }) } as LocalResponseStore;
  const server = renderToStaticMarkup(<QuestionnaireApp />);
  const client = renderToStaticMarkup(<QuestionnaireApp store={store} />);
  expect(client).toBe(server);
  expect(server.match(/<fieldset[^>]*disabled/g)?.length).toBe(4);
});

test("controller refuses answer and skip mutations while loading", () => {
  for (const operation of ["answer", "skip"] as const) {
    let attempted = false;
    const store = { load: async () => ({ status: "empty" }) } as LocalResponseStore;
    function Probe() {
      const controller = useQuestionnaire(store);
      if (!attempted) {
        attempted = true;
        if (operation === "answer") controller.answer("stmt-services-publics", 3);
        else controller.skip("stmt-services-publics");
      }
      return <p>{controller.set.responses.length}</p>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<p>0</p>");
  }
});
