import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset", { data: {} });
});

test("pairs an iPhone through the guided browser flow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Connect your iPhone" })).toBeVisible();
  await page.getByRole("button", { name: "Scan for iPhone", exact: true }).last().click();
  await expect(page.getByText("Bluetooth scan finished.")).toBeVisible();

  const candidate = page.getByRole("button", { name: /Nearby Apple device Possible iPhone/ });
  await expect(candidate).toBeVisible();
  await expect(page.getByText("Bluetooth: ready")).toBeVisible();
  await candidate.click();
  await page.getByRole("button", { name: "Pair over Bluetooth" }).click();

  const dialog = page.getByRole("dialog", { name: "Does your iPhone show this code?" });
  await expect(dialog).toContainText("042731");
  await dialog.getByRole("button", { name: "Codes match" }).click();

  await expect(page.getByText("Pairing complete")).toBeVisible();
  await expect(page.getByText("Paired with someone’s iPhone.")).toBeVisible();
  await expect(page.getByText("Bluetooth: iPhone connected")).toBeVisible();
});

test("reports a rejected numeric comparison", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Scan for iPhone", exact: true }).last().click();
  await expect(page.getByText("Bluetooth scan finished.")).toBeVisible();
  await page.getByRole("button", { name: /Nearby Apple device Possible iPhone/ }).click();
  await page.getByRole("button", { name: "Pair over Bluetooth" }).click();

  const dialog = page.getByRole("dialog", { name: "Does your iPhone show this code?" });
  await dialog.getByRole("button", { name: "Cancel pairing" }).click();

  await expect(page.getByText("Pairing did not complete")).toBeVisible();
  await expect(page.getByText("Pairing was cancelled.")).toBeVisible();
});

test("forgets a bonded iPhone after confirmation", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { paired: true } });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Someone’s iPhone" })).toBeVisible();
  await page.getByRole("button", { name: "Forget iPhone" }).click();
  const dialog = page.getByRole("dialog", { name: "Forget Someone’s iPhone?" });
  await dialog.getByRole("button", { name: "Forget iPhone" }).click();

  await expect(page.getByText("iPhone forgotten")).toBeVisible();
  await expect(page.getByText("Forgot someone’s iPhone.")).toBeVisible();
});

test("surfaces a gateway command failure", async ({ page, request }) => {
  await page.goto("/");
  await request.post("/__test/fail-next-command");

  await page.getByRole("button", { name: "Scan for iPhone", exact: true }).last().click();

  await expect(page.getByText("Could not ask tetherd to scan.")).toBeVisible();
});
