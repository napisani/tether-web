import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotifications } from "./useNotifications";

const item = { uid: 42, app_id: "com.example.mail", app_name: "Mail", title: "New mail",
  body: "Hello", timestamp: 1_700_000_000, negative_action: true };

function commands() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 }))));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Notifications lifecycle", () => {
  it("refreshes when visible, after ANCS connects, and on live changes", () => {
    const { result, rerender } = renderHook(({ visible }) => useNotifications(visible), { initialProps: { visible: true } });
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    expect(commands()).toContainEqual({ command: "bt_list_notifications" });
    act(() => result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true }));
    expect(commands().filter((command) => command.command === "bt_list_notifications")).toHaveLength(2);
    act(() => result.current.handleEvent({ command: "bt_notifications", notifications: [item] }));
    expect(result.current.state).toMatchObject({ loaded: true, ready: true, items: [item] });
    act(() => result.current.handleEvent({ command: "bt_notification", ...item }));
    expect(commands().filter((command) => command.command === "bt_list_notifications")).toHaveLength(3);
    rerender({ visible: false });
    act(() => result.current.handleEvent({ command: "bt_notification_removed", uid: 42 }));
    expect(result.current.state.items).toHaveLength(0);
    expect(commands().filter((command) => command.command === "bt_list_notifications")).toHaveLength(3);
    rerender({ visible: true });
    expect(commands().filter((command) => command.command === "bt_list_notifications")).toHaveLength(4);
  });

  it("ignores delayed lists after daemon or ANCS loss until the phone is ready again", () => {
    const { result } = renderHook(() => useNotifications(false));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [item] });
    });
    expect(result.current.state.items).toEqual([item]);

    act(() => result.current.handleDisconnect());
    act(() => result.current.handleEvent({ command: "bt_notifications", notifications: [item] }));
    expect(result.current.state).toMatchObject({ items: [], loaded: false, ready: false });

    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true }));
    act(() => result.current.handleEvent({ command: "bt_notifications", notifications: [item] }));
    expect(result.current.state.items).toEqual([item]);
    act(() => result.current.dismiss(42));
    expect(result.current.state.pending[42]).toBe("waiting");

    act(() => result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: false,
      ancs_reason: "Notification access is unavailable." }));
    act(() => result.current.handleEvent({ command: "bt_notifications", notifications: [item] }));
    expect(result.current.state).toMatchObject({ items: [], loaded: false, ready: false, pending: {},
      reason: "Notification access is unavailable." });
    expect(result.current.state.error).toContain("may have reached");
  });

  it("does not restore a removed UID from an older list snapshot", () => {
    const { result } = renderHook(() => useNotifications(false));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [item] });
      result.current.handleEvent({ command: "bt_notification_removed", uid: 42 });
    });
    act(() => result.current.handleEvent({ command: "bt_notifications", notifications: [item,
      { uid: 43, title: "Another notification" }] }));
    expect(result.current.state.items).toEqual([{ uid: 43, title: "Another notification" }]);
    act(() => result.current.dismiss(42));
    expect(commands()).not.toContainEqual({ command: "bt_notification_action", uid: 42, action: "negative" });

    act(() => result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: false }));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true }));
    act(() => result.current.handleEvent({ command: "bt_notifications", notifications: [item] }));
    expect(result.current.state.items).toEqual([item]);
  });

  it("scopes dismissals by UID and waits for authoritative removal", () => {
    const { result } = renderHook(() => useNotifications(false));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [item] });
    });
    act(() => result.current.dismiss(42));
    expect(commands()).toContainEqual({ command: "bt_notification_action", uid: 42, action: "negative" });
    act(() => result.current.dismiss(42));
    expect(commands().filter((command) => command.command === "bt_notification_action")).toHaveLength(1);
    act(() => result.current.handleEvent({ command: "bt_notification_action_result", uid: 43, success: true }));
    expect(result.current.state.pending[42]).toBe("waiting");
    act(() => result.current.handleEvent({ command: "bt_notification_action_result", uid: 42, success: false }));
    expect(result.current.state.error).toContain("did not confirm");
    expect(result.current.state.pending[42]).toBe("uncertain");
    act(() => result.current.dismiss(42));
    expect(commands().filter((command) => command.command === "bt_notification_action")).toHaveLength(1);
    act(() => result.current.handleEvent({ command: "bt_notification_removed", uid: 42 }));
    expect(result.current.state.pending[42]).toBeUndefined();
    expect(result.current.state.items).toHaveLength(0);
  });

  it("keeps a successfully sent action disabled until the phone removes it", () => {
    const { result } = renderHook(() => useNotifications(false));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [item] });
    });
    act(() => result.current.dismiss(42));
    act(() => result.current.handleEvent({ command: "bt_notification_action_result", uid: 42, success: true }));
    expect(result.current.state.pending[42]).toBe("accepted");
    act(() => result.current.dismiss(42));
    expect(commands().filter((command) => command.command === "bt_notification_action")).toHaveLength(1);
    act(() => result.current.handleEvent({ command: "bt_notification_removed", uid: 42 }));
    expect(result.current.state.items).toHaveLength(0);
  });

  it("keeps an uncertain action disabled and clears stale notifications on disconnect", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotifications(false));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [item] });
    });
    act(() => result.current.dismiss(42));
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.state.pending[42]).toBe("uncertain");
    expect(result.current.state.error).toContain("check your iPhone");
    act(() => result.current.dismiss(42));
    expect(commands().filter((command) => command.command === "bt_notification_action")).toHaveLength(1);
    act(() => result.current.handleDisconnect());
    expect(result.current.state).toMatchObject({ loaded: false, ready: false, items: [], pending: {} });
    expect(result.current.state.error).toContain("may have reached");
    act(() => result.current.handleDisconnect());
    expect(result.current.state.error).toContain("may have reached");
    act(() => result.current.handleEvent({ command: "bt_notification_action_result", uid: 42, success: true }));
    expect(result.current.state.items).toHaveLength(0);
  });
});
