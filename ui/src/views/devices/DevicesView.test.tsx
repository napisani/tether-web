import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DaemonState } from "../../app/appState";
import { DevicesView } from "./DevicesView";
import type { DevicesState } from "./devicesState";

const pairedDaemon: DaemonState = {
  connected: true,
  protocol: {
    command: "protocol_info",
    version: 1,
    capabilities: ["bluetooth.pairing", "bluetooth.connection"],
  },
};

const pairedState: DevicesState = {
  bluetooth: {
    command: "bt_status",
    available: true,
    device_address: "38:9C:B2:42:3F:E7",
    version: "0.2.32-test",
  },
  connection: {
    command: "bt_connection_changed",
    device_present: true,
    device_paired: true,
    classic_connected: true,
    le_available: true,
    le_connected: true,
    map_open: true,
    pbap_open: true,
    ancs_ready: true,
  },
  devices: [
    {
      address: "38:9C:B2:42:3F:E7",
      name: "Someone’s iPhone",
      iphone: true,
      paired: true,
      bonded: true,
      trusted: true,
      connected: true,
      classic_connected: true,
      le_bearer: true,
      le_bonded: true,
      le_connected: true,
      map: true,
      pbap: true,
      ancs: true,
      ancs_notifying: true,
    },
  ],
  scanning: false,
  pairing: {
    phase: "confirming",
    operationId: "pair-1",
    address: "38:9C:B2:42:3F:E7",
    code: "042731",
  },
};

function renderDevicesView({
  daemon = pairedDaemon,
  state = pairedState,
  onPair = vi.fn(),
  onUnpair = vi.fn(),
  onConfirmPairing = vi.fn(),
}: {
  daemon?: DaemonState;
  state?: DevicesState;
  onPair?: (address: string) => void;
  onUnpair?: (address: string) => void;
  onConfirmPairing?: (accept: boolean) => void;
} = {}) {
  render(
    <DevicesView
      daemon={daemon}
      state={state}
      onScan={vi.fn()}
      onPair={onPair}
      onUnpair={onUnpair}
      onConfirmPairing={onConfirmPairing}
      onResetPairing={vi.fn()}
    />,
  );
}

describe("guided pairing view", () => {
  it("shows current transport status and requires explicit code confirmation", () => {
    const confirmPairing = vi.fn();
    renderDevicesView({ onConfirmPairing: confirmPairing });

    expect(screen.getByRole("heading", { name: "Someone’s iPhone" })).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Does your iPhone show this code?" })).toHaveTextContent("042731");

    fireEvent.click(screen.getByRole("button", { name: "Codes match" }));
    expect(confirmPairing).toHaveBeenCalledWith(true);
  });

  it("offers an Apple nearby advertisement as a possible iPhone", () => {
    const pair = vi.fn();
    const candidate = {
      ...pairedState.devices[0],
      address: "40:F6:64:3D:7A:F1",
      name: "40-F6-64-3D-7A-F1",
      iphone: false,
      apple_nearby: true,
      paired: false,
      bonded: false,
      trusted: false,
      connected: false,
      classic_connected: false,
      le_bonded: false,
      le_connected: false,
      map: false,
      pbap: false,
      ancs: false,
      ancs_notifying: false,
    };
    renderDevicesView({
      state: {
        ...pairedState,
        bluetooth: { command: "bt_status", available: true },
        connection: undefined,
        devices: [candidate],
        pairing: { phase: "idle" },
      },
      onPair: pair,
    });

    expect(screen.getByRole("heading", { name: "Nearby Apple device" })).toBeInTheDocument();
    expect(screen.getAllByText("Possible iPhone")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Pair over Bluetooth" }));
    expect(pair).toHaveBeenCalledWith("40:F6:64:3D:7A:F1");
  });

  it("shows status for the selected device rather than the supervised phone", () => {
    const nearby = {
      ...pairedState.devices[0],
      address: "40:F6:64:3D:7A:F1",
      name: "Second iPhone",
      paired: false,
      bonded: false,
      trusted: false,
      connected: false,
      classic_connected: false,
      le_bonded: false,
      le_connected: false,
      map: false,
      pbap: false,
      ancs: false,
      ancs_notifying: false,
    };
    renderDevicesView({
      state: {
        ...pairedState,
        connection: { ...pairedState.connection!, link_reason: "Supervised phone diagnostic" },
        devices: [...pairedState.devices, nearby],
        pairing: { phase: "idle" },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Second iPhoneReady to pair/ }));

    expect(screen.getByRole("heading", { name: "Second iPhone" })).toBeInTheDocument();
    expect(screen.getByText("Classic Bluetooth").closest(".capability-card")).not.toHaveClass("active");
    expect(screen.getByText("Low Energy").closest(".capability-card")).not.toHaveClass("active");
    expect(screen.getAllByText("Not supervised")).toHaveLength(3);
    expect(screen.queryByText("Supervised phone diagnostic")).not.toBeInTheDocument();
  });

  it("hides pairing controls until the daemon advertises the capability", () => {
    renderDevicesView({
      daemon: { ...pairedDaemon, protocol: undefined },
      state: { ...pairedState, pairing: { phase: "idle" } },
    });

    expect(screen.queryByRole("button", { name: "Scan for iPhones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scan for iPhone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forget iPhone" })).not.toBeInTheDocument();
    expect(screen.getByText("This version of tetherd does not advertise browser pairing controls.")).toBeInTheDocument();
  });

  it("requires confirmation before forgetting a bonded iPhone", () => {
    const unpair = vi.fn();
    renderDevicesView({ state: { ...pairedState, pairing: { phase: "idle" } }, onUnpair: unpair });

    fireEvent.click(screen.getByRole("button", { name: "Forget iPhone" }));
    expect(unpair).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Forget Someone’s iPhone?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Forget iPhone" }));
    expect(unpair).toHaveBeenCalledWith("38:9C:B2:42:3F:E7");
  });
});
