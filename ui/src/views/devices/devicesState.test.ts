import { describe, expect, it } from "vitest";
import type { DaemonEvent } from "../../protocol";
import { initialDevicesState, reduceDevicesEvent, reduceDevicesState } from "./devicesState";

function apply(events: DaemonEvent[]) {
  return events.reduce(reduceDevicesEvent, initialDevicesState);
}

describe("reduceDevicesEvent", () => {
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
    const malformed = { command: "bt_airpods", address: "AA:BB", name: "AirPods", ear: null } as unknown as DaemonEvent;
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
      { ...initialDevicesState, airpodsConnectingAddress: "AA:BB", airpodsConnectingToken: "connect-1" },
      { command: "bt_airpods_connect_result", success: false, message: "BlueZ refused the connection." },
    );

    expect(next.airpodsConnectingAddress).toBeUndefined();
    expect(next.airpodsMessage).toEqual({ address: "AA:BB", text: "BlueZ refused the connection." });
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
