import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCallHistory } from "./useCallHistory";

beforeEach(() =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 }))),
);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("loads PBAP independently of HFP, bounds history and clears on loss", () => {
  const { result } = renderHook(() => useCallHistory(true));
  act(() =>
    result.current.handleEvent({
      command: "gateway_status",
      daemon_connected: true,
    }),
  );
  act(() =>
    result.current.handleEvent({
      command: "bt_connection_changed",
      pbap_open: true,
      calls: { available: false },
    }),
  );
  expect(result.current.state.kind).toBe("loading");
  act(() =>
    result.current.handleEvent({
      command: "bt_call_history",
      calls: Array.from({ length: 101 }, () => ({
        number: "123",
        name: "Ada",
        type: "missed",
        timestamp: 123,
      })),
    }),
  );
  expect(result.current.state.kind === "ready" && result.current.state.calls.length).toBe(100);
  act(() =>
    result.current.handleEvent({
      command: "gateway_status",
      daemon_connected: false,
    }),
  );
  expect(result.current.state.kind).toBe("unavailable");
  act(() =>
    result.current.handleEvent({
      command: "bt_call_history",
      calls: [{ number: "123", name: "Ada", type: "missed", timestamp: 123 }],
    }),
  );
  expect(result.current.state.kind).toBe("unavailable");
  act(() =>
    result.current.handleEvent({
      command: "gateway_status",
      daemon_connected: true,
    }),
  );
  act(() =>
    result.current.handleEvent({
      command: "bt_connection_changed",
      pbap_open: true,
    }),
  );
  expect(result.current.state.kind).toBe("loading");
  act(() => result.current.handleEvent({ command: "bt_call_history", calls: [] }));
  expect(result.current.state.kind).toBe("empty");
});

it("refreshes on visibility and ignores late HTTP failure", async () => {
  let fail: (reason: Error) => void = () => {};

  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((_, reject) => {
        fail = reject;
      }),
  );

  const { result, rerender } = renderHook(({ visible }) => useCallHistory(visible), {
    initialProps: { visible: false },
  });

  act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
  act(() => result.current.handleEvent({ command: "bt_connection_changed", pbap_open: true }));
  expect(fetch).not.toHaveBeenCalled();
  rerender({ visible: true });
  expect(result.current.state.kind).toBe("loading");
  act(() => result.current.handleEvent({ command: "bt_call_history", calls: [] }));
  await act(async () => {
    fail(new Error("late HTTP failure"));
  });
  expect(result.current.state.kind).toBe("empty");
  act(() =>
    result.current.handleEvent({
      command: "bt_connection_changed",
      pbap_open: false,
      pbap_error: "denied",
    }),
  );
  expect(result.current.state).toEqual({ kind: "unavailable", reason: "denied" });
});

it("times out without claiming an empty lookup", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCallHistory(true));
  act(() =>
    result.current.handleEvent({
      command: "gateway_status",
      daemon_connected: true,
    }),
  );
  act(() =>
    result.current.handleEvent({
      command: "bt_connection_changed",
      pbap_open: true,
    }),
  );
  act(() => {
    vi.advanceTimersByTime(12_000);
  });
  expect(result.current.state.kind).toBe("unavailable");
  await act(async () => {});
});
