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
