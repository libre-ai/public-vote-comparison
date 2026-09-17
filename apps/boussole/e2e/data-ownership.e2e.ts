import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const STATEMENT = "stmt-services-publics";

async function answerFirst(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("group", { name: STATEMENT }).getByRole("button", { name: "+3" }).click();

  // First save triggers passphrase gate (needs-passphrase status)
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();

  // Set a passphrase (minimum 12 characters)
  const testPassphrase = "test-passphrase-data-ownership";
  await page.fill('input[id="passphrase-input"]', testPassphrase);
  await page.fill('input[id="confirm-input"]', testPassphrase);
  await page.click('button[data-testid="submit-passphrase"]');

  // After passphrase is set, gate disappears and questionnaire becomes visible
  await expect(page.getByTestId("passphrase-gate")).not.toBeVisible();
  await expect(page.getByTestId("progress")).toContainText("1 / 4");
}

test("exports the response set to a local file with zero transmission", async ({ page }) => {
  const crossOrigin: string[] = [];
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  page.on("request", (r) => {
    const url = r.url();
    // A blob:/data: download is not a network request; only real cross-origin
    // traffic would break the no-transmission invariant.
    if (url.startsWith("blob:") || url.startsWith("data:")) return;
    if (new URL(url).origin !== origin) crossOrigin.push(`${r.method()} ${url}`);
  });

  await answerFirst(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Télécharger mes réponses" }).click(),
  ]);

  expect(download.suggestedFilename()).toBe("boussole-reponses.json");
  const path = await download.path();
  const doc = JSON.parse(await readFile(path, "utf8"));
  expect(doc.schemaVersion).toBe("libre-ai.boussole-response-set.v2");
  expect(doc.responses).toContainEqual({ statementId: STATEMENT, kind: "answer", value: 3 });

  // The export produced a file entirely on-device: no cross-origin request.
  expect(crossOrigin).toEqual([]);
});

test("deletes all responses after in-page confirmation and stays empty on reload", async ({
  page,
}) => {
  await page.goto("/");
  const testPassphrase = "test-passphrase-delete-123";

  // answerFirst will set a passphrase and show questionnaire
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("group", { name: STATEMENT }).getByRole("button", { name: "+3" }).click();
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();
  await page.fill('input[id="passphrase-input"]', testPassphrase);
  await page.fill('input[id="confirm-input"]', testPassphrase);
  await page.click('button[data-testid="submit-passphrase"]');
  await expect(page.getByTestId("passphrase-gate")).not.toBeVisible();
  await expect(page.getByTestId("progress")).toContainText("1 / 4");

  // Delete all responses
  await page.getByRole("button", { name: "Supprimer mes réponses" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.getByTestId("delete-done")).toBeVisible();

  // Reload: encrypted empty set triggers passphrase gate
  await page.reload();
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();

  // Enter the same passphrase to decrypt the empty set
  await page.fill('input[id="passphrase-input"]', testPassphrase);
  await page.click('button[data-testid="submit-passphrase"]');

  // Verify the set is now empty: binding kept (still 4 statements), all answers gone
  await expect(page.getByTestId("progress")).toContainText("0 / 4");
  await expect(page.getByTestId(`state-${STATEMENT}`)).toContainText("Sans réponse");
});

test("cancelling the delete confirmation keeps the responses", async ({ page }) => {
  await page.goto("/");
  await answerFirst(page);

  await page.getByRole("button", { name: "Supprimer mes réponses" }).click();
  await page.getByRole("button", { name: "Annuler" }).click();

  await expect(page.getByTestId("progress")).toContainText("1 / 4");
  await expect(page.getByTestId(`state-${STATEMENT}`)).toContainText("Répondu (3)");
});
