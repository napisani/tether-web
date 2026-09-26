import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";

// Only failure-path UI tests intercept a browser request. All ordinary
// commands, events, uploads, and assets go through the real Go gateway.
async function failNextCommand(page: Page, command: string) {
  const matcher = "**/api/v1/commands";

  const handler = async (route: Route) => {
    if (route.request().postDataJSON()?.command !== command) {
      await route.continue();

      return;
    }

    await route.fulfill({ status: 503, body: "tetherd is unavailable" });
    await page.unroute(matcher, handler);
  };

  await page.route(matcher, handler);
}

declare global {
  interface Window {
    __tetherTestAlerts: Array<{ title: string; body?: string }>;
  }
}

async function resetScenario(request: APIRequestContext, options: Record<string, boolean> = {}) {
  const response = await request.post("http://127.0.0.1:4174/__test/reset", { data: options });
  expect(response.status()).toBe(204); // The Go gateway observed the fresh socket snapshot.
}

test.beforeEach(async ({ request }) => {
  await resetScenario(request);
});

test("reads and replies to an iPhone conversation", async ({ page, request }) => {
  await resetScenario(request, { withMessages: true });
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

test("uses the brand mark favicon and explains the connection indicator", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const indicator = page.getByRole("img", { name: "No device connected" });
  await expect(indicator).toHaveAttribute("title", "No device connected");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const favicon = await request.get("/favicon.svg");
  expect(favicon.ok()).toBe(true);
  expect(await favicon.text()).toContain(">T</text>");

  await resetScenario(request, { paired: true });
  await page.reload();
  await expect(page.getByRole("img", { name: "Device connected" })).toHaveAttribute(
    "title",
    "Device connected",
  );
});

test("keeps mobile navigation and connection details usable after resizing", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Start on desktop before resizing to mobile");
  await resetScenario(request, { paired: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const nav = document.querySelector(".primary-nav");
        const selected = nav?.querySelector('[aria-current="page"]');

        if (!nav || !selected) return false;

        const bounds = nav.getBoundingClientRect();
        const selectedBounds = selected.getBoundingClientRect();

        return selectedBounds.left >= bounds.left && selectedBounds.right <= bounds.right;
      }),
    )
    .toBe(true);
  await expect(page.locator(".nav-rail")).toHaveAttribute("data-scroll-left", "true");
  const navPosition = await page.locator(".primary-nav").evaluate((element) => element.scrollLeft);
  await page.getByRole("button", { name: "Scroll navigation left" }).click();
  await expect
    .poll(() => page.locator(".primary-nav").evaluate((element) => element.scrollLeft))
    .toBeLessThan(navPosition);
  await expect(page.getByRole("button", { name: "Scroll navigation right" })).toBeVisible();

  const row = page
    .locator(".settings-row")
    .filter({ has: page.getByRole("switch", { name: /Notify when a new iPhone alert arrives/ }) });

  const alignment = await row.evaluate((element) => {
    const text = element.firstElementChild?.getBoundingClientRect();
    const control = element.lastElementChild?.getBoundingClientRect();

    return { textTop: text?.top, controlTop: control?.top, controlWidth: control?.width };
  });

  expect(alignment.controlTop).toBe(alignment.textTop);
  expect(alignment.controlWidth).toBeGreaterThanOrEqual(44);

  const footer = page.locator(".route-status-bar");
  await expect(footer.locator("summary")).toContainText("iPhone connected");
  expect(
    await footer.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(52);
  await footer.locator("summary").click();
  await expect(
    footer.locator(".mobile-status-details").getByText("Bluetooth: iPhone connected"),
  ).toBeVisible();
});

test("keeps long conversations in two independent viewport-height scroll panes", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Desktop uses the side-by-side conversation layout",
  );
  await page.setViewportSize({ width: 1882, height: 1876 });
  await resetScenario(request, { withMessages: true, longMessages: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Messages" }).click();
  await page.getByRole("button", { name: /Ada See you soon/ }).click();
  await expect(page.getByLabel("Received: Test message 81")).toBeVisible();
  await expect(page.locator(".messages-history .message-row.outgoing")).toHaveCount(40);

  const threads = page.locator(".messages-threads");
  const history = page.getByRole("list", { name: "Messages in conversation" });

  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const layout = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell")!;
    const sidebar = document.querySelector(".messages-sidebar")!;
    const list = document.querySelector(".messages-threads")!;
    const conversation = document.querySelector(".messages-history")!;
    const footer = document.querySelector(".route-status-bar")!;

    return {
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      shellHeight: shell.getBoundingClientRect().height,
      sidebarHeight: sidebar.getBoundingClientRect().height,
      footerBottom: footer.getBoundingClientRect().bottom,
      threadsScrollable: list.scrollHeight > list.clientHeight,
      historyScrollable: conversation.scrollHeight > conversation.clientHeight,
      distanceFromLatest:
        conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop,
    };
  });

  expect(layout.pageHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.shellHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.sidebarHeight).toBeLessThan(layout.viewportHeight);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.threadsScrollable).toBe(true);
  expect(layout.historyScrollable).toBe(true);
  expect(layout.distanceFromLatest).toBeLessThan(2);

  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const focused = document.activeElement;

    if (focused instanceof HTMLElement) focused.blur();
  });

  const restingScrollbar = await threads.evaluate(
    (element) => getComputedStyle(element).scrollbarColor,
  );

  expect(restingScrollbar).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))/);
  await threads.hover();
  expect(await threads.evaluate((element) => getComputedStyle(element).scrollbarColor)).not.toBe(
    restingScrollbar,
  );
  await page.mouse.move(0, 0);

  await page.getByRole("textbox", { name: "Message" }).fill("Final test reply");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Sent: Final test reply")).toBeVisible();
  await expect
    .poll(() =>
      history.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(2);

  const originalHistoryScroll = await history.evaluate((element) => element.scrollTop);
  expect(
    await threads.evaluate((element) => {
      element.scrollTop = 180;

      return element.scrollTop;
    }),
  ).toBeGreaterThan(0);
  expect(await history.evaluate((element) => element.scrollTop)).toBe(originalHistoryScroll);
  await history.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(await threads.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(threads).toHaveAttribute("data-scrolling", "true");
  await expect(threads).not.toHaveAttribute("data-scrolling");
});

test("opens a long mobile conversation at the latest message without page scrolling", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile shows one messages pane at a time");
  await resetScenario(request, { withMessages: true, longMessages: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Messages" }).click();
  const threads = page.locator(".messages-threads");
  await expect
    .poll(() => threads.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: /Ada See you soon/ }).click();
  const history = page.getByRole("list", { name: "Messages in conversation" });
  await expect(page.getByLabel("Received: Test message 81")).toBeVisible();
  await expect
    .poll(() =>
      history.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight + 2),
  );
  await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible();
});

test("keeps a global unread badge in sync while the Messages view is hidden", async ({
  page,
  request,
}) => {
  await resetScenario(request, { withMessages: true });
  await page.goto("/");
  const messages = page.getByRole("button", { name: "Messages" });
  await expect(messages).toBeVisible();
  await expect(messages.locator(".nav-unread")).toHaveText("1");
  await expect(page.locator("#messages-nav-unread")).toHaveCSS("clip-path", "inset(50%)");
  await messages.click();
  await page.getByRole("button", { name: /Ada See you soon/ }).click();
  await expect(messages.locator(".nav-unread")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Messages" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Notifications" })).toBeFocused();
});

test("opt-in browser alerts redact iPhone content and ignore repeated events", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { value: true });
    Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
    window.__tetherTestAlerts = [];

    class BrowserAlert {
      static permission = "granted";
      static requestPermission() {
        return Promise.resolve("granted");
      }
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions) {
        window.__tetherTestAlerts.push({ title, body: options.body });
      }
      close() {}
    }

    Object.defineProperty(window, "Notification", { value: BrowserAlert });
  });
  await resetScenario(request, { paired: true, withNotifications: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const alerts = page.getByRole("switch", { name: /Notify when a new iPhone alert arrives/ });
  await expect(alerts).not.toBeChecked();
  await alerts.click();
  await expect(alerts).toBeChecked();
  expect(await page.evaluate(() => window.__tetherTestAlerts)).toEqual([]);

  const response = await request.post("http://127.0.0.1:4174/__test/emit-notification", {
    data: { uid: 101, title: "Secret title", body: "Secret body" },
  });

  expect(response.status()).toBe(204);
  await expect
    .poll(() => page.evaluate(() => window.__tetherTestAlerts))
    .toEqual([{ title: "New iPhone notification", body: "Open Tether to view it." }]);
  await request.post("http://127.0.0.1:4174/__test/emit-notification", {
    data: { uid: 101, title: "Secret duplicate" },
  });
  expect(await page.evaluate(() => window.__tetherTestAlerts)).toHaveLength(1);
});

test("searches iPhone contacts and opens an existing or new message thread", async ({
  page,
  request,
}) => {
  await resetScenario(request, { withMessages: true, withContacts: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("Grace")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search contacts" }).fill("ada@example");
  await expect(page.getByText("Ada", { exact: true })).toBeVisible();
  await expect(page.getByText("Grace")).not.toBeVisible();
  await page.getByText("Ada", { exact: true }).click();
  await page.getByRole("button", { name: "Message +15550102" }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByLabel("Received: See you soon")).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Contacts" }).click();
  await page.getByRole("searchbox", { name: "Search contacts" }).fill("Grace");
  await page.getByText("Grace", { exact: true }).click();
  await page.getByRole("button", { name: "Message +15550103" }).click();
  await expect(page.getByRole("heading", { name: "Grace" })).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
});

test("changes host settings without treating them as browser-only preferences", async ({
  page,
  request,
}) => {
  await resetScenario(request, { paired: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText(/affect every Tether client/)).toBeVisible();
  const mirror = page.getByRole("switch", { name: /Mirror iPhone notifications/ });
  const content = page.getByRole("switch", { name: /Include notification text/ });
  await expect(mirror).toBeChecked();
  await mirror.click();
  await expect(mirror).not.toBeChecked();
  await expect(content).toBeDisabled();
  await mirror.click();
  await expect(content).toBeEnabled();
  await content.click();
  await expect(content).not.toBeChecked();
  const retention = page.getByRole("combobox", { name: "Keep message history" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await retention.selectOption("none");
  await expect(retention).toHaveValue("encrypted");
  page.once("dialog", (dialog) => dialog.accept());
  await retention.selectOption("plaintext");
  await expect(retention).toHaveValue("plaintext");
  await expect(page.getByText(/readable on the tetherd host/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(retention).toHaveValue("plaintext");
  await expect(page.getByText(/have no browser equivalent/)).toBeVisible();
});

test("lists and dismisses an iPhone notification", async ({ page, request }) => {
  await resetScenario(request, { withNotifications: true });
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
  await resetScenario(request, { withCalls: true });
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
  const mobileStatus = page.locator(".mobile-route-status");

  if (await mobileStatus.isVisible()) await mobileStatus.locator("summary").click();

  await expect(
    page.locator(".route-status-bar .route-status:visible").filter({ hasText: "Bluetooth: ready" }),
  ).toBeVisible();
  await candidate.click();
  await page.getByRole("button", { name: "Pair over Bluetooth" }).click();

  const dialog = page.getByRole("dialog", { name: "Does your iPhone show this code?" });
  await expect(dialog).toContainText("042731");
  await dialog.getByRole("button", { name: "Codes match" }).click();

  await expect(page.getByText("Pairing complete")).toBeVisible();
  await expect(page.getByText("Paired with someone’s iPhone.")).toBeVisible();
  await expect(
    page
      .locator(".route-status-bar .route-status:visible")
      .filter({ hasText: "Bluetooth: iPhone connected" }),
  ).toBeVisible();
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
  await resetScenario(request, { paired: true });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Someone’s iPhone" })).toBeVisible();
  await page.getByRole("button", { name: "Forget iPhone" }).click();
  const dialog = page.getByRole("dialog", { name: "Forget Someone’s iPhone?" });
  await dialog.getByRole("button", { name: "Forget iPhone" }).click();

  await expect(page.getByText("iPhone forgotten")).toBeVisible();
  await expect(page.getByText("Forgot someone’s iPhone.")).toBeVisible();
});

test("discovers a Wi-Fi peer after connecting to tetherd", async ({ page, request }) => {
  await resetScenario(request, { discoverPeer: true });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Nearby phone" })).toBeVisible();
  await expect(page.getByText("peer-1")).toBeVisible();
});

test("approves and forgets a Wi-Fi peer", async ({ page, request }) => {
  await resetScenario(request, { withPeer: true });
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
  await resetScenario(request, { withPeer: true });
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
  await resetScenario(request, { withPeer: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Approve and trust" }).click();
  await page.getByLabel("Choose files to send").setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("one") },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("two") },
  ]);
  await expect(page.getByText("Sent 2 of 2 files.")).toBeVisible();
  await expect(page.getByText("2 sent · 0 failed · 0 skipped · 0 queued")).toBeVisible();
});

test("accepts multiple dropped files and reports skipped non-file items", async ({
  page,
  request,
}) => {
  await resetScenario(request, { withPeer: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Approve and trust" }).click();
  await page.locator(".file-drop-zone").evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["one"], "dropped.txt", { type: "text/plain" }));
    transfer.items.add("https://example.invalid/", "text/uri-list");
    zone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await expect(page.getByText("Sent 1 of 1 file. Skipped 1 non-file item.")).toBeVisible();
});

test("guides Bluetooth setup and permission recovery", async ({ page, request }) => {
  await resetScenario(request, { paired: true, bluetoothSetup: true });
  await page.goto("/");

  await expect(
    page.getByText("Compatibility mode — messages and contacts, no notification mirroring."),
  ).toBeVisible();
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
  await resetScenario(request, { paired: true, bluetoothSetup: true });
  await page.goto("/");
  await failNextCommand(page, "bt_set_enabled");

  const enabled = page.getByRole("checkbox", { name: /Connect to this iPhone/ });
  await enabled.click();

  await expect(page.getByText("Could not update the Bluetooth preference.")).toBeVisible();
  await expect(enabled).toBeChecked();
  await expect(enabled).toBeEnabled();

  await failNextCommand(page, "bt_solicit");
  await page.getByRole("button", { name: "Show iPhone Permissions" }).click();
  await expect(page.getByText("Could not ask the iPhone for permissions.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show iPhone Permissions" })).toBeEnabled();
});

test("manages connected AirPods", async ({ page, request }) => {
  await resetScenario(request, { withAirPods: true });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AirPods Pro" })).toBeVisible();
  await expect(page.getByText("Left earbud 82% · Right earbud 79% · Case 45%")).toBeVisible();
  await page.getByRole("button", { name: "Noise Cancellation" }).click();
  await expect(page.getByRole("button", { name: "Noise Cancellation" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("combobox", { name: "Pause playback when" }).selectOption("both-removed");
  await expect(page.getByRole("combobox", { name: "Pause playback when" })).toHaveValue(
    "both-removed",
  );
  await page.getByRole("checkbox", { name: /Hand the AirPods/ }).click();
  await expect(page.getByRole("checkbox", { name: /Hand the AirPods/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Manage AirPods/ }).click();
  await expect(page.getByRole("button", { name: "Noise Cancellation" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Manage AirPods/ }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
});

test("keeps desktop Devices list and detail independently scrollable below the header", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop has a two-pane device layout");
  await page.setViewportSize({ width: 1280, height: 420 });
  await resetScenario(request, { paired: true, withPeer: true });
  await page.goto("/");

  const list = page.locator(".device-list");
  const detail = page.locator(".device-pane");
  await expect(page.getByRole("button", { name: "Scan for devices" })).toHaveCount(1);
  const status = page.getByRole("region", { name: "Current status" });
  await expect(status.locator(".status-channel")).toHaveCount(2);
  await expect(status.locator(".status-channel").first()).toContainText("Messages");
  await expect(status.locator(".status-channel").last()).toContainText("Notifications");
  await expect
    .poll(() => list.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);
  await expect
    .poll(() => detail.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);

  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    footer: document.querySelector(".route-status-bar")!.getBoundingClientRect().bottom,
  }));

  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 2);
  expect(dimensions.footer).toBeLessThanOrEqual(dimensions.viewport + 2);

  await list.evaluate((element) => {
    element.scrollTop = 120;
  });
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await detail.evaluate((element) => element.scrollTop)).toBe(0);

  const listTop = await list.evaluate((element) => element.scrollTop);
  await detail.evaluate((element) => {
    element.scrollTop = 120;
  });
  await expect.poll(() => detail.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(listTop);
});

test("keeps mobile Devices content in the normal page flow", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Desktop scrolls within its panes");
  await page.setViewportSize({ width: 390, height: 450 });
  await resetScenario(request, { paired: true });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeGreaterThan(0);
});

test("keeps device controls and dialogs usable at the configured viewport", async ({
  page,
  request,
}) => {
  await resetScenario(request, { paired: true, bluetoothSetup: true });
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

test("surfaces a gateway command failure", async ({ page }) => {
  await page.goto("/");
  await failNextCommand(page, "bt_scan");

  await page.getByRole("button", { name: "Scan for iPhone", exact: true }).last().click();

  await expect(page.getByText("Could not ask tetherd to scan.")).toBeVisible();
});
