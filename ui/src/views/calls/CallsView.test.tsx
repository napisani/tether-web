import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TetherApp } from "../../app/TetherApp";
import type { DaemonEvent } from "../../protocol";
import { requestBody } from "../../test-helpers";

class FakeEventSource {
  static current: FakeEventSource;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;

  constructor() {
    FakeEventSource.current = this;
  }
  close() {}
  emit(event: DaemonEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

function commands() {
  return vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => JSON.parse(requestBody(init)) as Record<string, unknown>);
}

function connect(available = true) {
  act(() => {
    FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: true });
    FakeEventSource.current.emit({
      command: "protocol_info",
      version: 1,
      capabilities: available ? ["calls"] : [],
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Calls view", () => {
  it("hides Calls until host opt-in and then explains HFP availability", () => {
    render(<TetherApp />);
    connect(false);
    act(() =>
      FakeEventSource.current.emit({ command: "bt_status", available: true, calls_enabled: false }),
    );
    expect(screen.queryByRole("button", { name: "Calls" })).not.toBeInTheDocument();
    expect(commands()).not.toContainEqual({ command: "bt_list_calls" });
    expect(commands()).toContainEqual({ command: "protocol_info" });
    act(() =>
      FakeEventSource.current.emit({ command: "bt_status", available: true, calls_enabled: true }),
    );
    expect(commands().filter((command) => command.command === "protocol_info")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    expect(
      screen.getByText(
        "Call control is enabled, but Bluetooth is unavailable on the tetherd host.",
      ),
    ).toBeInTheDocument();
    connect();
    act(() =>
      FakeEventSource.current.emit({
        command: "bt_connection_changed",
        calls: {
          available: false,
          reason: "The iPhone has not connected Hands-Free.",
        },
      }),
    );
    expect(screen.getByText("The iPhone has not connected Hands-Free.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
  });

  it("surfaces a failed capability refresh and lets the user retry it", async () => {
    render(<TetherApp />);
    connect(false);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("gateway unavailable"));
    await act(async () =>
      FakeEventSource.current.emit({ command: "bt_status", available: true, calls_enabled: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh Calls availability.");
    fireEvent.click(screen.getByRole("button", { name: "Retry availability" }));
    await act(async () => {});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(commands().filter((command) => command.command === "protocol_info")).toHaveLength(2);
  });

  it("displays withheld callers, controls calls by path and labels host audio", () => {
    render(<TetherApp />);
    connect();
    act(() =>
      FakeEventSource.current.emit({ command: "bt_status", available: true, calls_enabled: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    act(() => {
      FakeEventSource.current.emit({
        command: "bt_connection_changed",
        calls: {
          available: true,
          audio: "idle",
          indicators: true,
          operator: "Carrier",
          service: true,
          signal: 4,
          battery: 3,
        },
      });
      FakeEventSource.current.emit({
        command: "bt_calls",
        calls: [
          { path: "/call/1", number: "", withheld: true, ringing: true, state: "incoming" },
          { path: "/call/2", number: "+15550102", name: "Ada", connected: true, state: "active" },
        ],
      });
    });
    expect(screen.getByText("Withheld number")).toBeInTheDocument();
    expect(screen.getByLabelText(/iPhone cellular status/)).toHaveTextContent("Carrier");
    expect(screen.getByText(/not in this browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Answer call from Withheld number" }));
    expect(commands()).toContainEqual({
      command: "bt_call_action",
      action: "answer",
      path: "/call/1",
    });
    act(() =>
      FakeEventSource.current.emit({
        command: "bt_call_result",
        action: "answer",
        success: false,
        message: "Could not answer.",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Decline call with Withheld number" }),
    ).toBeDisabled();
    act(() =>
      FakeEventSource.current.emit({
        command: "bt_calls",
        calls: [
          { path: "/call/1", number: "", withheld: true, connected: true, state: "active" },
          { path: "/call/2", number: "+15550102", name: "Ada", connected: true, state: "active" },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hang up call with Withheld number" }));
    expect(commands()).toContainEqual({
      command: "bt_call_action",
      action: "hangup",
      path: "/call/1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Audio on tetherd host" }));
    expect(commands()).toContainEqual({ command: "bt_call_action", action: "audio_here" });
    act(() =>
      FakeEventSource.current.emit({
        command: "bt_connection_changed",
        calls: { available: true, audio: "active" },
      }),
    );
    expect(screen.getByRole("button", { name: "Audio on iPhone" })).toBeInTheDocument();
  });

  it("preserves dial input on global results and clears calls on disconnect", () => {
    render(<TetherApp />);
    connect();
    act(() =>
      FakeEventSource.current.emit({ command: "bt_status", available: true, calls_enabled: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    act(() =>
      FakeEventSource.current.emit({
        command: "bt_connection_changed",
        calls: { available: true, audio: "" },
      }),
    );
    const number = screen.getByRole("textbox", { name: "Number to call" });
    fireEvent.change(number, { target: { value: "+15550100" } });
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(commands()).toContainEqual({ command: "bt_call_dial", number: "+15550100" });
    act(() =>
      FakeEventSource.current.emit({ command: "bt_call_result", action: "dial", success: true }),
    );
    expect(number).toHaveValue("+15550100");
    act(() =>
      FakeEventSource.current.emit({
        command: "bt_calls",
        calls: [{ path: "/call/1", state: "dialing", outgoing: true, number: "+15550100" }],
      }),
    );
    expect(screen.getByText("Dialing")).toBeInTheDocument();
    act(() => FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: false }));
    expect(screen.queryByText("Dialing")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calls" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
    connect();
    act(() =>
      FakeEventSource.current.emit({ command: "bt_status", available: true, calls_enabled: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    expect(screen.getByRole("textbox", { name: "Number to call" })).toHaveValue("+15550100");
    expect(screen.queryByText("Dialing")).not.toBeInTheDocument();
  });
});
