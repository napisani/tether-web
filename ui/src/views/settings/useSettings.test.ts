import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BluetoothStatusEvent } from "../../protocol";
import { useSettings } from "./useSettings";

const status: BluetoothStatusEvent = {
  command: "bt_status", available: true, enabled: true, device_address: "AA:BB", ancs_enabled: true,
  ancs_content_enabled: true, calls_enabled: false, retention: "encrypted", retention_ready: true,
};

function commands() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 }))));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function connect(result: { current: ReturnType<typeof useSettings> }) {
  act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
  act(() => result.current.handleEvent(status));
}

describe("Settings lifecycle", () => {
  it("refreshes from authoritative host status when visible and never optimistically checks a switch", () => {
    const { result } = renderHook(() => useSettings(true));
    connect(result);
    expect(commands()).toContainEqual({ command: "bt_status" });
    act(() => result.current.toggle("ancs_enabled", false));
    expect(commands()).toContainEqual({ command: "bt_set_ancs", enabled: false });
    expect(result.current.state.status?.ancs_enabled).toBe(true);
    expect(result.current.state.pending?.setting).toBe("ancs_enabled");
    act(() => result.current.toggle("calls_enabled", true));
    expect(commands().some((command) => command.command === "bt_set_calls")).toBe(false);
    act(() => result.current.handleEvent({ ...status, calls_enabled: true }));
    expect(result.current.state.pending?.setting).toBe("ancs_enabled");
    act(() => result.current.handleEvent({ ...status, ancs_enabled: false }));
    expect(result.current.state).toMatchObject({ pending: null, status: { ancs_enabled: false } });
  });

  it("requires a bond for host controls, enforces ANCS dependency, and accepts retention only when supported", () => {
    const { result } = renderHook(() => useSettings(false));
    connect(result);
    act(() => result.current.handleEvent({ ...status, device_address: "" }));
    act(() => result.current.setRetention("none"));
    act(() => result.current.toggle("calls_enabled", true));
    expect(commands().filter((command) => String(command.command).startsWith("bt_set"))).toEqual([]);
    act(() => result.current.handleEvent({ ...status, ancs_enabled: false }));
    act(() => result.current.toggle("ancs_content_enabled", false));
    expect(commands().filter((command) => command.command === "bt_set_ancs_content")).toEqual([]);
    act(() => result.current.setRetention("none"));
    expect(commands()).toContainEqual({ command: "bt_set_retention", retention: "none" });
  });

  it("allows a bonded legacy host that omits the enabled field, as GTK does", () => {
    const { result } = renderHook(() => useSettings(false));
    connect(result);
    act(() => result.current.handleEvent({ ...status, enabled: undefined }));
    act(() => result.current.toggle("calls_enabled", true));
    expect(commands()).toContainEqual({ command: "bt_set_calls", enabled: true });
  });

  it("ignores superseded refresh failures and clears an old refresh alert on host status", async () => {
    const rejectRequests: Array<(error: Error) => void> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((_, reject) => {
      rejectRequests.push(reject);
    })));
    const { result } = renderHook(() => useSettings(true));
    connect(result);
    act(() => { result.current.refresh(); result.current.refresh(); });
    expect(rejectRequests).toHaveLength(3);
    act(() => result.current.handleEvent(status));
    await act(async () => {
      rejectRequests[0](new Error("initial status arrived"));
      rejectRequests[1](new Error("superseded"));
      rejectRequests[2](new Error("status already arrived"));
    });
    expect(result.current.state.error).toBe("");
    act(() => result.current.refresh());
    await act(async () => rejectRequests[3](new Error("offline")));
    expect(result.current.state.error).toBe("Could not refresh host settings. Try again.");
    act(() => result.current.handleEvent(status));
    expect(result.current.state.error).toBe("");
  });

  it("leaves uncertain changes blocked until explicit recovery or matching status", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSettings(false));
    connect(result);
    act(() => result.current.setRetention("none"));
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.state.pending?.phase).toBe("uncertain");
    act(() => result.current.setRetention("none"));
    expect(commands().filter((command) => command.command === "bt_set_retention")).toHaveLength(1);
    act(() => result.current.handleEvent({ ...status, retention: "none" }));
    expect(result.current.state.pending).toBeNull();
    act(() => result.current.toggle("calls_enabled", true));
    act(() => result.current.handleDisconnect());
    expect(result.current.state).toMatchObject({ pending: { phase: "uncertain" }, status: null });
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => result.current.handleEvent(status));
    expect(result.current.state.pending?.phase).toBe("uncertain");
    act(() => result.current.resolveUncertain());
    expect(result.current.state.pending).toBeNull();
  });

  it("ignores stale failed refreshes after disconnect", async () => {
    let rejectRequest: (error: Error) => void = () => {};

    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectRequest = reject; })));
    const { result } = renderHook(() => useSettings(true));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => result.current.handleDisconnect());
    await act(async () => rejectRequest(new Error("old HTTP failure")));
    expect(result.current.state.error).toBe("");
  });
});
