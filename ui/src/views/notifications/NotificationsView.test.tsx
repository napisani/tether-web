import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TetherApp } from "../../app/TetherApp";
import type { DaemonEvent } from "../../protocol";

class FakeEventSource {
  static current: FakeEventSource;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;

  constructor() { FakeEventSource.current = this; }
  close() {}
  emit(event: DaemonEvent) { this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>); }
}

function commands() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

function connect(available = true) {
  act(() => {
    FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: true });
    FakeEventSource.current.emit({ command: "protocol_info", version: 1, capabilities: available ? ["notifications"] : [] });
  });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Notifications view", () => {
  it("gates an unavailable daemon and explains ANCS permission recovery", () => {
    render(<TetherApp />);
    connect(false);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText(/does not advertise Notifications support/)).toBeInTheDocument();
    expect(commands()).not.toContainEqual({ command: "bt_list_notifications" });
    connect();
    act(() => FakeEventSource.current.emit({ command: "bt_connection_changed", ancs_ready: false,
      ancs_reason: "Enable Show Notifications in iPhone Bluetooth settings." }));
    expect(commands()).toContainEqual({ command: "bt_list_notifications" });
    expect(screen.getByText("Enable Show Notifications in iPhone Bluetooth settings.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "open Devices" }));
    expect(screen.getByRole("button", { name: "Devices" })).toHaveAttribute("aria-current", "page");
  });

  it("shows source and content, and keeps attempted dismissals disabled until removal", () => {
    render(<TetherApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    act(() => {
      FakeEventSource.current.emit({ command: "bt_connection_changed", ancs_ready: true });
      FakeEventSource.current.emit({ command: "bt_notifications", notifications: [
        { uid: 42, app_name: "Mail", app_id: "com.example.mail", title: "A letter", subtitle: "Sender",
          body: "Hello <friend>", timestamp: 1_700_000_000, negative_action: true },
        { uid: 43, app_name: "Calendar", body: "Appointment", negative_action: false },
        { uid: 44, app_id: "com.example.hidden", negative_action: false },
        { uid: 45, app_name: "Reminders", title: "Buy milk", negative_action: true },
        { uid: 46, app_name: "Future", title: "Odd date", timestamp: Number.MAX_SAFE_INTEGER },
      ] });
    });
    expect(screen.getByText("A letter")).toBeInTheDocument();
    expect(screen.getByText("Sender")).toBeInTheDocument();
    expect(screen.getByText("Hello <friend>")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss Calendar/ })).not.toBeInTheDocument();
    expect(screen.getByText("com.example.hidden")).toBeInTheDocument();
    expect(screen.getByText("New notification")).toBeInTheDocument();
    expect(screen.getByLabelText("Future: Odd date").querySelector("time")).toBeNull();
    const dismiss = screen.getByRole("button", { name: "Dismiss Mail notification on iPhone" });
    fireEvent.click(dismiss);
    expect(commands()).toContainEqual({ command: "bt_notification_action", uid: 42, action: "negative" });
    expect(dismiss).toBeDisabled();
    act(() => FakeEventSource.current.emit({ command: "bt_notification_action_result", uid: 43, success: true }));
    expect(dismiss).toBeDisabled();
    act(() => FakeEventSource.current.emit({ command: "bt_notification_action_result", uid: 42, success: false }));
    expect(screen.getByRole("alert")).toHaveTextContent("The iPhone did not confirm the dismissal.");
    expect(dismiss).toBeDisabled();
    const reminder = screen.getByRole("button", { name: "Dismiss Reminders notification on iPhone" });
    fireEvent.click(reminder);
    act(() => FakeEventSource.current.emit({ command: "bt_notification_action_result", uid: 45, success: true }));
    expect(reminder).toBeDisabled();
    act(() => FakeEventSource.current.emit({ command: "bt_notification_removed", uid: 45 }));
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("hides old content when ANCS becomes unavailable, including delayed list results", () => {
    render(<TetherApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    act(() => {
      FakeEventSource.current.emit({ command: "bt_connection_changed", ancs_ready: true });
      FakeEventSource.current.emit({ command: "bt_notifications", notifications: [{ uid: 1, title: "Private text" }] });
    });
    expect(screen.getByText("Private text")).toBeInTheDocument();
    act(() => FakeEventSource.current.emit({ command: "bt_connection_changed", ancs_ready: false,
      ancs_reason: "Notification access is unavailable." }));
    act(() => FakeEventSource.current.emit({ command: "bt_notifications", notifications: [{ uid: 1, title: "Private text" }] }));
    expect(screen.queryByText("Private text")).not.toBeInTheDocument();
    expect(screen.getByText("Notification access is unavailable.")).toBeInTheDocument();
  });

  it("clears private rows on disconnect and shows an empty state after refresh", () => {
    render(<TetherApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    act(() => {
      FakeEventSource.current.emit({ command: "bt_connection_changed", ancs_ready: true });
      FakeEventSource.current.emit({ command: "bt_notifications", notifications: [{ uid: 1, app_name: "Mail", title: "Secret" }] });
    });
    expect(screen.getByText("Secret")).toBeInTheDocument();
    act(() => FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: false }));
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    expect(screen.getByText("Reconnect to tetherd to load notifications.")).toBeInTheDocument();
    act(() => FakeEventSource.current.emit({ command: "bt_notifications", notifications: [{ uid: 1, title: "Secret" }] }));
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    act(() => {
      FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: true });
      FakeEventSource.current.emit({ command: "bt_connection_changed", ancs_ready: true });
      FakeEventSource.current.emit({ command: "bt_notifications", notifications: [] });
    });
    expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
  });
});
