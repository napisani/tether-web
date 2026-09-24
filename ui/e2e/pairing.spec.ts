import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset", { data: {} });
});

test("reads and replies to an iPhone conversation", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withMessages: true } });
  await page.goto("/");
  await page.getByRole("button", { name: "Messages" }).click();
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  await page.getByRole("button", { name: /Ada See you soon/ }).click();
  await expect(page.getByLabel("Received: See you soon")).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("On my way");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Sent: On my way")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("");
});

test("lists and dismisses an iPhone notification", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withNotifications: true } });
  await page.goto("/");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("A letter")).toBeVisible();
  await expect(page.getByText("Hello from your iPhone")).toBeVisible();
  await expect(page.getByText("Appointment")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss Mail notification on iPhone" }).click();
  await expect(page.getByText("A letter")).not.toBeVisible();
  await expect(page.getByText("Appointment")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Appointment")).toBeVisible();
});

test("controls iPhone calls without claiming browser audio", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withCalls: true } });
  await page.goto("/");
  await page.getByRole("button", { name: "Calls" }).click();
  await expect(page.getByRole("button", { name: "Calls" })).toBeInViewport({ ratio: 0.98 });
  await expect(page.getByText("Ada")).toBeVisible();
  await expect(page.getByText("Withheld number")).toBeVisible();
  await expect(page.getByText(/not in this browser/)).toBeVisible();
  await page.getByRole("button", { name: "Answer call from Ada" }).click();
  await expect(page.getByRole("button", { name: "Hang up call with Ada" })).toBeVisible();
  await page.getByRole("button", { name: "Audio on tetherd host" }).click();
  await expect(page.getByRole("button", { name: "Audio on iPhone" })).toBeVisible();
  await page.getByRole("textbox", { name: "Number to call" }).fill("+15550109");
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(page.getByText("+15550109")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check iPhone" })).toBeDisabled();
  await page.getByRole("button", { name: "Hang up call with Ada" }).click();
  await expect(page.getByText("Ada")).not.toBeVisible();
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

test("discovers a Wi-Fi peer after connecting to tetherd", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { discoverPeer: true } });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Nearby phone" })).toBeVisible();
  await expect(page.getByText("peer-1")).toBeVisible();
});

test("approves and forgets a Wi-Fi peer", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withPeer: true } });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Nearby phone" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and trust" }).click();
  await expect(page.getByRole("button", { name: "Forget device" })).toBeVisible();
  await page.getByRole("button", { name: "Forget device" }).click();
  const dialog = page.getByRole("dialog", { name: "Forget Nearby phone?" });
  await dialog.getByRole("button", { name: "Forget device" }).click();
  await expect(page.getByRole("status").getByText("Device forgotten.")).toBeVisible();
});

test("sends a browser file to a trusted peer", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withPeer: true } });
  await page.goto("/");
  await page.getByRole("button", { name: "Approve and trust" }).click();
  await expect(page.getByRole("heading", { name: "Send files" })).toBeVisible();

  await page.getByLabel("Choose files to send").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from tether-web"),
  });

  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(page.getByText("File sent.")).toBeVisible();
});

test("sends a batch sequentially", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withPeer: true } });
  await page.goto("/");
  await page.getByRole("button", { name: "Approve and trust" }).click();
  await page.getByLabel("Choose files to send").setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("one") },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("two") },
  ]);
  await expect(page.getByText("Sent 2 of 2 files.")).toBeVisible();
  await expect(page.getByText("2 sent · 0 failed · 0 skipped · 0 queued")).toBeVisible();
});

test("accepts multiple dropped files and reports skipped non-file items", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withPeer: true } });
  await page.goto("/");
  await page.getByRole("button", { name: "Approve and trust" }).click();
  await page.locator(".file-drop-zone").evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["one"], "dropped.txt", { type: "text/plain" }));
    transfer.items.add("https://example.invalid/", "text/uri-list");
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByText("Sent 1 of 1 file. Skipped 1 non-file item.")).toBeVisible();
});

test("guides Bluetooth setup and permission recovery", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { paired: true, bluetoothSetup: true } });
  await page.goto("/");

  await expect(page.getByText("Compatibility mode — messages and contacts, no notification mirroring.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bluetooth setup needed" })).toBeVisible();
  await expect(page.getByText("sudo systemctl restart bluetooth")).toBeVisible();

  const enabled = page.getByRole("checkbox", { name: /Connect to this iPhone/ });
  await enabled.uncheck();
  await expect(enabled).not.toBeChecked();
  await expect(page.getByText("Bluetooth connection preference updated.")).toBeVisible();
  await enabled.check();
  await expect(enabled).toBeChecked();

  await page.getByRole("button", { name: "Show iPhone Permissions" }).click();
  await expect(page.getByText(/re-offer notification access/)).toBeVisible();
});

test("recovers a Bluetooth control after a gateway failure", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { paired: true, bluetoothSetup: true } });
  await page.goto("/");
  await request.post("/__test/fail-next-command", { data: { command: "bt_set_enabled" } });

  const enabled = page.getByRole("checkbox", { name: /Connect to this iPhone/ });
  await enabled.click();

  await expect(page.getByText("Could not update the Bluetooth preference.")).toBeVisible();
  await expect(enabled).toBeChecked();
  await expect(enabled).toBeEnabled();

  await request.post("/__test/fail-next-command", { data: { command: "bt_solicit" } });
  await page.getByRole("button", { name: "Show iPhone Permissions" }).click();
  await expect(page.getByText("Could not ask the iPhone for permissions.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show iPhone Permissions" })).toBeEnabled();
});

test("manages connected AirPods", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { withAirPods: true } });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AirPods Pro" })).toBeVisible();
  await expect(page.getByText("Left earbud 82% · Right earbud 79% · Case 45%")).toBeVisible();
  await page.getByRole("button", { name: "Noise Cancellation" }).click();
  await expect(page.getByRole("button", { name: "Noise Cancellation" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Pause playback when" }).selectOption("both-removed");
  await expect(page.getByRole("combobox", { name: "Pause playback when" })).toHaveValue("both-removed");
  await page.getByRole("checkbox", { name: /Hand the AirPods/ }).click();
  await expect(page.getByRole("checkbox", { name: /Hand the AirPods/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Manage AirPods/ }).click();
  await expect(page.getByRole("button", { name: "Noise Cancellation" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Manage AirPods/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
});

test("keeps device controls and dialogs usable at the configured viewport", async ({ page, request }) => {
  await request.post("/__test/reset", { data: { paired: true, bluetoothSetup: true } });
  await page.goto("/");

  const viewport = page.viewportSize();
  const list = await page.locator(".device-list-pane").boundingBox();
  const pane = await page.locator(".device-pane").boundingBox();
  expect(viewport).not.toBeNull();
  expect(list).not.toBeNull();
  expect(pane).not.toBeNull();

  if (viewport!.width <= 820) {
    expect(list!.y + list!.height).toBeLessThanOrEqual(pane!.y + 1);
  } else {
    expect(list!.x + list!.width).toBeLessThanOrEqual(pane!.x + 1);
  }

  await page.getByRole("button", { name: "Forget iPhone" }).click();
  const dialog = page.getByRole("dialog", { name: "Forget Someone’s iPhone?" });
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
});

test("surfaces a gateway command failure", async ({ page, request }) => {
  await page.goto("/");
  await request.post("/__test/fail-next-command", { data: { command: "bt_scan" } });

  await page.getByRole("button", { name: "Scan for iPhone", exact: true }).last().click();

  await expect(page.getByText("Could not ask tetherd to scan.")).toBeVisible();
});
