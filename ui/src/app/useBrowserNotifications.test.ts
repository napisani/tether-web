import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserNotifications } from "./useBrowserNotifications";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("isSecureContext", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("browser notification preference", () => {
  it("only announces a live hidden-page ANCS event, redacted and deduplicated", async () => {
    const created: Array<{ title: string; options: NotificationOptions; onclick: (() => void) | null; close: () => void }> = [];

    class FakeNotification {
      static permission: NotificationPermission = "granted";
      title: string;
      options: NotificationOptions;
      onclick: (() => void) | null = null;
      close = vi.fn<() => void>();

      constructor(title: string, options: NotificationOptions) {
        this.title = title;
        this.options = options;
        created.push(this);
      }
    }

    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.spyOn(window, "focus").mockImplementation(() => {});
    const onOpen = vi.fn<() => void>();
    const { result } = renderHook(() => useBrowserNotifications(onOpen));
    await act(async () => result.current.enable());
    act(() => {
      result.current.handleEvent({ command: "gateway_status", daemon_connected: true });
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: true, device_address: "AA" });
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [{ uid: 3, title: "Private initial" }] });
      result.current.handleEvent({ command: "bt_notification", uid: 3, title: "Private replay" });
      result.current.handleEvent({ command: "bt_notification", uid: 4, title: "Private title", body: "Private body" });
      result.current.handleEvent({ command: "bt_notification", uid: 4, title: "Private duplicate" });
    });
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("New iPhone notification");
    expect(created[0].options.body).toBe("Open Tether to view it.");
    created[0].onclick?.();
    expect(onOpen).toHaveBeenCalledOnce();
    act(() => result.current.handleDisconnect());
    act(() => result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true }));
    act(() => result.current.handleEvent({ command: "bt_notification", uid: 5, title: "After disconnect" }));
    expect(created).toHaveLength(1);
  });

  it("stops alerts on ANCS disable, device change, or Bluetooth loss until a fresh ready status", async () => {
    const browserApi = Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("Notification", browserApi);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { result } = renderHook(() => useBrowserNotifications(vi.fn()));
    await act(async () => result.current.enable());
    act(() => {
      result.current.handleEvent({ command: "gateway_status", daemon_connected: true });
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notifications", notifications: [{ uid: 7, title: "Historical" }] });
      result.current.handleEvent({ command: "bt_notification", uid: 0 });
    });
    expect(browserApi).not.toHaveBeenCalled();
    act(() => {
      result.current.handleEvent({ command: "bt_status", available: true, enabled: true,
        ancs_enabled: true, device_address: "AA" });
      result.current.handleEvent({ command: "bt_notification", uid: 7 });
    });
    expect(browserApi).not.toHaveBeenCalled();
    act(() => {
      result.current.handleEvent({ command: "bt_notification", uid: 1 });
    });
    expect(browserApi).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: false, device_address: "AA" });
      result.current.handleEvent({ command: "bt_notification", uid: 2 });
    });
    expect(browserApi).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: true, device_address: "BB" });
      result.current.handleEvent({ command: "bt_notification", uid: 3 });
    });
    expect(browserApi).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notification", uid: 4 });
    });
    expect(browserApi).toHaveBeenCalledTimes(2);
    act(() => {
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: true, device_address: "CC" });
      result.current.handleEvent({ command: "bt_notification", uid: 5 });
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_status", available: false, ancs_enabled: true, device_address: "CC" });
      result.current.handleEvent({ command: "bt_notification", uid: 6 });
    });
    expect(browserApi).toHaveBeenCalledTimes(2);
  });

  it("requires fresh ANCS readiness after a disabled status, not a late prior-session event", async () => {
    const browserApi = Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("Notification", browserApi);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { result } = renderHook(() => useBrowserNotifications(vi.fn()));
    await act(async () => result.current.enable());
    act(() => {
      result.current.handleEvent({ command: "gateway_status", daemon_connected: true });
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: true, device_address: "AA" });
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: false, device_address: "AA" });
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_status", available: true, ancs_enabled: true, device_address: "AA" });
      result.current.handleEvent({ command: "bt_notification", uid: 1 });
    });
    expect(browserApi).not.toHaveBeenCalled();
    act(() => {
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
      result.current.handleEvent({ command: "bt_notification", uid: 2 });
    });
    expect(browserApi).toHaveBeenCalledOnce();
  });

  it("disables a persisted preference when permission is revoked, even before another event", async () => {
    const browserApi = Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("Notification", browserApi);
    const { result } = renderHook(() => useBrowserNotifications(vi.fn()));
    await act(async () => result.current.enable());
    browserApi.permission = "denied";
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current.state).toMatchObject({ enabled: false, permission: "denied" });
    expect(localStorage.getItem("tether-web:browser-notifications:v1")).toBe("disabled");
    browserApi.permission = "granted";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.state).toMatchObject({ enabled: false, permission: "granted" });
  });

  it("notices permission revocation before delivering a live event", async () => {
    const browserApi = Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("Notification", browserApi);
    const { result } = renderHook(() => useBrowserNotifications(vi.fn()));
    await act(async () => result.current.enable());
    act(() => {
      result.current.handleEvent({ command: "gateway_status", daemon_connected: true });
      result.current.handleEvent({ command: "bt_connection_changed", ancs_ready: true });
    });
    browserApi.permission = "denied";
    act(() => result.current.handleEvent({ command: "bt_notification", uid: 1 }));
    expect(result.current.state).toMatchObject({ enabled: false, permission: "denied" });
    expect(browserApi).not.toHaveBeenCalled();
  });

  it("does not enable alerts without permission or a secure origin", async () => {
    const requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue("denied");
    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "default", requestPermission }));
    const { result } = renderHook(() => useBrowserNotifications(vi.fn()));

    await act(async () => result.current.enable());
    expect(result.current.state).toMatchObject({ enabled: false, permission: "denied" });
    expect(localStorage.getItem("tether-web:browser-notifications:v1")).toBe("disabled");
    vi.stubGlobal("isSecureContext", false);
    await act(async () => result.current.enable());
    expect(result.current.state.permission).toBe("unsupported");
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("survives disabled storage and a preference change from another tab", async () => {
    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted", requestPermission: vi.fn() }));
    const { result } = renderHook(() => useBrowserNotifications(vi.fn()));
    await act(async () => result.current.enable());
    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: "tether-web:browser-notifications:v1", newValue: "disabled",
    })));
    expect(result.current.state.enabled).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    await act(async () => result.current.enable());
    expect(result.current.state).toMatchObject({ enabled: true, error: expect.stringContaining("could not save") });
    act(() => result.current.disable());
    expect(result.current.state.enabled).toBe(false);
  });

  it("defaults off and only enables after user-initiated browser permission", async () => {
    const requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue("granted");
    const browserApi = Object.assign(vi.fn(), { permission: "default", requestPermission });
    vi.stubGlobal("Notification", browserApi);
    const { result, unmount } = renderHook(() => useBrowserNotifications(vi.fn()));

    expect(result.current.state.enabled).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    await act(async () => result.current.enable());
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({ enabled: true, permission: "granted" });
    expect(localStorage.getItem("tether-web:browser-notifications:v1")).toBe("enabled");
    browserApi.permission = "granted";
    unmount();
    const reloaded = renderHook(() => useBrowserNotifications(vi.fn()));
    expect(reloaded.result.current.state.enabled).toBe(true);
    act(() => reloaded.result.current.disable());
    expect(reloaded.result.current.state.enabled).toBe(false);
    expect(localStorage.getItem("tether-web:browser-notifications:v1")).toBe("disabled");
  });
});
