import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DaemonState } from "../../app/appState";
import { DevicesView } from "./DevicesView";
import type { DevicesState } from "./devicesState";
import type { AirPodsActions } from "./useAirPodsCommands";
import type { PeerActions } from "./usePeerCommands";

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
  wifi: {
    peers: [],
    mdnsAvailable: true,
    clipboardAvailable: true,
    firewallActive: false,
    discovering: false,
  },
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
  airpodsActions = {
    connect: vi.fn(),
    setManaged: vi.fn(),
    setMode: vi.fn(),
    setPause: vi.fn(),
    setHandoff: vi.fn(),
  },
  peerActions = {
    discover: vi.fn(),
    pair: vi.fn(),
    accept: vi.fn(),
    forget: vi.fn(),
  },
}: {
  daemon?: DaemonState;
  state?: DevicesState;
  onPair?: (address: string) => void;
  onUnpair?: (address: string) => void;
  onConfirmPairing?: (accept: boolean) => void;
  airpodsActions?: AirPodsActions;
  peerActions?: PeerActions;
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
      airpodsActions={airpodsActions}
      peerActions={peerActions}
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

  it("pairs and trusts a nearby Wi-Fi peer", () => {
    const actions: PeerActions = {
      discover: vi.fn(),
      pair: vi.fn(),
      accept: vi.fn(),
      forget: vi.fn(),
    };
    const peer = {
      fingerprint: "peer-1",
      name: "Nearby phone",
      address: "10.0.0.3",
      port: 5134,
      paired: false,
      connected: false,
      pending: true,
    };
    renderDevicesView({
      state: { ...pairedState, devices: [], wifi: { ...pairedState.wifi, peers: [peer] }, pairing: { phase: "idle" } },
      peerActions: actions,
    });

    expect(screen.getByRole("heading", { name: "Nearby phone" })).toBeInTheDocument();
    expect(screen.getByText("peer-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve and trust" }));
    expect(actions.accept).toHaveBeenCalledWith(peer);
  });

  it("shows live AirPods controls with GTK-aligned gating", () => {
    const actions: AirPodsActions = {
      connect: vi.fn(),
      setManaged: vi.fn(),
      setMode: vi.fn(),
      setPause: vi.fn(),
      setHandoff: vi.fn(),
    };
    const airpods = {
      address: "AA:BB:CC:DD:EE:FF",
      name: "AirPods Pro",
      airpods: true,
      paired: true,
      connected: true,
    };
    renderDevicesView({
      state: {
        ...pairedState,
        bluetooth: {
          ...pairedState.bluetooth!,
          airpods_enabled: true,
          airpods_pause: "one-removed",
          airpods_handoff: true,
          calls_enabled: true,
        },
        devices: [airpods],
        airpods: {
          command: "bt_airpods",
          address: airpods.address,
          name: airpods.name,
          left: 82,
          right: 79,
          case: 45,
          ear: { primary: "in_ear", secondary: "out_of_ear" },
          in_ear: 1,
          peer_taking_over: false,
          peer_active: false,
          peer_audio: false,
          peer_call: false,
          peer_holds_audio: false,
          anc: "transparency",
          status: "live",
          reason: "",
        },
        pairing: { phase: "idle" },
      },
      airpodsActions: actions,
    });

    expect(screen.getByRole("heading", { name: "AirPods Pro" })).toBeInTheDocument();
    expect(screen.getByText("Left earbud 82% · Right earbud 79% · Case 45%")).toBeInTheDocument();
    expect(screen.getByText("One bud is in.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transparency" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Noise Cancellation" }));
    expect(actions.setMode).toHaveBeenCalledWith("anc");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(actions.connect).toHaveBeenCalledWith(airpods.address, false);
  });
});
