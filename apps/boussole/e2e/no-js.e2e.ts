import { expect, test } from "@playwright/test";

test("the questionnaire baseline is usable without JavaScript", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Boussole");
  await expect(page.getByText("Rien n'est transmis")).toBeVisible();
  await expect(page.getByTestId("progress")).toContainText("0 / 4");
  // Interactive answer controls are enhanced-only: not operable without JS.
  await expect(page.getByRole("button", { name: "Passer" })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-hydrated", "true");
});
