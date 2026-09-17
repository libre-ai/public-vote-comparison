import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { EncryptedEnvelope } from "../src/crypto/symmetric-encryption";

test("answers persist encrypted and are restored on reload after passphrase entry, with zero transmission", async ({
  page,
}) => {
  const requests: string[] = [];

  // First navigate to establish the origin
  await page.goto("/");

  // Set up request interception for cross-origin detection
  const origin = new URL(page.url()).origin;
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== origin) {
      requests.push(`${r.method()} ${r.url()}`);
    }
  });

  // Verify hydration completed
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

  // Answer the first statement with +3
  // This triggers the passphrase-gate since it's the first save
  await page
    .getByRole("group", { name: "stmt-services-publics" })
    .getByRole("button", { name: "+3" })
    .click();

  // The passphrase gate should appear (needs-passphrase status)
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Protégez vos réponses" })).toBeVisible();

  // Set a passphrase (minimum 12 characters)
  const testPassphrase = "my-secure-passphrase-123";
  await page.fill('input[id="passphrase-input"]', testPassphrase);
  await page.fill('input[id="confirm-input"]', testPassphrase);

  // Submit the passphrase
  await page.click('button[data-testid="submit-passphrase"]');

  // Gate should disappear, questionnaire visible
  await expect(page.getByTestId("passphrase-gate")).not.toBeVisible();
  await expect(page.getByTestId("state-stmt-services-publics")).toContainText("Répondu (3)");
  await expect(page.getByTestId("progress")).toContainText("1 / 4");

  // Reload: passphrase entry gate should appear (locked status)
  await page.reload();
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Entrez votre phrase secrète" })).toBeVisible();

  // Enter the correct passphrase
  await page.fill('input[id="passphrase-input"]', testPassphrase);
  await page.click('button[data-testid="submit-passphrase"]');

  // Answers should be restored
  await expect(page.getByTestId("state-stmt-services-publics")).toContainText("Répondu (3)");
  await expect(page.getByTestId("progress")).toContainText("1 / 4");

  // Verify no cross-origin request was made (local-only operation)
  expect(requests).toEqual([]);

  // Verify encrypted-at-rest: read raw IndexedDB, confirm it's EncryptedEnvelope, not plaintext
  await verifyEncryptedAtRest(page);
});

test("wrong passphrase is refused; answers remain encrypted", async ({ page }) => {
  const requests: string[] = [];

  await page.goto("/");
  const origin = new URL(page.url()).origin;
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== origin) {
      requests.push(`${r.method()} ${r.url()}`);
    }
  });

  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

  // Answer and set passphrase
  await page
    .getByRole("group", { name: "stmt-services-publics" })
    .getByRole("button", { name: "+3" })
    .click();

  const testPassphrase = "correct-passphrase-123";
  await page.fill('input[id="passphrase-input"]', testPassphrase);
  await page.fill('input[id="confirm-input"]', testPassphrase);
  await page.click('button[data-testid="submit-passphrase"]');

  // Verify passphrase gate disappears and questionnaire appears
  await expect(page.getByTestId("passphrase-gate")).not.toBeVisible();
  await expect(page.getByTestId("progress")).toContainText("1 / 4");

  // Reload and try wrong passphrase
  await page.reload();
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();

  const wrongPassphrase = "wrong-passphrase-456";
  await page.fill('input[id="passphrase-input"]', wrongPassphrase);
  await page.click('button[data-testid="submit-passphrase"]');

  // Error message appears, questionnaire remains hidden
  await expect(page.getByTestId("error-wrong-passphrase")).toBeVisible();
  await expect(page.getByTestId("passphrase-gate")).toBeVisible();
  await expect(page.getByTestId("state-stmt-services-publics")).not.toBeVisible();

  expect(requests).toEqual([]);
});

test("passphrase too short is rejected with feedback", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

  // Answer to trigger gate
  await page
    .getByRole("group", { name: "stmt-services-publics" })
    .getByRole("button", { name: "+3" })
    .click();

  await expect(page.getByTestId("passphrase-gate")).toBeVisible();

  // Try short passphrase
  const shortPass = "short";
  await page.fill('input[id="passphrase-input"]', shortPass);
  await page.fill('input[id="confirm-input"]', shortPass);

  // Submit button should be disabled
  const submitBtn = page.locator('button[data-testid="submit-passphrase"]');
  await expect(submitBtn).toBeDisabled();

  // An 8-char value is still below the 12-char minimum: submit stays disabled
  await page.fill('input[id="passphrase-input"]', "12345678");
  await page.fill('input[id="confirm-input"]', "12345678");
  await expect(submitBtn).toBeDisabled();

  // Fill to the minimum length (12 chars): submit becomes enabled
  const minPass = "123456789012";
  await page.fill('input[id="passphrase-input"]', minPass);
  await page.fill('input[id="confirm-input"]', minPass);
  await expect(submitBtn).toBeEnabled();
});

/**
 * Verify that the IndexedDB record is encrypted (EncryptedEnvelope shape) and
 * does NOT contain plaintext statement IDs or response values.
 */
async function verifyEncryptedAtRest(page: Page): Promise<void> {
  const record = await page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const req = indexedDB.open("libre-ai-boussole", 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("response-set", "readonly");
        const store = tx.objectStore("response-set");
        const get = store.get("current");
        get.onsuccess = () => {
          const record = get.result;
          if (record && typeof record.raw === "object" && record.raw !== null) {
            resolve(JSON.stringify(record.raw));
          } else if (record && typeof record.raw === "string") {
            resolve(record.raw);
          } else {
            reject(new Error("Record not found or invalid"));
          }
        };
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Parse the record
  let stored: unknown;
  try {
    stored = JSON.parse(record);
  } catch {
    // If it's not JSON, it's plaintext (bad)
    throw new Error(
      `Expected EncryptedEnvelope (JSON object), got plaintext or unparseable: ${record.substring(0, 50)}`,
    );
  }

  // Verify EncryptedEnvelope shape
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("version" in stored) ||
    !("salt" in stored) ||
    !("nonce" in stored) ||
    !("ciphertext" in stored) ||
    !("tag" in stored)
  ) {
    throw new Error(
      `Expected EncryptedEnvelope with version/salt/nonce/ciphertext/tag, got: ${JSON.stringify(stored)}`,
    );
  }

  // Type the record as EncryptedEnvelope after validation
  const envelope = stored as EncryptedEnvelope;

  // Confirm version is 1
  if (envelope.version !== 1) {
    throw new Error(`Expected version 1, got: ${envelope.version}`);
  }

  // Verify it does NOT contain plaintext statement IDs or response values
  const stringified = JSON.stringify(stored);
  if (stringified.includes("stmt-") || stringified.includes('"statementId"')) {
    throw new Error(
      `Stored data contains plaintext statement IDs, encryption may have failed: ${stringified}`,
    );
  }
}
