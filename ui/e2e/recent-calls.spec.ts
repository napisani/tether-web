import { expect, test } from "@playwright/test";

test("recent history, guarded callback and favorite-first contacts", async ({ page, request }) => {
  const reset = await request.post("http://127.0.0.1:4174/__test/reset", {
    data: { withCalls: true, withContacts: true },
  });

  expect(reset.ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("img", { name: "Favorite" })).toBeVisible();
  await expect(page.locator(".contacts-list > li").first()).toContainText("Grace");
  await page.getByRole("button", { name: "Calls", exact: true }).click();
  await expect(page.getByRole("list", { name: "Recent calls" })).toHaveCount(0);
  await page.getByRole("button", { name: "Decline call with Ada" }).click();
  await page.getByRole("button", { name: "Hang up call with Withheld number" }).click();
  await expect(page.getByRole("list", { name: "Recent calls" })).toContainText("Recent Grace");
  await expect(page.getByRole("list", { name: "Recent calls" })).toContainText("Missed");
  await page.getByRole("button", { name: "Call back Recent Grace" }).click();
  await expect(page.getByRole("textbox", { name: "Number to call" })).toHaveValue("+15550103");
  await expect(page.getByText("Dialing", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check iPhone", exact: true })).toBeDisabled();
});
