import { describe, expect, it } from "vitest";
import type { DaemonEvent } from "../../protocol";
import { initialDevicesState, reduceDevicesEvent, reduceDevicesState } from "./devicesState";

function apply(events: DaemonEvent[]) {
  return events.reduce(reduceDevicesEvent, initialDevicesState);
}

describe("reduceDevicesEvent", () => {
  it("builds and updates the Wi-Fi peer list from daemon state", () => {
    const state = reduceDevicesEvent(initialDevicesState, {
      command: "state_snapshot",
      paired_devices: [{ fingerprint: "paired", device_name: "Paired phone" }],
      pending_pairs: [{ fingerprint: "pending", device_name: "New phone" }],
      connected_clients: [
        { fingerprint: "paired", device_name: "Paired phone", address: "10.0.0.2", paired: true },
      ],
      discovered_devices: [
        {
          name: "Nearby phone",
          fingerprint: "nearby",
          addresses: [{ address: "10.0.0.3", port: 5134 }],
        },
      ],
      mdns_available: true,
      clipboard_available: false,
      firewall_active: true,
    });

    expect(state.wifi.peers.map((peer) => peer.fingerprint)).toEqual([
      "paired",
      "nearby",
      "pending",
    ]);
    expect(state.wifi.peers[0]).toMatchObject({
      connected: true,
      paired: true,
      address: "10.0.0.2",
    });
    expect(state.wifi).toMatchObject({ clipboardAvailable: false, firewallActive: true });

    const accepted = reduceDevicesEvent(state, {
      command: "pair_accepted",
      fingerprint: "pending",
      connected: true,
    });

    expect(accepted.wifi.peers.find((peer) => peer.fingerprint === "pending")).toMatchObject({
      paired: true,
      connected: true,
      pending: false,
    });
  });

  it("replaces stale unpaired discovery results but retains durable peers", () => {
    const state = reduceDevicesEvent(initialDevicesState, {
      command: "state_snapshot",
      paired_devices: [{ fingerprint: "paired", device_name: "Paired phone" }],
      pending_pairs: [],
      connected_clients: [],
      discovered_devices: [{ name: "Old phone", fingerprint: "old", addresses: [] }],
      mdns_available: true,
      clipboard_available: true,
      firewall_active: false,
    });

    const refreshed = reduceDevicesEvent(state, {
      command: "discovery_result",
      devices: [{ name: "New phone", fingerprint: "new", addresses: [] }],
    });

    expect(refreshed.wifi.peers.map((peer) => peer.fingerprint)).toEqual(["paired", "new"]);
  });

  it("treats an explicitly unpaired connected client as pending approval", () => {
    const state = reduceDevicesEvent(initialDevicesState, {
      command: "state_snapshot",
      paired_devices: [{ fingerprint: "peer", device_name: "Previously paired" }],
      pending_pairs: [],
      connected_clients: [
        { fingerprint: "peer", device_name: "Untrusted phone", address: "10.0.0.4", paired: false },
      ],
      discovered_devices: [],
      mdns_available: true,
      clipboard_available: true,
      firewall_active: false,
    });

    expect(state.wifi.peers[0]).toMatchObject({ paired: false, connected: true, pending: true });
  });

  it("makes an untrusted client connected and pending even if it was previously trusted", () => {
    const trusted = reduceDevicesEvent(initialDevicesState, {
      command: "state_snapshot",
      paired_devices: [{ fingerprint: "peer", device_name: "Previously paired" }],
      pending_pairs: [],
      connected_clients: [],
      discovered_devices: [],
      mdns_available: true,
      clipboard_available: true,
      firewall_active: false,
    });

    const state = reduceDevicesEvent(trusted, {
      command: "untrusted_client_connected",
      fingerprint: "peer",
      device_name: "Nearby phone",
      address: "10.0.0.4",
    });

    expect(state.wifi.peers[0]).toMatchObject({ paired: false, connected: true, pending: true });
  });

  it("keeps discovery timeouts scoped to their operation", () => {
    const first = reduceDevicesState(initialDevicesState, {
      type: "peer-discovery-started",
      token: "old",
    });

    const second = reduceDevicesState(first, { type: "peer-discovery-started", token: "current" });

    const staleTimeout = reduceDevicesState(second, {
      type: "peer-discovery-timeout",
      token: "old",
    });

    expect(staleTimeout.wifi).toMatchObject({ discovering: true, discoveryToken: "current" });

    const timedOut = reduceDevicesState(staleTimeout, {
      type: "peer-discovery-timeout",
      token: "current",
    });

    expect(timedOut.wifi.discovering).toBe(false);
    expect(timedOut.wifi.message).toContain("No discovery result");
  });

  it("tracks the peer awaiting outbound approval", () => {
    const started = reduceDevicesState(initialDevicesState, {
      type: "peer-pair-started",
      fingerprint: "peer",
      token: "pair-1",
    });

    expect(started.wifi).toMatchObject({ pairingFingerprint: "peer", pairingToken: "pair-1" });

    const rejected = reduceDevicesEvent(started, {
      command: "pair_rejected",
      fingerprint: "peer",
      device_name: "Nearby phone",
      reason: "refused",
    });

    expect(rejected.wifi.pairingFingerprint).toBeUndefined();
    expect(rejected.wifi.pairingToken).toBeUndefined();
    expect(rejected.wifi.message).toContain("refused");
  });

  it("ignores a timeout from an older outbound peer operation", () => {
    const first = reduceDevicesState(initialDevicesState, {
      type: "peer-pair-started",
      fingerprint: "peer",
      token: "old",
    });

    const current = reduceDevicesState(first, {
      type: "peer-pair-started",
      fingerprint: "peer",
      token: "current",
    });

    const stale = reduceDevicesState(current, {
      type: "peer-pair-timeout",
      fingerprint: "peer",
      token: "old",
    });

    expect(stale.wifi).toMatchObject({ pairingFingerprint: "peer", pairingToken: "current" });
  });

  it("retains peer state when forgetting fails", () => {
    const state = reduceDevicesEvent(initialDevicesState, {
      command: "state_snapshot",
      paired_devices: [{ fingerprint: "paired", device_name: "Paired phone" }],
      pending_pairs: [],
      connected_clients: [],
      discovered_devices: [],
      mdns_available: true,
      clipboard_available: true,
      firewall_active: false,
    });

    const failed = reduceDevicesEvent(state, {
      command: "forget_device_result",
      fingerprint: "paired",
      forgotten: false,
    });

    expect(failed.wifi.peers).toEqual(state.wifi.peers);
    expect(failed.wifi.message).toBe("Could not forget the device.");
  });

  it("retains discovered phones after BlueZ removes the transient object", () => {
    const state = apply([
      {
        command: "bt_devices",
        devices: [
          {
            address: "40:F6:64:3D:7A:F1",
            name: "40-F6-64-3D-7A-F1",
            apple_nearby: true,
            iphone: false,
            bonded: false,
          },
        ],
      },
      {
        command: "bt_scan_result",
        success: true,
        message: "Bluetooth scan finished.",
      },
      { command: "bt_devices", devices: [] },
    ]);

    expect(state.devices).toHaveLength(1);
    expect(state.scanMessage).toBe("Bluetooth scan finished.");
  });

  it("keeps the configured supervised device visible without Apple metadata", () => {
    const configured = reduceDevicesEvent(
      {
        ...initialDevicesState,
        bluetooth: { command: "bt_status", available: true, device_address: "aa:bb:cc:dd:ee:ff" },
      },
      {
        command: "bt_devices",
        devices: [
          {
            address: "AA:BB:CC:DD:EE:FF",
            name: "Configured phone",
            iphone: false,
            apple_nearby: false,
            airpods: false,
          },
        ],
      },
    );

    expect(configured.devices).toHaveLength(1);
    expect(configured.devices[0]?.name).toBe("Configured phone");
  });

  it("ignores pairing messages for another browser operation", () => {
    const pairingState = {
      ...initialDevicesState,
      pairing: {
        operationId: "web-current",
        phase: "pairing" as const,
        detail: "Starting pairing.",
      },
    };

    const next = reduceDevicesEvent(pairingState, {
      command: "bt_pair_result",
      operation_id: "web-stale",
      success: false,
      status: "error",
      message: "Stale failure",
    });

    expect(next.pairing.detail).toBe("Starting pairing.");
  });

  it("ignores delayed pairing events after the operation reaches a terminal state", () => {
    const completed = {
      ...initialDevicesState,
      pairing: { phase: "complete" as const, operationId: "pair-1", message: "Paired." },
    };

    const delayedProgress = reduceDevicesEvent(completed, {
      command: "bt_pair_progress",
      operation_id: "pair-1",
      step: "pairing",
      detail: "Delayed progress.",
    });

    const delayedConfirmation = reduceDevicesEvent(completed, {
      command: "bt_pair_confirm_request",
      operation_id: "pair-1",
      code: "042731",
    });

    const delayedResult = reduceDevicesEvent(completed, {
      command: "bt_pair_result",
      operation_id: "pair-1",
      success: false,
      status: "error",
      message: "Delayed failure.",
    });

    expect(delayedProgress).toBe(completed);
    expect(delayedConfirmation).toBe(completed);
    expect(delayedResult).toBe(completed);
  });

  it("scopes local pairing command failures and confirmations to the active operation", () => {
    const active = reduceDevicesState(initialDevicesState, {
      type: "pair-started",
      operationId: "current",
      address: "AA:BB",
    });

    const staleFailure = reduceDevicesState(active, {
      type: "operation-failed",
      operationId: "old",
      message: "Old failure.",
    });

    expect(staleFailure.pairing).toEqual(active.pairing);

    const failed = reduceDevicesState(staleFailure, {
      type: "operation-failed",
      operationId: "current",
      message: "Current failure.",
    });

    expect(failed.pairing).toMatchObject({
      phase: "error",
      operationId: "current",
      message: "Current failure.",
    });

    const completed = {
      ...active,
      pairing: { ...active.pairing, phase: "complete" as const, message: "Paired." },
    };

    const lateFailure = reduceDevicesState(completed, {
      type: "operation-failed",
      operationId: "current",
      message: "Late transport failure.",
    });

    expect(lateFailure).toBe(completed);

    const confirming = {
      ...active,
      pairing: { ...active.pairing, phase: "confirming" as const, code: "042731" },
    };

    expect(
      reduceDevicesState(confirming, {
        type: "pair-confirmation-sent",
        operationId: "old",
      }),
    ).toBe(confirming);
    expect(
      reduceDevicesState(confirming, {
        type: "pair-confirmation-sent",
        operationId: "current",
      }).pairing,
    ).toMatchObject({ phase: "pairing", operationId: "current", code: undefined });
  });

  it("completes Bluetooth settings when the daemon reports the requested global state", () => {
    const started = reduceDevicesState(initialDevicesState, {
      type: "bluetooth-enabled-started",
      enabled: false,
      token: "setting-1",
    });

    const unchanged = reduceDevicesEvent(started, {
      command: "bt_status",
      available: true,
      enabled: true,
    });

    expect(unchanged.bluetoothEnabledToken).toBe("setting-1");

    const completed = reduceDevicesEvent(unchanged, {
      command: "bt_status",
      available: true,
      enabled: false,
    });

    expect(completed.bluetoothEnabledToken).toBeUndefined();
    expect(completed.bluetoothMessage).toBe("Bluetooth connection preference updated.");
  });

  it("releases Bluetooth setting and solicitation controls on timeout or failure", () => {
    const setting = reduceDevicesState(initialDevicesState, {
      type: "bluetooth-enabled-started",
      enabled: false,
      token: "setting-current",
    });

    const staleSettingTimeout = reduceDevicesState(setting, {
      type: "bluetooth-enabled-timeout",
      token: "setting-old",
    });

    expect(staleSettingTimeout.bluetoothEnabledToken).toBe("setting-current");

    const settingTimedOut = reduceDevicesState(staleSettingTimeout, {
      type: "bluetooth-enabled-timeout",
      token: "setting-current",
    });

    expect(settingTimedOut.bluetoothEnabledToken).toBeUndefined();
    expect(settingTimedOut.bluetoothMessage).toContain("No updated Bluetooth status");

    const solicitation = reduceDevicesState(settingTimedOut, {
      type: "bluetooth-solicit-started",
      token: "solicit-current",
    });

    const failed = reduceDevicesState(solicitation, {
      type: "bluetooth-solicit-failed",
      token: "solicit-current",
      message: "Could not ask the iPhone for permissions.",
    });

    expect(failed.bluetoothSolicitToken).toBeUndefined();
    expect(failed.bluetoothMessage).toContain("Could not ask");
  });

  it("applies the next global solicitation result only while a local request is pending", () => {
    const unsolicited = reduceDevicesEvent(initialDevicesState, {
      command: "bt_solicit_result",
      success: false,
      message: "No local request is waiting.",
    });

    expect(unsolicited).toBe(initialDevicesState);

    const pending = reduceDevicesState(initialDevicesState, {
      type: "bluetooth-solicit-started",
      token: "current",
    });

    const staleTimeout = reduceDevicesState(pending, {
      type: "bluetooth-solicit-timeout",
      token: "old",
    });

    expect(staleTimeout.bluetoothSolicitToken).toBe("current");

    const completed = reduceDevicesEvent(staleTimeout, {
      command: "bt_solicit_result",
      success: true,
      message: "Asked the iPhone to re-offer notification access.",
    });

    expect(completed.bluetoothSolicitToken).toBeUndefined();
    expect(completed.bluetoothMessage).toContain("re-offer");
  });

  it("clears in-flight work when the daemon disconnects", () => {
    const disconnected = reduceDevicesState(
      {
        ...initialDevicesState,
        scanning: true,
        pairing: {
          phase: "confirming",
          operationId: "web-current",
          code: "042731",
        },
      },
      { type: "daemon-disconnected" },
    );

    expect(disconnected.scanning).toBe(false);
    expect(disconnected.scanMessage).toBe("Bluetooth scan stopped while Tether reconnects.");
    expect(disconnected.pairing).toMatchObject({
      phase: "error",
      operationId: "web-current",
      message: "Connection to tetherd was lost. Try again after it reconnects.",
    });
    expect(disconnected.pairing.code).toBeUndefined();
  });

  it("keeps completed pairing state when the daemon disconnects", () => {
    const disconnected = reduceDevicesState(
      {
        ...initialDevicesState,
        pairing: { phase: "complete", operationId: "web-current", message: "Paired." },
      },
      { type: "daemon-disconnected" },
    );

    expect(disconnected.pairing).toMatchObject({ phase: "complete", message: "Paired." });
  });

  it("ignores malformed AirPods events", () => {
    const malformed = {
      command: "bt_airpods",
      address: "AA:BB",
      name: "AirPods",
      ear: null,
    } as unknown as DaemonEvent;

    expect(reduceDevicesEvent(initialDevicesState, malformed)).toBe(initialDevicesState);
  });

  it("keeps AirPods state and releases an in-flight connection on disconnect", () => {
    const state = reduceDevicesEvent(initialDevicesState, {
      command: "bt_airpods",
      address: "AA:BB",
      name: "AirPods Pro",
      left: 82,
      right: -1,
      case: 45,
      ear: { primary: "in_ear", secondary: "unknown" },
      in_ear: 1,
      peer_taking_over: false,
      peer_active: false,
      peer_audio: false,
      peer_call: false,
      peer_holds_audio: false,
      anc: "adaptive",
      status: "live",
      reason: "",
    });

    const connecting = reduceDevicesState(state, {
      type: "airpods-connect-started",
      address: "AA:BB",
      token: "connect-1",
    });

    const disconnected = reduceDevicesState(connecting, { type: "daemon-disconnected" });

    expect(disconnected.airpods?.left).toBe(82);
    expect(disconnected.airpodsConnectingAddress).toBeUndefined();
    expect(disconnected.airpodsMessage?.text).toContain("Connection to tetherd was lost");
  });

  it("ignores an expired timeout from an older AirPods operation", () => {
    const active = {
      ...initialDevicesState,
      airpodsConnectingAddress: "AA:BB",
      airpodsConnectingToken: "connect-new",
    };

    const next = reduceDevicesState(active, {
      type: "airpods-connect-timeout",
      address: "AA:BB",
      token: "connect-old",
    });

    expect(next).toBe(active);
  });

  it("surfaces a failed AirPods connection result", () => {
    const next = reduceDevicesEvent(
      {
        ...initialDevicesState,
        airpodsConnectingAddress: "AA:BB",
        airpodsConnectingToken: "connect-1",
      },
      {
        command: "bt_airpods_connect_result",
        success: false,
        message: "BlueZ refused the connection.",
      },
    );

    expect(next.airpodsConnectingAddress).toBeUndefined();
    expect(next.airpodsMessage).toEqual({
      address: "AA:BB",
      text: "BlueZ refused the connection.",
    });
  });

  it("keeps the pairing result when the transient candidate disappears", () => {
    const pairedState = reduceDevicesEvent(
      {
        ...initialDevicesState,
        pairing: {
          operationId: "web-current",
          phase: "pairing" as const,
          detail: "Starting pairing.",
        },
      },
      {
        command: "bt_pair_result",
        operation_id: "web-current",
        success: true,
        status: "paired",
        message: "Paired with someone’s iPhone.",
      },
    );

    const withoutCandidate = reduceDevicesEvent(pairedState, {
      command: "bt_devices",
      devices: [],
    });

    expect(withoutCandidate.pairing.phase).toBe("complete");
    expect(withoutCandidate.pairing.message).toBe("Paired with someone’s iPhone.");
  });
});
