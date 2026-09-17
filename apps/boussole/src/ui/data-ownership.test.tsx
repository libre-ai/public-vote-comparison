import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExportedResponseSet } from "../domain/response-set";
import { DataOwnership } from "./data-ownership";

const noop = async (): Promise<void> => {};
const exportEmpty = (): ExportedResponseSet | null => null;

describe("DataOwnership", () => {
  test("region is enhanced-only and lists export + delete in the idle state", () => {
    const html = renderToStaticMarkup(
      <DataOwnership exportData={exportEmpty} onDeleteAll={noop} hasResponses={false} />,
    );
    expect(html).toContain("lai-enhanced-only");
    expect(html).toContain("Télécharger mes réponses");
    expect(html).toContain("Supprimer mes réponses");
    // The confirm controls appear only after the delete button is pressed (client
    // only): the SSR/idle markup must not contain them.
    expect(html).not.toContain("Confirmer la suppression");
    expect(html).not.toContain("delete-confirm");
    // Baseline discipline: no inline styles (matches the rest of the app).
    expect(html).not.toContain("style=");
  });

  test("export is disabled with an empty notice when there are no responses", () => {
    const html = renderToStaticMarkup(
      <DataOwnership exportData={exportEmpty} onDeleteAll={noop} hasResponses={false} />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("Rien à exporter");
  });

  test("export is enabled and no empty notice when responses exist", () => {
    const html = renderToStaticMarkup(
      <DataOwnership exportData={exportEmpty} onDeleteAll={noop} hasResponses={true} />,
    );
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Rien à exporter");
  });
});
