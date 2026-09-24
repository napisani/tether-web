import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallConnectionStatus, PhoneCall } from "../../protocol";
import { useCalls } from "./useCalls";

const ready: CallConnectionStatus = { available: true, audio: "idle", indicators: true,
  operator: "Carrier", service: true, signal: 3, battery: 4 };

const incoming: PhoneCall = { path: "/call/1", number: "+15550100", name: "Ada", state: "incoming", ringing: true };

function commands() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 }))));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function connect(result: { current: ReturnType<typeof useCalls> }) {
  act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
  act(() => result.current.handleEvent({ command: "bt_connection_changed", calls: ready }));
}

describe("Calls lifecycle", () => {
  it("refreshes on visibility and HFP availability, but ignores lists while unavailable", () => {
    const { result, rerender } = renderHook(({ visible }) => useCalls(visible), { initialProps: { visible: true } });
    expect(commands()).toContainEqual({ command: "bt_list_calls" });
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming] }));
    expect(result.current.state.calls).toHaveLength(0);
    connect(result);
    expect(commands().filter((command) => command.command === "bt_list_calls")).toHaveLength(2);
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming] }));
    expect(result.current.state.calls).toEqual([incoming]);
    rerender({ visible: false });
    rerender({ visible: true });
    expect(commands().filter((command) => command.command === "bt_list_calls")).toHaveLength(3);
    act(() => result.current.handleEvent({ command: "bt_connection_changed", calls: { available: false, reason: "Hands-Free not connected." } }));
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming] }));
    expect(result.current.state).toMatchObject({ calls: [], loaded: false });
    expect(result.current.state.status?.reason).toBe("Hands-Free not connected.");
  });

  it("does not attribute global results or another outgoing call to a dial; requires explicit retry", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCalls(false));
    connect(result);
    act(() => result.current.setNumber("+1 (555) 0100"));
    act(() => result.current.sendAction("dial"));
    expect(commands()).toContainEqual({ command: "bt_call_dial", number: "+1 (555) 0100" });
    act(() => result.current.sendAction("dial"));
    expect(commands().filter((command) => command.command === "bt_call_dial")).toHaveLength(1);
    act(() => result.current.handleEvent({ command: "bt_call_result", action: "hangup", success: true }));
    expect(result.current.state.pending.dial?.status).toBe("waiting");
    act(() => result.current.handleEvent({ command: "bt_call_result", action: "dial", success: true }));
    expect(result.current.state.pending.dial?.status).toBe("waiting");
    act(() => result.current.handleEvent({ command: "bt_call_result", action: "dial", success: false }));
    expect(result.current.state.pending.dial?.status).toBe("waiting");
    expect(result.current.state.number).toBe("+1 (555) 0100");
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming,
      { path: "/other-call", state: "dialing", outgoing: true }] }));
    expect(result.current.state.pending.dial?.status).toBe("waiting");
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.state.pending.dial?.status).toBe("uncertain");
    act(() => result.current.handleEvent({ command: "bt_call_result", action: "dial", success: true }));
    expect(result.current.state.pending.dial?.status).toBe("uncertain");
    act(() => result.current.sendAction("dial"));
    expect(commands().filter((command) => command.command === "bt_call_dial")).toHaveLength(1);
    act(() => result.current.resolveUncertain());
    act(() => result.current.sendAction("dial"));
    expect(commands().filter((command) => command.command === "bt_call_dial")).toHaveLength(2);
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming,
      { path: "/call/2", state: "dialing", outgoing: true }] }));
    expect(result.current.state.pending.dial?.status).toBe("waiting");
    expect(result.current.state.number).toBe("+1 (555) 0100");
  });

  it("scopes answer and hangup by the daemon call path and resets pending work on disconnect", () => {
    const { result } = renderHook(() => useCalls(false));
    connect(result);
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming,
      { path: "/call/2", state: "active", connected: true }] }));
    act(() => result.current.sendAction("answer", incoming.path));
    expect(commands()).toContainEqual({ command: "bt_call_action", action: "answer", path: incoming.path });
    act(() => result.current.handleEvent({ command: "bt_call_result", action: "answer", success: false, message: "Could not answer." }));
    expect(result.current.state.pending[`answer:${incoming.path}`]?.status).toBe("waiting");
    expect(result.current.state.error).toBe("");
    act(() => result.current.sendAction("hangup", incoming.path));
    expect(commands().filter((command) => command.action === "hangup")).toHaveLength(0);
    act(() => result.current.sendAction("hangup", "/call/2"));
    expect(commands()).toContainEqual({ command: "bt_call_action", action: "hangup", path: "/call/2" });
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [{ ...incoming, state: "active", ringing: false }] }));
    expect(result.current.state.pending[`answer:${incoming.path}`]).toBeUndefined();
    expect(result.current.state.pending["hangup:/call/2"]).toBeUndefined();
    expect(result.current.state.error).toBe("");
    act(() => result.current.sendAction("answer", "/call/unknown"));
    expect(commands().filter((command) => command.action === "answer")).toHaveLength(1);
    act(() => result.current.sendAction("hangup", incoming.path));
    act(() => result.current.handleDisconnect());
    expect(result.current.state).toMatchObject({ calls: [], pending: {}, number: "" });
    expect(result.current.state.error).toContain("may have reached");
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming] }));
    expect(result.current.state.calls).toHaveLength(0);
  });

  it("does not let a global result resolve two independent call rows", () => {
    const { result } = renderHook(() => useCalls(false));
    const second = { ...incoming, path: "/call/2" };
    connect(result);
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [incoming, second] }));
    act(() => result.current.sendAction("answer", incoming.path));
    act(() => result.current.sendAction("answer", second.path));
    act(() => result.current.handleEvent({ command: "bt_call_result", action: "answer", success: false }));
    expect(result.current.state.pending[`answer:${incoming.path}`]?.status).toBe("waiting");
    expect(result.current.state.pending[`answer:${second.path}`]?.status).toBe("waiting");
    act(() => result.current.handleEvent({ command: "bt_calls", calls: [{ ...incoming, ringing: false }, second] }));
    expect(result.current.state.pending[`answer:${incoming.path}`]).toBeUndefined();
    expect(result.current.state.pending[`answer:${second.path}`]?.status).toBe("waiting");
  });

  it("routes audio to the daemon host, never the browser, when the backend offers it", () => {
    const { result } = renderHook(() => useCalls(false));
    connect(result);
    act(() => result.current.sendAction("audio_here"));
    expect(commands()).toContainEqual({ command: "bt_call_action", action: "audio_here" });
    act(() => result.current.handleEvent({ command: "bt_connection_changed", calls: { ...ready, audio: "active" } }));
    expect(result.current.state.pending.audio_here).toBeUndefined();
    act(() => result.current.sendAction("audio_phone"));
    expect(commands()).toContainEqual({ command: "bt_call_action", action: "audio_phone" });
    act(() => result.current.handleEvent({ command: "bt_connection_changed", calls: { ...ready, audio: "idle" } }));
    expect(result.current.state.pending.audio_phone).toBeUndefined();
    act(() => result.current.handleEvent({ command: "bt_connection_changed", calls: { ...ready, audio: "" } }));
    act(() => result.current.sendAction("audio_here"));
    expect(commands().filter((command) => command.action === "audio_here")).toHaveLength(1);
  });
});
