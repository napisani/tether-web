import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContacts } from "./useContacts";

const contact = { name: "Ada", addresses: ["tel:+15550102", "email:ada@example.com"] };

function commands() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 }))));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function connect(result: { current: ReturnType<typeof useContacts> }) {
  act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
  act(() => result.current.handleEvent({ command: "bt_connection_changed", pbap_open: true }));
}

describe("Contacts lifecycle", () => {
  it("loads a bounded list when visible and PBAP opens, ignores compose suggestions, and refreshes on return", () => {
    const { result, rerender } = renderHook(({ visible }) => useContacts(visible), { initialProps: { visible: true } });
    expect(commands()).toHaveLength(0);
    connect(result);
    expect(commands()).toContainEqual({ command: "bt_list_contacts", query: "", limit: 5000 });
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "Ad", contacts: [contact] }));
    expect(result.current.state.loaded).toBe(false);
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [contact] }));
    expect(result.current.state).toMatchObject({ contacts: [contact], loaded: true, loading: false });
    rerender({ visible: false });
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [] }));
    expect(result.current.state.contacts).toEqual([contact]);
    rerender({ visible: true });
    expect(commands().filter((command) => command.command === "bt_list_contacts")).toHaveLength(2);
  });

  it("removes sensitive contacts when PBAP or daemon disconnects and ignores late lists", () => {
    const { result } = renderHook(() => useContacts(true));
    connect(result);
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [contact] }));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", pbap_open: false, pbap_error: "Permission denied" }));
    expect(result.current.state).toMatchObject({ contacts: [], loaded: false, reason: "Permission denied" });
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [contact] }));
    expect(result.current.state.contacts).toEqual([]);
    act(() => result.current.handleEvent({ command: "bt_connection_changed", pbap_open: true }));
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [contact] }));
    act(() => result.current.handleDisconnect());
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [contact] }));
    expect(result.current.state).toMatchObject({ contacts: [], loaded: false, pbapOpen: false });
  });

  it("does not let an earlier failed HTTP refresh cancel a newer refresh timeout", async () => {
    vi.useFakeTimers();
    let rejectFirst: (error: Error) => void = () => {};

    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectFirst = reject; }))
      .mockImplementation(() => new Promise<Response>(() => {})));
    const { result } = renderHook(() => useContacts(true));
    connect(result);
    act(() => result.current.refresh());
    await act(async () => { rejectFirst(new Error("old request failed")); });
    expect(result.current.state).toMatchObject({ loading: true, error: "" });
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.state).toMatchObject({ loading: false, error: "Contacts did not respond. Try refreshing." });
  });

  it("does not let a pre-disconnect failure alter the next PBAP session", async () => {
    let rejectFirst: (error: Error) => void = () => {};

    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(new Response(null, { status: 202 })));
    const { result } = renderHook(() => useContacts(true));
    connect(result);
    act(() => result.current.handleEvent({ command: "bt_connection_changed", pbap_open: false }));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", pbap_open: true }));
    await act(async () => { rejectFirst(new Error("old request failed")); });
    expect(result.current.state).toMatchObject({ loading: true, error: "" });
  });

  it("expires an unanswered refresh and allows retry", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useContacts(true));
    connect(result);
    expect(result.current.state.loading).toBe(true);
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.state).toMatchObject({ loading: false, error: "Contacts did not respond. Try refreshing." });
    act(() => result.current.refresh());
    expect(result.current.state.loading).toBe(true);
    act(() => result.current.handleEvent({ command: "bt_contacts", query: "", contacts: [] }));
    expect(result.current.state).toMatchObject({ loading: false, loaded: true, contacts: [] });
  });
});
