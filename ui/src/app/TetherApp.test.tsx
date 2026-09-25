import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TetherApp } from "./TetherApp";
import { DaemonCommandTimeoutError } from "../daemon/DaemonClient";
import type { DaemonEvent } from "../protocol";
import { daemonCommandSchema } from "../protocolSchemas";

function parseCommandBody(body: string) {
  return daemonCommandSchema.parse(JSON.parse(body));
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(event: DaemonEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }

  fail() {
    this.onerror?.();
  }
}

function emitPairedPhone(events: FakeEventSource) {
  act(() => {
    events.emit({ command: "gateway_status", daemon_connected: true });
    events.emit({
      command: "protocol_info",
      version: 1,
      capabilities: ["bluetooth.pairing", "bluetooth.connection"],
    });
    events.emit({
      command: "bt_status",
      available: true,
      enabled: true,
      ancs_enabled: true,
      device_address: "40:F6:64:3D:7A:F1",
    });
    events.emit({
      command: "bt_devices",
      devices: [{
        address: "40:F6:64:3D:7A:F1",
        name: "Someone’s iPhone",
        iphone: true,
        paired: true,
        bonded: true,
        connected: true,
      }],
    });
    events.emit({
      command: "bt_connection_changed",
      classic_connected: true,
      le_connected: true,
      map_open: false,
      map_error: "forbidden",
      pbap_open: true,
      ancs_ready: false,
    });
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gateway event lifecycle", () => {
  it("uses the ordered event stream and recovers after EventSource reconnects", () => {
    const { unmount } = render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    expect(events.url).toBe("/api/v1/events");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Tether is reconnecting" })).toBeInTheDocument();

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({
        command: "protocol_info",
        version: 1,
        capabilities: ["bluetooth.pairing"],
      });
      events.emit({ command: "bt_status", available: true });
    });
    expect(screen.getByRole("heading", { name: "Connect your iPhone" })).toBeInTheDocument();

    act(() => events.fail());
    expect(screen.getByRole("heading", { name: "Tether is reconnecting" })).toBeInTheDocument();

    act(() => events.emit({ command: "gateway_status", daemon_connected: true }));
    expect(screen.getByRole("heading", { name: "Connect your iPhone" })).toBeInTheDocument();

    unmount();
    expect(events.closed).toBe(true);
  });

  it("does not offer Settings controls without the daemon capability, including across reconnect", () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    emitPairedPhone(events);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/does not advertise Settings support/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Mirror iPhone notifications/ })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => parseCommandBody(String(init?.body))))
      .not.toContainEqual({ command: "bt_set_ancs", enabled: false });

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: false });
      events.emit({ command: "gateway_status", daemon_connected: true });
    });
    expect(screen.getByText(/Checking tetherd Settings support/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => parseCommandBody(String(init?.body))))
      .not.toContainEqual({ command: "bt_set_ancs", enabled: false });

    act(() => {
      events.emit({ command: "protocol_info", version: 1, capabilities: ["settings"] });
      events.emit({ command: "bt_status", available: true, enabled: true, device_address: "40:F6:64:3D:7A:F1",
        ancs_enabled: true, ancs_content_enabled: true, calls_enabled: false, retention: "encrypted" });
    });
    expect(screen.getByRole("switch", { name: /Mirror iPhone notifications/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("switch", { name: /Mirror iPhone notifications/ }));
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => parseCommandBody(String(init?.body))))
      .toContainEqual({ command: "bt_set_ancs", enabled: false });
  });

  it("does not render retained conversations before current MAP readiness", () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["messages"] });
    });
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    act(() => events.emit({ command: "bt_threads", threads: [
      { thread: "tel:+15550102", name: "Previous phone private contact", preview: "Secret", unread: 2 },
    ] }));
    expect(screen.queryByText("Previous phone private contact")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    expect(screen.getByText("Messages are not connected.")).toBeInTheDocument();
    expect(screen.queryByText("Loading conversations…")).not.toBeInTheDocument();
    act(() => {
      events.emit({ command: "bt_connection_changed", map_open: true });
      events.emit({ command: "bt_threads", threads: [{ thread: "tel:+15550103", name: "Current phone" }] });
    });
    expect(screen.getByText("Current phone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Current phone/ }));
    act(() => events.emit({ command: "bt_connection_changed", map_open: false }));
    expect(screen.queryByText("tel:+15550103")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conversation unavailable" })).toBeInTheDocument();
    act(() => events.emit({ command: "gateway_status", daemon_connected: false }));
    expect(screen.queryByText("tel:+15550103")).not.toBeInTheDocument();
  });

  it("primes the unread badge on connection while Messages is hidden", () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["messages"] });
      events.emit({ command: "bt_connection_changed", map_open: true });
    });
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => parseCommandBody(String(init?.body))))
      .toContainEqual({ command: "bt_list_threads" });

    act(() => events.emit({ command: "bt_threads", threads: [
      { thread: "tel:+15550102", unread: 2 }, { thread: "tel:+15550103", unread: 1 },
    ] }));

    const messagesButton = within(screen.getByRole("navigation", { name: "Primary navigation" }))
      .getByRole("button", { name: "Messages" });

    expect(within(messagesButton).getByText("3")).toBeInTheDocument();

    const beforeRead = vi.mocked(fetch).mock.calls.filter(([, init]) => parseCommandBody(String(init?.body)).command === "bt_list_threads").length;

    act(() => events.emit({ command: "bt_message_read", handles: ["msg-1"], read: true, success: true }));
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => parseCommandBody(String(init?.body)).command === "bt_list_threads"))
      .toHaveLength(beforeRead + 1);

    act(() => events.emit({ command: "bt_threads", threads: [{ thread: "tel:+15550102", unread: 0 }] }));
    expect(within(messagesButton).queryByText("3")).not.toBeInTheDocument();
    act(() => events.emit({ command: "bt_threads", threads: [{ thread: "tel:+15550102", unread: 4 }] }));
    expect(within(messagesButton).getByText("4")).toBeInTheDocument();
    act(() => events.emit({ command: "gateway_status", daemon_connected: false }));
    expect(within(messagesButton).queryByText("4")).not.toBeInTheDocument();
  });

  it("keeps browser notification consent available even without daemon Settings support", () => {
    const browserApi = Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() });

    localStorage.clear();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("Notification", browserApi);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: [] });
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/does not advertise Settings support/)).toBeInTheDocument();
    const browserAlerts = screen.getByRole("switch", { name: /Notify when a new iPhone alert arrives/ });
    expect(browserAlerts).not.toBeChecked();
    fireEvent.click(browserAlerts);
    expect(browserAlerts).toBeChecked();
    expect(localStorage.getItem("tether-web:browser-notifications:v1")).toBe("enabled");
    browserApi.permission = "denied";
    act(() => window.dispatchEvent(new Event("focus")));
    expect(browserAlerts).not.toBeChecked();
    expect(browserAlerts).toBeDisabled();
    expect(screen.getByText(/Allow notifications for this origin/)).toBeInTheDocument();
    localStorage.clear();
  });

  it("routes a redacted browser alert back to Notifications", () => {
    let openNotification: () => void = () => { throw new Error("Expected a browser alert"); };

    const notifications: string[] = [];

    class BrowserAlert {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue("granted");
      onclick: (() => void) | null = null;
      close = vi.fn<() => void>();

      constructor(title: string, _options: NotificationOptions) {
        notifications.push(title);
        openNotification = () => this.onclick?.();
      }
    }

    localStorage.clear();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("Notification", BrowserAlert);
    vi.spyOn(window, "focus").mockImplementation(() => {});
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["notifications", "settings"] });
      events.emit({ command: "bt_status", available: true, ancs_enabled: true, device_address: "AA" });
      events.emit({ command: "bt_connection_changed", ancs_ready: true });
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: /Notify when a new iPhone alert arrives/ }));
    act(() => events.emit({ command: "bt_notification", uid: 44, title: "Private title", body: "Private body" }));
    expect(notifications).toEqual(["New iPhone notification"]);
    act(() => openNotification());
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    localStorage.clear();
  });

  it("hides Calls until enabled and follows GTK browser-safe navigation shortcuts", () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["messages", "contacts", "notifications", "settings"] });
      events.emit({ command: "bt_status", available: true, calls_enabled: false });
    });
    expect(screen.queryByRole("button", { name: "Calls" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "5", ctrlKey: true });
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "4", ctrlKey: true });
    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: ",", ctrlKey: true });
    expect(screen.getByRole("heading", { name: /^Settings$/ })).toBeInTheDocument();
    act(() => events.emit({ command: "bt_status", available: true, calls_enabled: true }));
    expect(screen.getByRole("button", { name: "Calls" })).toBeInTheDocument();

    const navOrder = within(screen.getByRole("navigation", { name: "Primary navigation" }))
      .getAllByRole("button").map((button) => button.textContent);

    expect(navOrder.indexOf("Contacts")).toBeLessThan(navOrder.indexOf("Calls"));
    fireEvent.keyDown(document, { key: "5", ctrlKey: true });
    expect(screen.getByRole("heading", { name: "Calls" })).toBeInTheDocument();
    act(() => events.emit({ command: "bt_status", available: true, calls_enabled: false }));
    expect(screen.queryByRole("button", { name: "Calls" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
  });

  it("hides the Calls route when the daemon disconnects despite a cached host setting", () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["calls"] });
      events.emit({ command: "bt_status", available: true, calls_enabled: true });
    });
    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    act(() => events.emit({ command: "gateway_status", daemon_connected: false }));
    expect(screen.queryByRole("button", { name: "Calls" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
  });

  it("opens compose and focuses search without stealing shortcuts from editable fields", () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["messages", "settings"] });
      events.emit({ command: "bt_connection_changed", map_open: true });
    });
    fireEvent.keyDown(document, { key: "n", metaKey: true });
    expect(screen.getByRole("heading", { name: "New message" })).toBeInTheDocument();
    const recipient = screen.getByRole("textbox", { name: "To" });
    expect(recipient).toHaveFocus();
    fireEvent.keyDown(recipient, { key: "1", metaKey: true });
    expect(screen.getByRole("heading", { name: "New message" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    const search = screen.getByRole("searchbox", { name: "Search conversations" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "3", ctrlKey: true });
    expect(search).toHaveFocus();
  });

  it("cancels in-flight pairing when the event stream disconnects", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 202 } as Response);
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["bluetooth.pairing"] });
      events.emit({ command: "bt_status", available: true });
      events.emit({
        command: "bt_devices",
        devices: [{ address: "40:F6:64:3D:7A:F1", apple_nearby: true }],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Pair over Bluetooth" }));
    const command = parseCommandBody(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));

    if (command.command !== "bt_pair") throw new Error("expected a pairing command");
    act(() => events.emit({
      command: "bt_pair_confirm_request",
      operation_id: command.operation_id,
      code: "042731",
    }));
    expect(screen.getByRole("dialog", { name: "Does your iPhone show this code?" })).toBeInTheDocument();

    act(() => events.fail());

    expect(screen.queryByRole("dialog", { name: "Does your iPhone show this code?" })).not.toBeInTheDocument();
    expect(screen.getByText("Connection to tetherd was lost. Try again after it reconnects.")).toBeInTheDocument();
  });

  it("refreshes Bluetooth state through existing daemon commands after pair or unpair completes", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 202 } as Response);
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    act(() => {
      events.emit({
        command: "bt_pair_result",
        operation_id: "pair-1",
        success: true,
        status: "paired",
        message: "Paired.",
      });
      events.emit({
        command: "bt_unpair_result",
        operation_id: "unpair-1",
        success: true,
        status: "unpaired",
        message: "Unpaired.",
      });
    });

    await waitFor(() => {
      const commands = vi.mocked(fetch).mock.calls.map(([, init]) => parseCommandBody(String(init?.body)));
      expect(commands.filter((command) => command.command === "bt_status")).toHaveLength(2);
      expect(commands.filter((command) => command.command === "bt_list_devices")).toHaveLength(2);
    });
  });

  it("times out an accepted pairing command when no terminal event arrives", () => {
    vi.useFakeTimers();

    try {
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 202 } as Response);
      render(<TetherApp />);
      const events = FakeEventSource.instances[0];
      act(() => {
        events.emit({ command: "gateway_status", daemon_connected: true });
        events.emit({ command: "protocol_info", version: 1, capabilities: ["bluetooth.pairing"] });
        events.emit({ command: "bt_status", available: true });
        events.emit({
          command: "bt_devices",
          devices: [{ address: "40:F6:64:3D:7A:F1", apple_nearby: true }],
        });
      });

      fireEvent.click(screen.getByRole("button", { name: "Pair over Bluetooth" }));
      act(() => vi.advanceTimersByTime(5 * 60_000));

      expect(screen.getByText("Timed out waiting for tetherd to finish Bluetooth pairing.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out an accepted unpair command when no terminal event arrives", () => {
    vi.useFakeTimers();

    try {
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 202 } as Response);
      render(<TetherApp />);
      const events = FakeEventSource.instances[0];
      emitPairedPhone(events);

      fireEvent.click(screen.getByRole("button", { name: "Forget iPhone" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Forget iPhone" }));
      act(() => vi.advanceTimersByTime(30_000));

      expect(screen.getByText("Timed out waiting for tetherd to remove the Bluetooth pairing.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears Bluetooth controls on a gateway disconnect event", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 202 } as Response);
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    emitPairedPhone(events);

    fireEvent.click(screen.getByRole("button", { name: "Show iPhone Permissions" }));
    expect(screen.getByText("Asking the iPhone to show its permissions…")).toBeInTheDocument();

    act(() => events.emit({ command: "gateway_status", daemon_connected: false }));
    expect(screen.getByRole("heading", { name: "Tether is reconnecting" })).toBeInTheDocument();
    act(() => events.emit({ command: "gateway_status", daemon_connected: true }));

    expect(screen.getByText("Bluetooth operation stopped while Tether reconnects.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show iPhone Permissions" })).toBeEnabled();
  });

  it("recovers a Bluetooth preference control after a gateway failure", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    emitPairedPhone(events);

    fireEvent.click(screen.getByRole("checkbox", { name: /Connect to this iPhone/ }));

    expect(parseCommandBody(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual({
      command: "bt_set_enabled",
      enabled: false,
    });
    expect(await screen.findByText("Could not update the Bluetooth preference.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Connect to this iPhone/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Connect to this iPhone/ })).toBeChecked();
  });

  it("releases permission solicitation after its result timeout", () => {
    vi.useFakeTimers();

    try {
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 202 } as Response);
      render(<TetherApp />);
      const events = FakeEventSource.instances[0];
      emitPairedPhone(events);

      fireEvent.click(screen.getByRole("button", { name: "Show iPhone Permissions" }));
      expect(parseCommandBody(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual({ command: "bt_solicit" });
      act(() => vi.advanceTimersByTime(60_000));

      expect(screen.getByText("No permission result arrived from tetherd. Check the iPhone, then try again.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show iPhone Permissions" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports command timeouts and clears the busy state", async () => {
    vi.mocked(fetch).mockRejectedValue(new DaemonCommandTimeoutError());
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({ command: "protocol_info", version: 1, capabilities: ["bluetooth.pairing"] });
      events.emit({ command: "bt_status", available: true });
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Scan for iPhone" }).at(-1)!);

    expect(await screen.findByText("Bluetooth scanning timed out.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Scan for iPhone" }).at(-1)).toBeEnabled();
  });

  it("shows command failures returned by the gateway", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({
        command: "protocol_info",
        version: 1,
        capabilities: ["bluetooth.pairing"],
      });
      events.emit({ command: "bt_status", available: true });
    });

    const scanButtons = screen.getAllByRole("button", { name: "Scan for iPhone" });
    fireEvent.click(scanButtons.at(-1)!);

    expect(await screen.findByText("Could not ask tetherd to scan.")).toBeInTheDocument();
  });
});
